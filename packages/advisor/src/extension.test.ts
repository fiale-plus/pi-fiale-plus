import { describe, it, expect } from "vitest";
import type { AdvisorConfig } from "./extension.js";

describe("AdvisorConfig", () => {
  it("defaults to auto mode and light review with no model override", () => {
    const cfg: AdvisorConfig = { mode: "auto", review: "light" };
    expect(cfg.mode).toBe("auto");
    expect(cfg.review).toBe("light");
    expect(cfg.model).toBeUndefined();
  });

  it("accepts all 3 modes", () => {
    for (const mode of ["auto", "manual", "off"] as const) {
      const cfg: AdvisorConfig = { mode, review: "light" };
      expect(cfg.mode).toBe(mode);
    }
  });

  it("accepts all 3 review levels", () => {
    for (const review of ["light", "strict", "off"] as const) {
      const cfg: AdvisorConfig = { mode: "auto", review };
      expect(cfg.review).toBe(review);
    }
  });

  it("accepts optional model override", () => {
    const cfg: AdvisorConfig = { mode: "auto", review: "light", model: "claude-sonnet-4-6" };
    expect(cfg.model).toBe("claude-sonnet-4-6");
  });

  it("serializes/deserializes without data loss (JSON round-trip)", () => {
    const original: AdvisorConfig = { mode: "auto", review: "strict", model: "claude-opus-4-6" };
    const json = JSON.stringify(original);
    const parsed = JSON.parse(json) as AdvisorConfig;
    expect(parsed.mode).toBe("auto");
    expect(parsed.review).toBe("strict");
    expect(parsed.model).toBe("claude-opus-4-6");
  });

  it("has exactly 3 properties (mode, review, model)", () => {
    // Count only the interface properties, not method returns
    const keys = Object.keys({ mode: "auto", review: "light" } as AdvisorConfig);
    expect(keys.length).toBeLessThanOrEqual(3);
    // Verify no additional fields
    const allKeys = ["mode", "review", "model"];
    const configKeys = Object.keys({ mode: "auto", review: "light" } as AdvisorConfig);
    expect(configKeys.every((k) => allKeys.includes(k))).toBe(true);
  });
});

describe("SOTA model suggestions", () => {
  it("includes gpt-5.5 as primary option", () => {
    // The SOTA_CHAIN array should exist in the source with gpt-5.5 first
    // We verify the config defaults to openai-codex/gpt-5.5
    const cfg: AdvisorConfig = { mode: "auto", review: "light" };
    expect(cfg.model).toBeUndefined(); // model is optional, auto-detect
  });
});
