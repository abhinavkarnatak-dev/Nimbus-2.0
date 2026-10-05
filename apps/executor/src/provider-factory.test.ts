import { describe, expect, it } from "vitest";

import { createProviderConfiguration } from "./provider-factory.js";

describe("createProviderConfiguration", () => {
  it("selects the deterministic provider only when explicitly requested", () => {
    const configuration = createProviderConfiguration({
      NIMBUS_CODING_PROVIDER: "fake",
      NODE_ENV: "test",
    });

    expect(configuration.provider.kind).toBe("fake");
    expect(configuration.model).toBe("fake-codex-test-provider");
  });

  it("rejects the fake provider in production", () => {
    expect(() =>
      createProviderConfiguration({
        NIMBUS_CODING_PROVIDER: "fake",
        NODE_ENV: "production",
      }),
    ).toThrow("forbidden in production");
  });

  it("requires a short-lived token for Codex app-server", () => {
    expect(() =>
      createProviderConfiguration({ NIMBUS_CODING_PROVIDER: "codex" }),
    ).toThrow("NIMBUS_CODEX_ACCESS_TOKEN is required");
  });

  it("constructs the production provider without starting a process", () => {
    const configuration = createProviderConfiguration({
      NIMBUS_CODING_PROVIDER: "codex",
      NIMBUS_CODEX_ACCESS_TOKEN: "test-only-short-lived-token",
      NIMBUS_CODEX_MODEL: "codex-test-model",
    });

    expect(configuration.provider.kind).toBe("codex-app-server");
    expect(configuration.model).toBe("codex-test-model");
  });
});
