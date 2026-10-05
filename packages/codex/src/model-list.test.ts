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
});
