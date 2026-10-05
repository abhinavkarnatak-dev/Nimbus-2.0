import { describe, expect, it } from "vitest";

import { isSelectableModel } from "./codex-models";

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
});
