import { describe, expect, it } from "vitest";
import {
  preferredCodexEffort,
  preferredCodexModel,
  reserveCodexModel,
} from "./model-policy.js";
import type { CodingAgentModel } from "./provider.js";
import type { CodexRateLimit } from "./rate-limits.js";
const models: CodingAgentModel[] = [
  { id: "gpt-6-sol", isDefault: true },
  {
    id: "gpt-5.6-sol",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "" },
      { reasoningEffort: "medium", description: "" },
    ],
  },
  { id: "gpt-6-luna" },
];
const bucket = (id: string, usedPercent: number): CodexRateLimit => ({
  id,
  name: id === "codex" ? "codex" : "gpt-reserve",
  primary: { usedPercent, resetsAt: null, windowDurationMins: 300 },
  secondary: null,
  reachedType: null,
  credits: null,
  planType: null,
});
describe("account model selection policy", () => {
  it("prefers the requested Sol generation and supported medium effort", () => {
    expect(preferredCodexModel(models)?.id).toBe("gpt-5.6-sol");
    expect(preferredCodexEffort(models[1])).toBe("medium");
    expect(preferredCodexModel(models.slice(0, 1))?.id).toBe("gpt-6-sol");
  });
  it("selects only a catalog Luna when main usage is exhausted and reserve is available", () => {
    const limits = [bucket("codex", 100), bucket("base_model_inference", 5)];
    expect(reserveCodexModel(models, models[1]!, limits).id).toBe("gpt-6-luna");
    expect(reserveCodexModel(models.slice(0, 2), models[1]!, limits).id).toBe(
      "gpt-5.6-sol",
    );
  });
  it("does not switch on unknown quota, unused main quota, or exhausted reserve", () => {
    for (const limits of [
      [],
      [bucket("codex", 20), bucket("base_model_inference", 5)],
      [bucket("codex", 100), bucket("base_model_inference", 100)],
    ])
      expect(reserveCodexModel(models, models[1]!, limits).id).toBe(
        "gpt-5.6-sol",
      );
  });
});
import { messageModelSettings } from "./model-policy.js";

describe("message model snapshots", () => {
  const task = { requestedModel: "old", requestedReasoningEffort: "high" };
  it("prefers the immutable message selection over the session default", () => {
    expect(
      messageModelSettings(
        { requestedModel: "new", requestedReasoningEffort: "medium" },
        task,
      ),
    ).toEqual({ model: "new", reasoningEffort: "medium" });
  });
  it("does not inherit an old effort when the selected model uses its default", () => {
    expect(
      messageModelSettings(
        { requestedModel: "new", requestedReasoningEffort: null },
        task,
      ),
    ).toEqual({ model: "new" });
  });
  it("preserves settings for older messages without a snapshot", () => {
    expect(messageModelSettings({}, task)).toEqual({
      model: "old",
      reasoningEffort: "high",
    });
    expect(
      messageModelSettings(
        { requestedModel: null, requestedReasoningEffort: null },
        task,
      ),
    ).toEqual({ model: "old", reasoningEffort: "high" });
  });
});
