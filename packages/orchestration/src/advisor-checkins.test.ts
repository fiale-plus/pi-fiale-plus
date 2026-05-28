import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { setAdvisorCheckinsEnabled } from "./advisor-checkins.js";

const dirs: string[] = [];

function tempConfig() {
  const dir = mkdtempSync(join(tmpdir(), "pi-rogue-advisor-checkins-"));
  dirs.push(dir);
  const file = join(dir, "advisor", "config.json");
  mkdirSync(join(dir, "advisor"), { recursive: true });
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("advisor check-in lifecycle bridge", () => {
  it("turns advisor check-ins on while preserving existing config and captures start time", () => {
    const file = tempConfig();
    writeFileSync(file, JSON.stringify({ mode: "auto", review: "light", model: "openai-codex/gpt-5.5" }), "utf8");
    const startedAt = Date.now();

    const next = setAdvisorCheckinsEnabled(true, file);

    expect(next).toMatchObject({ mode: "auto", review: "light", model: "openai-codex/gpt-5.5", checkins: "mid-hour" });
    expect(next.checkinStartedAt).toBeTypeOf("number");
    expect(next.checkinStartedAt).toBeGreaterThanOrEqual(startedAt);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    expect(parsed.checkins).toBe("mid-hour");
    expect(parsed.checkinStartedAt).toBeGreaterThanOrEqual(startedAt);
  });

  it("turns advisor check-ins off", () => {
    const file = tempConfig();
    writeFileSync(file, JSON.stringify({ checkins: "mid-hour", checkinIntervalMinutes: 30 }), "utf8");

    const next = setAdvisorCheckinsEnabled(false, file);

    expect(next).toMatchObject({ checkins: "off", checkinIntervalMinutes: 30 });
    expect(JSON.parse(readFileSync(file, "utf8")).checkins).toBe("off");
  });
});
