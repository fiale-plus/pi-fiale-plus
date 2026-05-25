import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncate } from "@fiale-plus/pi-core";
import { readSessionJson, writeSessionJson } from "./state.js";

const FEATURE = "orchestration";
const RESEARCH_FILE = "autoresearch.json";

type AutoresearchMode = "off" | "run" | "lab";

type AutoresearchState = {
  mode: AutoresearchMode;
  instruction: string;
  updatedAt: string;
};

function defaultAutoresearchState(): AutoresearchState {
  return {
    mode: "off",
    instruction: "",
    updatedAt: "",
  };
}

function readAutoresearchState(ctx: any): AutoresearchState {
  return readSessionJson(FEATURE, ctx, RESEARCH_FILE, defaultAutoresearchState());
}

function writeAutoresearchState(ctx: any, state: AutoresearchState): AutoresearchState {
  const next: AutoresearchState = { ...state, updatedAt: new Date().toISOString() };
  writeSessionJson(FEATURE, ctx, RESEARCH_FILE, next);
  return next;
}

function clearAutoresearchState(ctx: any): AutoresearchState {
  return writeAutoresearchState(ctx, defaultAutoresearchState());
}

function formatAutoresearchState(state: AutoresearchState): string {
  if (state.mode === "off") {
    return "Autoresearch is off.";
  }

  const prefix = state.mode === "lab" ? "🧪 Autoresearch lab" : "🔎 Autoresearch";
  return `${prefix}: ${truncate(state.instruction || "(no instruction)", 160)}`;
}

export function registerAutoresearch(pi: ExtensionAPI): void {
  pi.registerCommand("autoresearch", {
    description: "Configure the current session research mode",
    handler: async (args, ctx) => {
      const input = String(args ?? "").trim();
      const [cmd, ...rest] = input.split(/\s+/);
      const resolved = !input ? "status" : ["status", "show", "off", "clear", "stop", "lab"].includes(cmd) ? cmd : "run";

      if (resolved === "status" || resolved === "show") {
        ctx.ui.notify(formatAutoresearchState(readAutoresearchState(ctx)), "info");
        return;
      }

      if (resolved === "off" || resolved === "clear" || resolved === "stop") {
        clearAutoresearchState(ctx);
        ctx.ui.notify("Autoresearch cleared.", "info");
        return;
      }

      const mode: AutoresearchMode = resolved === "lab" ? "lab" : "run";
      const instruction = (resolved === "lab" ? rest : [cmd, ...rest]).join(" ").trim();
      if (!instruction) {
        ctx.ui.notify("Usage: /autoresearch [lab] <instruction>", "error");
        return;
      }

      const next = writeAutoresearchState(ctx, {
        mode,
        instruction,
        updatedAt: "",
      });
      ctx.ui.notify(formatAutoresearchState(next), "info");
    },
  });
}
