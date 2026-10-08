import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  CodexAppServerProvider,
  deviceAuthEnabled,
  deviceRequestAllowed,
  type CodingAgentModel,
} from "@nimbus/codex";
import { credentialDigest } from "./codex-credential-crypto";
import {
  readCredential,
  revokeCredential,
  writeCredential,
  type StoreOutcome,
} from "./codex-credential-store";
import { restoreCodexHome, snapshotCodexHome } from "./codex-home-snapshot";
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
  // Set while a freshly authorized sign-in still needs its durable write, and
  // used to skip redundant credential writes.
  freshLogin?: boolean;
  storedDigest?: string;
  limits?:
    | Awaited<ReturnType<CodexAppServerProvider["readRateLimits"]>>
    | undefined;
}

const registry = globalThis as typeof globalThis & {
  nimbusDeviceConnections?: Map<string, Connection>;
  nimbusDeviceOperations?: Map<string, Promise<unknown>>;
  nimbusDeviceInitializations?: Set<string>;
  nimbusDeviceProcessQueue?: Promise<void>;
  nimbusDeviceCredentialFlush?: boolean;
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

async function suspend(key: string, connection: Connection) {
  if (busy(connection)) return false;
  if (
    connection.status === "connected" &&
    !(await savedCredentials(connection.home))
  )
    return false;
  await connection.provider.stop(); // No logout: auth.json and thread files remain intact.
  // The process is idle here, so this is the cheapest safe moment to persist
  // the rotated credential and the thread files the container would otherwise lose.
  await persistAuthCredential(key, connection);
  await persistHomeSnapshot(key, connection);
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
        await suspend(key, connection);
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
        if (await suspend(otherKey, other)) running--;
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

const AUTH_FILE = "auth.json";

async function readAuthFile(home: string): Promise<Buffer | null> {
  try {
    const contents = await readFile(resolve(home, AUTH_FILE));
    return Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  } catch {
    return null;
  }
}

// Staged inside the credential directory and renamed, so no reader ever sees a
// partial file and the credential path can never become a link.
async function writeAuthFile(home: string, contents: Buffer) {
  const staging = resolve(
    home,
    "tmp",
    `auth.json.${randomBytes(8).toString("hex")}`,
  );
  await mkdir(resolve(home, "tmp"), { recursive: true, mode: 0o700 });
  await writeFile(staging, contents, { mode: 0o600 });
  await rename(staging, resolve(home, AUTH_FILE));
  await chmod(resolve(home, AUTH_FILE), 0o600);
}

// A free web service replaces the container on every restart, redeploy, and
// spin-down, so the credential file is only a cache. Restore this identity's
// saved login from the database before anything reads the credential home.
// Runs inside the identity's lock, and never overwrites an existing file or an
// in-progress sign-in.
async function ensureCredentials(key: string, home: string) {
  if (await savedCredentials(home)) return;
  try {
    const snapshot = await readCredential(key, "home");
    if (snapshot) await restoreCodexHome(home, snapshot);
    const credential = await readCredential(key, "auth");
    if (credential) await writeAuthFile(home, Buffer.from(credential, "utf8"));
  } catch {
    // Best effort: an unrestored login is the same as no saved login.
  }
}

async function persistAuthCredential(
  key: string,
  connection: Connection,
  options: { clearRevocation?: boolean } = {},
): Promise<StoreOutcome> {
  const contents = await readAuthFile(connection.home);
  if (!contents) return "skipped";
  const digest = credentialDigest(contents);
  if (!options.clearRevocation && connection.storedDigest === digest)
    return "skipped";
  connection.storedDigest = digest;
  return writeCredential(key, "auth", contents.toString("utf8"), options);
}

async function persistHomeSnapshot(key: string, connection: Connection) {
  try {
    const snapshot = await snapshotCodexHome(connection.home);
    if (snapshot) await writeCredential(key, "home", snapshot);
  } catch {
    // Thread files are an optimization; never let them break a suspend.
  }
}

// Last-resort flush for a redeploy. Every completed turn and every suspend
// already persists, so this is deliberately best effort and bounded: it must
// never hold process exit open.
function registerCredentialFlush() {
  if (registry.nimbusDeviceCredentialFlush) return;
  registry.nimbusDeviceCredentialFlush = true;
  const flush = () => {
    const pending = [...connections.entries()].map(
      async ([key, connection]) => {
        if (connection.status !== "connected") return;
        await persistAuthCredential(key, connection);
        await persistHomeSnapshot(key, connection);
      },
    );
    const deadline = new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      if (typeof timer.unref === "function") timer.unref();
    });
    void Promise.race([Promise.allSettled(pending), deadline]).catch(() => {});
  };
  process.on("SIGTERM", flush);
  process.on("SIGINT", flush);
}

registerCredentialFlush();

// A suspended connection keeps its saved credential file, so it costs one map
// entry rather than a process. Evicting the least recently used one keeps the
// retained-connection cap from locking a new identity out permanently.
async function evictIdleConnection(): Promise<boolean> {
  let candidate: { key: string; connection: Connection } | undefined;
  for (const [key, connection] of connections) {
    if (
      connection.provider.isRunning ||
      operations.has(key) ||
      busy(connection)
    )
      continue;
    if (
      !candidate ||
      (connection.lastUsedAt ?? 0) < (candidate.connection.lastUsedAt ?? 0)
    )
      candidate = { key, connection };
  }
  if (!candidate) return false;
  if (candidate.connection.idleTimeout)
    clearTimeout(candidate.connection.idleTimeout);
  connections.delete(candidate.key);
  return true;
}

async function createConnection(key: string, home: string) {
  const limit = Number(process.env.NIMBUS_CODEX_MAX_CONNECTIONS ?? "10");
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Invalid Codex connection limit");
  if (
    new Set([...connections.keys(), ...initializing]).size >= limit &&
    !(await evictIdleConnection())
  )
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
