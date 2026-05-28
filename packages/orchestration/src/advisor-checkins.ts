import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

type AdvisorConfig = Record<string, unknown> & { checkins?: "mid-hour" | "off" };

const ADVISOR_CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-rogue", "advisor", "config.json");

function readJson(file: string): AdvisorConfig {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8") || "{}") as AdvisorConfig;
  } catch {
    return {};
  }
}

export function setAdvisorCheckinsEnabled(enabled: boolean, configPath = ADVISOR_CONFIG_PATH): AdvisorConfig {
  const current = readJson(configPath);
  const next: AdvisorConfig = {
    ...current,
    checkins: enabled ? "mid-hour" : "off",
    checkinStartedAt: enabled ? Date.now() : undefined,
  };
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
