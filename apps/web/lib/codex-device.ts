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
}

const registry = globalThis as typeof globalThis & {
  nimbusDeviceConnections?: Map<string, Connection>;
  nimbusDeviceOperations?: Map<string, Promise<unknown>>;
  nimbusDeviceInitializations?: Set<string>;
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
      "The execution adapter was updated. Disconnect and reconnect Codex once in Settings > Connections.",
    );
  return connection.provider;
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
    current.ready = current.provider.start();
    try {
      await current.ready;
    } catch {
      await current.provider.stop();
      connections.delete(key);
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

async function readConnection(key: string, start: boolean) {
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
  if (!connection.provider.isRunning) {
    if (connection.provider.hasActiveTurn)
      throw new DeviceConnectionError(
        "Codex is recovering from an interrupted turn. Retry shortly.",
      );
    await connection.provider.stop();
    connection.ready = connection.provider.start();
    try {
      await connection.ready;
    } catch {
      await connection.provider.stop();
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
  try {
    const account = await connection.provider.readDeviceAccount();
    if (account) {
      // Codex owns token refresh; a private file store survives process and server restarts.
      if (await savedCredentials(home))
        await chmod(resolve(home, "auth.json"), 0o600);
      connection.account = account;
      connection.status = "connected";
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
    if (connection?.provider.hasActiveTurn)
      throw new DeviceConnectionError(
        "Stop your current task before disconnecting Codex.",
      );
    const home = connection?.home ?? deviceHome(key);
    if (connection) {
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
