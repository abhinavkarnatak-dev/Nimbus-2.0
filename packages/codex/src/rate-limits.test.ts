import { describe, expect, it } from "vitest";
import { codexLimitReached, parseCodexRateLimits } from "./rate-limits.js";

describe("Codex account limits", () => {
  it("keeps bucket order fixed when the server reverses its map", () => {
    const first = parseCodexRateLimits({
      rateLimitsByLimitId: {
        codex: {},
        base_model_inference: { limitName: "gpt-reserve" },
      },
    });
    const second = parseCodexRateLimits({
      rateLimitsByLimitId: {
        base_model_inference: { limitName: "gpt-reserve" },
        codex: {},
      },
    });
    expect(first.map((limit) => limit.id)).toEqual([
      "codex",
      "base_model_inference",
    ]);
    expect(second).toEqual(first);
  });
  it("uses returned buckets and reset times without inventing counts", () => {
    const limits = parseCodexRateLimits({
      rateLimitsByLimitId: {
        codex: {
          limitName: "Codex",
          planType: "plus",
          primary: {
            usedPercent: 100,
            windowDurationMins: 300,
            resetsAt: 1791249480,
          },
          secondary: {
            usedPercent: 24,
            windowDurationMins: 10080,
            resetsAt: 1791854280,
          },
          credits: { balance: null, hasCredits: false, unlimited: false },
        },
      },
    });
    expect(limits[0]?.primary?.resetsAt).toBe(1791249480);
    expect(limits[0]?.secondary?.usedPercent).toBe(24);
    expect(codexLimitReached(limits[0]!)).toBe(true);
    expect(limits[0]?.credits?.balance).toBeNull();
  });
  it("supports the compatibility bucket and explicit limit classification", () => {
    const limits = parseCodexRateLimits({
      rateLimits: {
        limitId: "codex",
        rateLimitReachedType: "primary",
        primary: { usedPercent: 99 },
      },
    });
    expect(limits[0]?.primary?.resetsAt).toBeNull();
    expect(codexLimitReached(limits[0]!)).toBe(true);
  });
  it("never treats missing or malformed windows as zero usage", () => {
    expect(parseCodexRateLimits({})).toEqual([]);
    const limits = parseCodexRateLimits({
      rateLimits: {
        primary: { usedPercent: NaN },
        secondary: { usedPercent: -1 },
      },
    });
    expect(limits[0]?.primary).toBeNull();
    expect(limits[0]?.secondary).toBeNull();
  });
  it("prefers multi-bucket data without duplicating the legacy snapshot", () => {
    expect(
      parseCodexRateLimits({
        rateLimits: {},
        rateLimitsByLimitId: { codex: {}, review: {} },
      }),
    ).toHaveLength(2);
  });
});
