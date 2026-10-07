import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  CodexAppServerProvider,
  deviceAuthEnabled,
  deviceRequestAllowed,
  type CodingAgentModel,
} from "@nimbus/codex";
import { nimbusRepositoryRoot } from "./repository-root";

interface Connection {
  provider: CodexAppServerProvider;
  home: string;
  ready: Promise<void>;
  status: "disconnected" | "pending" | "connected" | "failed" | "expired";
  login?: { loginId: string; verificationUrl: string; userCode: string };
  expiresAt?: number;
  account?: { email: string | null; planType: string | null };
  models?: readonly CodingAgentModel[];
  modelsFetchedAt?: number;
  timeout?: NodeJS.Timeout;
  idleTimeout?: NodeJS.Timeout;
  lastUsedAt?: number;
  leases?: number;
  limits?:
    | Awaited<ReturnType<CodexAppServerProvider["readRateLimits"]>>
    | undefined;
}

const registry = globalThis as typeof globalThis & {
  nimbusDeviceConnections?: Map<string, Connection>;
  nimbusDeviceOperations?: Map<string, Promise<unknown>>;
  nimbusDeviceInitializations?: Set<string>;
  nimbusDeviceProcessQueue?: Promise<void>;
};
const connections = (registry.nimbusDeviceConnections ??= new Map());
const operations = (registry.nimbusDeviceOperations ??= new Map());
const initializing = (registry.nimbusDeviceInitializations ??= new Set());

export class DeviceConnectionError extends Error {}

// Serialize polls, connect, and disconnect for one identity. Other users are independent.
async function exclusive<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const next = (operations.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(operation);
  operations.set(key, next);
  try {
    return await next;
  } finally {
    if (operations.get(key) === next) operations.delete(key);
  }
}

export async function connectedDeviceProvider(key: string, wake = true) {
  const state = await exclusive(key, () => readConnection(key, false, wake));
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
      "The execution adapter was updated. Disconnect and reconnect Codex once in Settings > Connections.",
    );
  return connection.provider;
}

// Usage polls never launch a CLI. Return the last snapshot when idle.
export async function deviceUsageProvider(key: string) {
  await connectedDeviceProvider(key, false);
  const connection = connections.get(key)!;
  return {
    readRateLimits: () =>
      exclusive(key, async () => {
        if (connection.provider.isRunning)
          connection.limits = await connection.provider.readRateLimits();
        if (!connection.limits)
          throw new DeviceConnectionError(
            "Account limits will refresh when Codex is active",
          );
        return connection.limits;
      }),
  };
}

function busy(connection: Connection) {
  return Boolean(
    connection.leases ||
      connection.provider.hasActiveTurn ||
      connection.provider.hasPendingRequests ||
      connection.status === "pending",
  );
}

async function suspend(connection: Connection) {
  if (busy(connection)) return false;
  if (
    connection.status === "connected" &&
    !(await savedCredentials(connection.home))
  )
    return false;
  await connection.provider.stop(); // No logout: auth.json and thread files remain intact.
  return true;
}

function scheduleIdle(key: string, connection: Connection) {
  if (connection.idleTimeout) clearTimeout(connection.idleTimeout);
  const timeout = Number(process.env.NIMBUS_CODEX_IDLE_MS ?? "45000");
  connection.idleTimeout = setTimeout(
    () => {
      void exclusive(key, async () => {
        if (connections.get(key) !== connection) return;
        if (busy(connection)) {
          scheduleIdle(key, connection);
          return;
        }
        await suspend(connection);
      }).catch(() => {});
    },
    Number.isFinite(timeout) && timeout >= 1000 ? timeout : 45000,
  );
  connection.idleTimeout.unref();
}

async function startProcess(key: string, connection: Connection) {
  const operation = (registry.nimbusDeviceProcessQueue ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const cap = Number(process.env.NIMBUS_CODEX_MAX_PROCESSES ?? "1");
      if (!Number.isSafeInteger(cap) || cap < 1)
        throw new DeviceConnectionError("Invalid Codex process limit");
      let running = [...connections.values()].filter(
        (entry) => entry !== connection && entry.provider.isRunning,
      ).length;
      for (const [otherKey, other] of connections) {
        if (running < cap) break;
        if (
          other === connection ||
          !other.provider.isRunning ||
          operations.has(otherKey) ||
          busy(other)
        )
          continue;
        if (await suspend(other)) running--;
      }
      if (running >= cap)
        throw new DeviceConnectionError(
          "Codex is busy with another task or sign-in. Your saved login is unchanged; retry shortly.",
        );
      await connection.provider.start();
      connection.lastUsedAt = Date.now();
      scheduleIdle(key, connection);
    });
  registry.nimbusDeviceProcessQueue = operation;
  await operation;
}

// Keep a process pinned through the entire response stream, including gaps
// between RPC calls. Release on completion, error, or client cancellation.
export async function withDeviceProvider(
  key: string,
  action: (provider: CodexAppServerProvider) => Promise<Response>,
) {
  const connection = await exclusive(key, async () => {
    const state = await readConnection(key, false, true);
    const current = connections.get(key);
    if (state.status !== "connected" || !current)
      throw new DeviceConnectionError("Reconnect Codex before running a task");
    if (
      current.provider.configurationVersion !== 4 ||
      typeof current.provider.verifyWorkspace !== "function"
    )
      throw new DeviceConnectionError(
        "Reconnect Codex after the execution adapter update",
      );
    current.leases = (current.leases ?? 0) + 1;
    return current;
  });
  const provider = connection.provider;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    connection.leases = Math.max(0, (connection.leases ?? 1) - 1);
    connection.lastUsedAt = Date.now();
    scheduleIdle(key, connection);
  };
  try {
    const response = await action(provider);
    if (
      !response.body ||
      !response.headers.get("content-type")?.includes("application/x-ndjson")
    ) {
      release();
      return response;
    }
    const reader = response.body.getReader();
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              release();
              controller.close();
            } else controller.enqueue(next.value);
          } catch (error) {
            release();
            controller.error(error);
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } finally {
            release();
          }
        },
      }),
      { status: response.status, headers: response.headers },
    );
  } catch (error) {
    release();
    throw error;
  }
}

// Retain the existing export for callers; hosted requests require explicit opt-in + AUTH_URL.
export const isLocalDeviceRequest = deviceRequestAllowed;

function deviceHome(key: string) {
  const configured = process.env.NIMBUS_CODEX_HOME?.trim();
  if (configured && !isAbsolute(configured))
    throw new DeviceConnectionError(
      "NIMBUS_CODEX_HOME must be an absolute path",
    );
  if (process.env.NODE_ENV === "production" && !configured)
    throw new DeviceConnectionError(
      "NIMBUS_CODEX_HOME must point to persistent storage on the server",
    );
  return resolve(
    configured ?? resolve(nimbusRepositoryRoot(), ".nimbus/codex-device"),
    createHash("sha256").update(key).digest("hex"),
  );
}

async function savedCredentials(home: string) {
  try {
    const info = await lstat(resolve(home, "auth.json"));
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Invalid Codex credential storage");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function createConnection(key: string, home: string) {
  const limit = Number(process.env.NIMBUS_CODEX_MAX_CONNECTIONS ?? "10");
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Invalid Codex connection limit");
  if (new Set([...connections.keys(), ...initializing]).size >= limit)
    throw new DeviceConnectionError(
      "Codex connection capacity reached. Try again after another connection is closed.",
    );
  initializing.add(key);
  try {
    await mkdir(home, { recursive: true, mode: 0o700 });
    if ((await lstat(home)).isSymbolicLink())
      throw new Error("Invalid Codex credential directory");
    await chmod(home, 0o700);
    await mkdir(resolve(home, "tmp"), { recursive: true, mode: 0o700 });
    const current: Connection = {
      home,
      provider: undefined as unknown as CodexAppServerProvider,
      ready: Promise.resolve(),
      status: "disconnected",
    };
    current.provider = new CodexAppServerProvider({
      localDeviceAuth: { home, persistent: true },
      ...(process.env.CODEX_EXECUTABLE
        ? { codexExecutable: process.env.CODEX_EXECUTABLE }
        : process.platform === "win32"
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
        if (current.login?.loginId !== loginId) return;
        if (!success) {
          current.status = "failed";
          if (current.timeout) clearTimeout(current.timeout);
        }
      },
    });
    connections.set(key, current);
    current.ready = startProcess(key, current);
    try {
      await current.ready;
    } catch (error) {
      await current.provider.stop();
      connections.delete(key);
      if (error instanceof DeviceConnectionError) throw error;
      throw new DeviceConnectionError(
        "Codex CLI could not start. Check the server installation and CODEX_EXECUTABLE.",
      );
    }
    return current;
  } finally {
    initializing.delete(key);
  }
}

export function deviceConnection(key: string, start = false) {
  return exclusive(key, () => readConnection(key, start));
}

async function readConnection(key: string, start: boolean, wake = false) {
  if (!deviceAuthEnabled()) return { status: "disconnected" as const };
  const home = deviceHome(key);
  let connection = connections.get(key);
  // Development hot reload may retain a pre-persistence provider instance.
  if (connection && typeof connection.provider.logoutDevice !== "function") {
    if (connection.timeout) clearTimeout(connection.timeout);
    await connection.provider.stop();
    connections.delete(key);
    connection = undefined;
  }
  // Restore only this identity's saved login; GET never creates a fresh device code.
  if (!connection && (start || (await savedCredentials(home))))
    connection = await createConnection(key, home);
  if (!connection) return { status: "disconnected" as const };
  await connection.ready;
  // UI polling and model pickers must not restart an idle authenticated CLI.
  if (
    !wake &&
    connection.status === "connected" &&
    (await savedCredentials(home))
  )
    return {
      status: "connected" as const,
      account: connection.account,
      models: connection.models,
    };
  if (!connection.provider.isRunning) {
    if (connection.provider.hasActiveTurn)
      throw new DeviceConnectionError(
        "Codex is recovering from an interrupted turn. Retry shortly.",
      );
    await connection.provider.stop();
    connection.ready = startProcess(key, connection);
    try {
      await connection.ready;
    } catch (error) {
      await connection.provider.stop();
      connection.ready = Promise.resolve();
      if (error instanceof DeviceConnectionError) throw error;
      connections.delete(key);
      throw new DeviceConnectionError(
        "Codex could not restart. Check the server CLI installation.",
      );
    }
    delete connection.modelsFetchedAt;
    if (connection.status === "pending") {
      connection.status = "expired";
      delete connection.login;
    }
  }
  connection.lastUsedAt = Date.now();
  scheduleIdle(key, connection);
  try {
    const account = await connection.provider.readDeviceAccount();
    if (account) {
      // Codex owns token refresh; a private file store survives process and server restarts.
      if (await savedCredentials(home))
        await chmod(resolve(home, "auth.json"), 0o600);
      connection.account = account;
      connection.status = "connected";
      if (
        !connection.limits &&
        typeof connection.provider.readRateLimits === "function"
      )
        connection.limits = await connection.provider
          .readRateLimits()
          .catch(() => undefined);
      if (connection.timeout) clearTimeout(connection.timeout);
      delete connection.login;
      delete connection.expiresAt;
      if (
        !connection.modelsFetchedAt ||
        Date.now() - connection.modelsFetchedAt > 60_000
      ) {
        connection.models = await connection.provider.listModels();
        connection.modelsFetchedAt = Date.now();
      }
    } else if (connection.status === "connected") {
      connection.status = "disconnected";
      delete connection.account;
      delete connection.models;
    }
  } catch {
    // A model/account lookup failure must not silently start a new login or erase credentials.
    throw new DeviceConnectionError(
      "Codex could not read your connection. Retry, or reconnect if the problem persists.",
    );
  }
  if (start && !["pending", "connected"].includes(connection.status)) {
    if (connection.timeout) clearTimeout(connection.timeout);
    connection.login = await connection.provider.startDeviceLogin();
    connection.status = "pending";
    connection.expiresAt = Date.now() + 10 * 60_000;
    const current = connection;
    connection.timeout = setTimeout(() => {
      void exclusive(key, async () => {
        if (connections.get(key) !== current || current.status !== "pending")
          return;
        // Check for a last-second successful login before cancelling.
        const account = await current.provider
          .readDeviceAccount()
          .catch(() => null);
        if (account) return;
        current.status = "expired";
        await current.provider
          .cancelDeviceLogin(current.login!.loginId)
          .catch(() => {});
        delete current.login;
        await current.provider.stop();
      }).catch(() => {});
    }, 10 * 60_000);
    connection.timeout.unref();
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

export function disconnectDevice(key: string) {
  return exclusive(key, async () => {
    const connection = connections.get(key);
    if (
      connection &&
      (connection.leases ||
        connection.provider.hasActiveTurn ||
        connection.provider.hasPendingRequests)
    )
      throw new DeviceConnectionError(
        "Stop your current task before disconnecting Codex.",
      );
    const home = connection?.home ?? deviceHome(key);
    if (connection) {
      if (connection.idleTimeout) clearTimeout(connection.idleTimeout);
      if (connection.timeout) clearTimeout(connection.timeout);
      if (connection.login && connection.status === "pending")
        await connection.provider
          .cancelDeviceLogin(connection.login.loginId)
          .catch(() => {});
      if (typeof connection.provider.logoutDevice === "function")
        await connection.provider.logoutDevice().catch(() => {});
      await connection.provider.stop();
      connections.delete(key);
    }
    // Remove only this user's credential file, even if the process had already stopped.
    await unlink(resolve(home, "auth.json")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
  });
}
