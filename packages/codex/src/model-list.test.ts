import { describe, expect, it } from "vitest";

import { parseModelListResult } from "./app-server-provider.js";

describe("parseModelListResult", () => {
  it("preserves server-provided model metadata", () => {
    expect(
      parseModelListResult({
        data: [
          {
            id: "account-model-a",
            displayName: "Account Model A",
            description: "Available from the current Codex catalog",
            isDefault: true,
          },
        ],
      }),
    ).toEqual([
      {
        id: "account-model-a",
        displayName: "Account Model A",
        description: "Available from the current Codex catalog",
        isDefault: true,
      },
    ]);
  });

  it("ignores malformed catalog entries", () => {
    expect(
      parseModelListResult({ models: [{ name: "missing-id" }, null] }),
    ).toEqual([]);
  });
  it("preserves model-specific effort options and hides hidden models", () => {
    expect(
      parseModelListResult({
        data: [
          {
            id: "model-a",
            defaultReasoningEffort: "high",
            supportedReasoningEfforts: [
              { reasoningEffort: "high", description: "More thorough" },
              { reasoningEffort: "low", description: "Faster" },
              { description: "Malformed" },
            ],
          },
          { id: "hidden-model", hidden: true },
        ],
      }),
    ).toEqual([
      {
        id: "model-a",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [
          { reasoningEffort: "high", description: "More thorough" },
          { reasoningEffort: "low", description: "Faster" },
        ],
      },
    ]);
  });
});
