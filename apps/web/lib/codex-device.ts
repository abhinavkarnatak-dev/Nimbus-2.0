import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { CodexAppServerProvider, type CodingAgentModel } from "@nimbus/codex";

interface Connection {
  provider: CodexAppServerProvider;
  ready: Promise<void>;
  status: "disconnected" | "pending" | "connected" | "failed" | "expired";
  login?: { loginId: string; verificationUrl: string; userCode: string };
  expiresAt?: number;
  account?: { email: string | null; planType: string | null };
  models?: readonly CodingAgentModel[];
  modelsFetchedAt?: number;
  modelRefresh?: Promise<readonly CodingAgentModel[]>;
  timeout?: NodeJS.Timeout;
  starting?: Promise<void>;
}

const registry = globalThis as typeof globalThis & {
  nimbusDeviceConnections?: Map<string, Connection>;
};
const connections = (registry.nimbusDeviceConnections ??= new Map());

export async function connectedDeviceProvider(key: string) {
  const state = await deviceConnection(key);
  const connection = connections.get(key);
  if (state.status !== "connected" || !connection)
    throw new Error(
      "Reconnect Codex in Settings > Connections before running a task",
    );
  if (
    connection.provider.configurationVersion !== 4 ||
    typeof connection.provider.verifyWorkspace !== "function"
  )
    throw new Error(
      "The execution adapter was updated. Disconnect and reconnect Codex once in Settings > Connections to load repository access support.",
    );
  return connection.provider;
}

export function isLocalDeviceRequest(request: Request) {
  const host = request.headers.get("host") ?? "";
  return (
    process.env.NODE_ENV !== "production" &&
    !request.headers.has("cf-connecting-ip") &&
    (!request.headers.has("x-forwarded-host") ||
      request.headers.get("x-forwarded-host") === host) &&
    /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
  );
}

export async function deviceConnection(key: string, start = false) {
  let connection = connections.get(key);
  if (!connection && start) {
    if (connections.size >= 5)
      throw new Error("Local connection limit reached");
    const home = resolve(
      process.cwd(),
      "../../.nimbus/codex-device",
      createHash("sha256").update(key).digest("hex"),
    );
    const current: Connection = {
      provider: undefined as unknown as CodexAppServerProvider,
      ready: Promise.resolve(),
      status: "disconnected",
    };
    current.provider = new CodexAppServerProvider({
      localDeviceAuth: { home },
      ...(process.platform === "win32"
        ? {
            codexExecutable: resolve(
              process.env.APPDATA ?? "",
              "npm/node_modules/@openai/codex/node_modules/@openai",
              `codex-win32-${process.arch}`,
              "vendor",
              process.arch === "arm64"
                ? "aarch64-pc-windows-msvc"
                : "x86_64-pc-windows-msvc",
              "bin/codex.exe",
            ),
          }
        : {}),
      onLoginCompleted(loginId, success) {
        if (current.login?.loginId === loginId) {
          current.status = success ? "pending" : "failed";
          if (!success && current.timeout) clearTimeout(current.timeout);
        }
      },
    });
    connections.set(key, current);
    current.ready = (async () => {
      await mkdir(resolve(home, "tmp"), { recursive: true });
      await current.provider.start();
    })().catch(async () => {
      current.status = "failed";
      await current.provider.stop();
    });
    connection = current;
  }
  if (!connection) return { status: "disconnected" };
  await connection.ready;
  if (connection.status === "pending" || connection.status === "connected") {
    try {
      const account = await connection.provider.readDeviceAccount();
      if (account) {
        if (
          !connection.modelsFetchedAt ||
          Date.now() - connection.modelsFetchedAt > 60_000
        ) {
          const current = connection;
          current.modelRefresh ??= current.provider.listModels();
          try {
            current.models = await current.modelRefresh;
            current.modelsFetchedAt = Date.now();
          } finally {
            delete current.modelRefresh;
          }
        }
        connection.account = account;
        connection.status = "connected";
        if (connection.timeout) clearTimeout(connection.timeout);
      }
    } catch {
      connection.status = "failed";
    }
  }
  if (start && !["pending", "connected"].includes(connection.status)) {
    const current = connection;
    current.starting ??= (async () => {
      if (current.status === "failed" || current.status === "expired") {
        await current.provider.stop();
        await current.provider.start();
      }
      delete current.models;
      delete current.modelsFetchedAt;
      delete current.account;
      if (current.timeout) clearTimeout(current.timeout);
      current.login = await current.provider.startDeviceLogin();
      current.status = "pending";
      current.expiresAt = Date.now() + 10 * 60_000;
      current.timeout = setTimeout(() => {
        if (current.status !== "pending") return;
        current.status = "expired";
        void current.provider
          .cancelDeviceLogin(current.login!.loginId)
          .catch(() => {})
          .finally(() => current.provider.stop());
      }, 10 * 60_000);
      current.timeout.unref();
    })();
    try {
      await current.starting;
    } finally {
      delete current.starting;
    }
  }
  return {
    status: connection.status,
    ...(connection.status === "pending" && connection.login
      ? {
          verificationUrl: connection.login.verificationUrl,
          userCode: connection.login.userCode,
          expiresAt: connection.expiresAt,
        }
      : {}),
    ...(connection.status === "connected"
      ? { account: connection.account, models: connection.models }
      : {}),
  };
}

export async function disconnectDevice(key: string) {
  const connection = connections.get(key);
  if (!connection) return;
  if (connection.timeout) clearTimeout(connection.timeout);
  if (connection.login && connection.status === "pending")
    await connection.provider
      .cancelDeviceLogin(connection.login.loginId)
      .catch(() => {});
  await connection.provider.stop();
  connections.delete(key);
}
