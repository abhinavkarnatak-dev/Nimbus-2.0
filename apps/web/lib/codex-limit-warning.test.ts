import { describe, expect, it } from "vitest";
import type { CodexRateLimit } from "@nimbus/codex/rate-limits";
import { codexLimitWarning } from "./codex-limit-warning";

const bucket = (usedPercent: number): CodexRateLimit => ({
  id: "codex",
  name: "Codex",
  planType: null,
  credits: null,
  reachedType: null,
  primary: { usedPercent, windowDurationMins: 300, resetsAt: null },
  secondary: null,
});
describe("header limit warning", () => {
  it("shows no warning for unknown limits or usage below 90 percent", () => {
    expect(codexLimitWarning([])).toBeNull();
    expect(codexLimitWarning([bucket(89)])).toBeNull();
  });
  it("warns at 90 percent without calling the limit exhausted", () => {
    expect(codexLimitWarning([bucket(90)])).toEqual({
      severity: "near",
      label: "Codex limit nearly reached",
    });
  });
  it("gives exhaustion priority over other nearly-used buckets", () => {
    expect(codexLimitWarning([bucket(95), bucket(100)])?.severity).toBe(
      "exhausted",
    );
  });
  it("includes secondary windows and official limit-reached classifications", () => {
    expect(
      codexLimitWarning([
        {
          ...bucket(20),
          secondary: {
            usedPercent: 98,
            windowDurationMins: 10080,
            resetsAt: null,
          },
        },
      ])?.severity,
    ).toBe("near");
    expect(
      codexLimitWarning([{ ...bucket(20), reachedType: "secondary" }])
        ?.severity,
    ).toBe("exhausted");
  });
});
