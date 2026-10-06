import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ connected: false }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
}));
vi.mock("./codex-device", () => ({
  isLocalDeviceRequest: () => true,
  deviceConnection: async (key: string) =>
    fixture.connected && key === "org-a:user-a"
      ? {
          status: "connected",
          models: [
            {
              id: "live-account-model",
              defaultReasoningEffort: "high",
              supportedReasoningEfforts: [
                { reasoningEffort: "high", description: "Thorough" },
              ],
            },
          ],
        }
      : { status: "disconnected" },
}));

import {
  isSelectableModel,
  isSelectableEffort,
  selectableModels,
  getSelectableCodexModels,
} from "./codex-models";

describe("isSelectableModel", () => {
  const catalog = [
    { id: "model-a", label: "Model A", isDefault: true },
    { id: "model-b", label: "Model B", isDefault: false },
  ];

  it("accepts a model returned by the account catalog", () => {
    expect(isSelectableModel(catalog, "model-b")).toBe(true);
  });

  it("rejects model names supplied outside the account catalog", () => {
    expect(isSelectableModel(catalog, "invented-model")).toBe(false);
  });
  it("keeps account-provided efforts and rejects unsupported selections", () => {
    const [model] = selectableModels([
      {
        id: "account-model",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [
          { reasoningEffort: "high", description: "Thorough" },
        ],
      },
    ]);
    expect(model!.defaultReasoningEffort).toBe("high");
    expect(isSelectableEffort(model!, "high")).toBe(true);
    expect(isSelectableEffort(model!, "invented")).toBe(false);
    expect(isSelectableEffort(catalog[0]!, "high")).toBe(false);
  });
  it("uses the connected account instead of the simulation catalog", async () => {
    vi.stubEnv("NIMBUS_CODING_PROVIDER", "fake");
    fixture.connected = true;
    try {
      const models = await getSelectableCodexModels("user-a", "org-a");
      expect(models.map((model) => model.id)).toEqual(["live-account-model"]);
      expect(models[0]!.defaultReasoningEffort).toBe("high");
      expect((await getSelectableCodexModels("user-a", "org-b"))[0]!.id).toBe(
        "fake-codex-test-provider",
      );
    } finally {
      fixture.connected = false;
      vi.unstubAllEnvs();
    }
  });
});
