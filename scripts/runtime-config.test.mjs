import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runtimeConfiguration } from "./runtime-config.mjs";

const environment = {
  PORT: "10000",
  AUTH_URL: "https://nimbus.example",
  NIMBUS_DEVICE_AUTH_ENABLED: "true",
  NIMBUS_EXECUTOR_SECRET: "a".repeat(64),
  NIMBUS_CREDENTIAL_KEY: "c".repeat(64),
  NIMBUS_CODEX_HOME: "/persistent/codex",
  DATABASE_URL: "postgres://test",
  AUTH_GOOGLE_SECRET: "private",
  GITHUB_APP_PRIVATE_KEY_BASE64: "private",
  E2B_API_KEY: "sandbox",
  POSTHOG_PROJECT_TOKEN: "metrics",
};
describe("combined runtime configuration", () => {
  it("supports explicitly accepted temporary storage without a paid disk", () => {
    const config = runtimeConfiguration(
      { ...environment, NIMBUS_STORAGE_MODE: "ephemeral" },
      "/app",
    );
    assert.equal(config.storageMode, "ephemeral");
  });
  it("uses one connected-user provider and keeps OAuth secrets out of the executor", () => {
    const config = runtimeConfiguration(environment, "/app");
    assert.equal(
      config.webEnvironment.NIMBUS_WEB_INTERNAL_URL,
      "http://127.0.0.1:10000",
    );
    assert.equal(
      config.executorEnvironment.NIMBUS_CODING_PROVIDER,
      "connected",
    );
    assert.equal(config.executorEnvironment.AUTH_GOOGLE_SECRET, undefined);
    assert.equal(
      config.executorEnvironment.GITHUB_APP_PRIVATE_KEY_BASE64,
      undefined,
    );
    assert.equal(config.executorEnvironment.NIMBUS_CODEX_HOME, undefined);
    assert.equal(config.executorEnvironment.E2B_API_KEY, "sandbox");
    // The credential key stays in the web process.
    assert.equal(config.executorEnvironment.NIMBUS_CREDENTIAL_KEY, undefined);
  });
  it("fails closed for missing opt-in, storage, shared secret, and invalid ports", () => {
    for (const overrides of [
      { NIMBUS_STORAGE_MODE: "unknown" },
      { DATABASE_URL: "" },
      { NIMBUS_DEVICE_AUTH_ENABLED: "false" },
      { NIMBUS_CODEX_HOME: "relative" },
      { NIMBUS_EXECUTOR_SECRET: "short" },
      { NIMBUS_CREDENTIAL_KEY: "short" },
      { NIMBUS_CREDENTIAL_KEY: "" },
      { AUTH_URL: "http://nimbus.example" },
      { PORT: "3020" },
      { EXECUTOR_PORT: "NaN" },
    ])
      assert.throws(() =>
        runtimeConfiguration({ ...environment, ...overrides }, "/app"),
      );
  });
});
