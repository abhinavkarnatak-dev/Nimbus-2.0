import { isAbsolute, resolve } from "node:path";

// Match the existing E2B execution-server protocol baseline.
export const CODEX_VERSION = "0.160.0";

export function runtimeConfiguration(environment, root) {
  if (!environment.DATABASE_URL?.trim())
    throw new Error("DATABASE_URL is required");
  const port = Number(environment.PORT ?? "3000");
  const executorPort = Number(environment.EXECUTOR_PORT ?? "3020");
  for (const value of [port, executorPort]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 65535)
      throw new Error("Invalid runtime port");
  }
  if (port === executorPort)
    throw new Error("Web and executor ports must differ");
  const origin = new URL(environment.AUTH_URL ?? "");
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("AUTH_URL must be the public HTTPS origin");
  if (environment.NIMBUS_DEVICE_AUTH_ENABLED !== "true")
    throw new Error(
      "Set NIMBUS_DEVICE_AUTH_ENABLED=true only after reviewing the documented hosted-auth limitation",
    );
  if (!/^[a-f0-9]{64}$/.test(environment.NIMBUS_EXECUTOR_SECRET ?? ""))
    throw new Error(
      "NIMBUS_EXECUTOR_SECRET must be a random 64-character lowercase hex secret",
    );
  // The credential home lives on an ephemeral container filesystem, so this key
  // is what lets saved Codex connections survive a restart. A per-deploy key
  // would make every stored credential unreadable, which is the bug it prevents.
  if (!/^[a-f0-9]{64}$/.test(environment.NIMBUS_CREDENTIAL_KEY ?? ""))
    throw new Error(
      "NIMBUS_CREDENTIAL_KEY must be a random 64-character lowercase hex secret",
    );
  const home = environment.NIMBUS_CODEX_HOME;
  if (!home || !isAbsolute(home))
    throw new Error(
      "NIMBUS_CODEX_HOME must be an absolute credential-directory path",
    );
  const storageMode = environment.NIMBUS_STORAGE_MODE ?? "persistent";
  if (!["persistent", "ephemeral"].includes(storageMode))
    throw new Error("NIMBUS_STORAGE_MODE must be persistent or ephemeral");
  const executable =
    environment.CODEX_EXECUTABLE ??
    resolve(root, ".nimbus-tools/node_modules/.bin/codex");
  const shared = {
    NODE_ENV: "production",
    NIMBUS_CODING_PROVIDER: "connected",
    NIMBUS_EXECUTOR_SECRET: environment.NIMBUS_EXECUTOR_SECRET,
    NIMBUS_WEB_INTERNAL_URL: `http://127.0.0.1:${port}`,
    NIMBUS_EXECUTOR_URL: `http://127.0.0.1:${executorPort}`,
  };
  // The executor doesn't inherit Google/GitHub secrets or server-side user auth files.
  const executorEnvironment = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) =>
        [
          "PATH",
          "HOME",
          "LANG",
          "TMPDIR",
          "DATABASE_URL",
          "DATABASE_POOL_SIZE",
          "E2B_API_KEY",
          "E2B_TEMPLATE_ID",
          "E2B_DOMAIN",
          "EXECUTOR_PORT",
        ].includes(key) ||
        key.startsWith("POSTHOG_") ||
        key.startsWith("OTEL_"),
    ),
  );
  return {
    storageMode,
    port,
    executorPort,
    executable,
    webEnvironment: { ...environment, ...shared, CODEX_EXECUTABLE: executable },
    executorEnvironment: {
      ...executorEnvironment,
      ...shared,
      EXECUTOR_PORT: String(executorPort),
      EXECUTOR_HOST: "127.0.0.1",
    },
  };
}
