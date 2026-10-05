import { describe, expect, it } from "vitest";

import { createObservability, validateSafeMetadata } from "./index.js";

describe("PostHog privacy boundary", () => {
  it("allows only aggregate operational metadata", () => {
    expect(
      validateSafeMetadata({
        category: "task",
        status: "completed",
        durationMs: 40,
      }),
    ).toEqual({ category: "task", status: "completed", durationMs: 40 });
  });

  it("rejects source code and prompt-shaped properties", () => {
    expect(() => validateSafeMetadata({ prompt: "private" })).toThrow();
    expect(() => validateSafeMetadata({ sourceCode: "secret" })).toThrow();
  });

  it("uses a safe no-op when PostHog is not configured", async () => {
    const telemetry = createObservability({});
    expect(() =>
      telemetry.capture("tenant_hash", "task_completed", {
        status: "completed",
      }),
    ).not.toThrow();
    await telemetry.shutdown();
  });
});
