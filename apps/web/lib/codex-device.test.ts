import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  authorized: false,
  start: vi.fn(),
  cancel: vi.fn(),
  stop: vi.fn(),
  logout: vi.fn(),
  saved: false,
  running: true,
  active: false,
  launches: vi.fn(),
  contents: new Map<string, string>(),
}));
// A tiny in-memory credential directory: "saved" mirrors auth.json, and the
// content map lets a test prove what was restored.
const isAuth = (path: string) => path.endsWith("auth.json");
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  chmod: vi.fn(),
  rename: async (from: string, to: string) => {
    const value = fixture.contents.get(from);
    if (value === undefined)
      throw Object.assign(new Error("absent"), { code: "ENOENT" });
    fixture.contents.delete(from);
    fixture.contents.set(to, value);
    if (isAuth(to)) fixture.saved = true;
  },
  readFile: async (path: string) => {
    const value = fixture.contents.get(path);
    if (value !== undefined) return Buffer.from(value);
    if (isAuth(path) && fixture.saved)
      return Buffer.from('{"stub":"credential"}');
    throw Object.assign(new Error("absent"), { code: "ENOENT" });
  },
  writeFile: async (
    path: string,
    data: string,
    options?: { flag?: string },
  ) => {
    if (options?.flag === "wx" && fixture.contents.has(path))
      throw Object.assign(new Error("exists"), { code: "EEXIST" });
    fixture.contents.set(path, String(data));
    if (isAuth(path)) fixture.saved = true;
  },
  readdir: async () => [],
  lstat: async (path: string) => {
    if (isAuth(path) && !fixture.saved)
      throw Object.assign(new Error("absent"), { code: "ENOENT" });
    return {
      isFile: () => true,
      isSymbolicLink: () => false,
      size: 16,
      mtimeMs: 1,
    };
  },
  unlink: async (path: string) => {
    fixture.contents.delete(path);
    if (isAuth(path)) fixture.saved = false;
  },
}));
const store = vi.hoisted(() => ({
  blobs: new Map<string, { blob: string; revoked: boolean }>(),
  reads: 0,
  failRead: false,
}));
vi.mock("./codex-credential-store", () => ({
  readCredential: async (accountKey: string, kind: string) => {
    store.reads += 1;
    if (store.failRead) throw new Error("store unavailable");
    const entry = store.blobs.get(`${kind}:${accountKey}`);
    if (!entry || entry.revoked) return null;
    return entry.blob;
  },
  writeCredential: async (
    accountKey: string,
    kind: string,
    plaintext: string,
    options?: { clearRevocation?: boolean },
  ) => {
    const entry = store.blobs.get(`${kind}:${accountKey}`);
    if (entry?.revoked && !options?.clearRevocation) return "skipped";
    store.blobs.set(`${kind}:${accountKey}`, {
      blob: plaintext,
      revoked: false,
    });
    return "ok";
  },
  revokeCredential: async (accountKey: string) => {
    for (const [key, entry] of store.blobs)
      if (key.endsWith(`:${accountKey}`)) entry.revoked = true;
    return "ok";
  },
}));
const snapshot = vi.hoisted(() => ({
  write: vi.fn(async () => '{"version":1,"files":{}}'),
  restore: vi.fn(async () => 1),
}));
vi.mock("./codex-home-snapshot", () => ({
  snapshotCodexHome: snapshot.write,
  restoreCodexHome: snapshot.restore,
}));
vi.mock("@nimbus/codex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nimbus/codex")>()),
  CodexAppServerProvider: class {
    running = false;
    configurationVersion = 4;
    verifyWorkspace() {}
    get hasActiveTurn() {
      return fixture.active;
    }
    get isRunning() {
      return fixture.running && this.running;
    }
    async start() {
      await fixture.launches();
      fixture.running = true;
      this.running = true;
    }
    async stop() {
      fixture.stop();
      this.running = false;
    }
    async logoutDevice() {
      fixture.logout();
    }
    async startDeviceLogin() {
      fixture.start();
      return {
        loginId: "test-login",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "TEST-1234",
      };
    }
    async readDeviceAccount() {
      return fixture.authorized
        ? { email: "user@example.invalid", planType: "plus" }
        : null;
    }
    async listModels() {
      return [{ id: "returned-by-codex" }];
    }
    async cancelDeviceLogin() {
      fixture.cancel();
    }
  },
}));
import {
  deviceConnection,
  disconnectDevice,
  isLocalDeviceRequest,
  withDeviceProvider,
} from "./codex-device";

// Simulate the container being replaced: the filesystem is gone, Postgres is not.
function replaceContainer() {
  fixture.contents.clear();
  fixture.saved = false;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  fixture.active = false;
  store.failRead = false;
  for (const key of [
    "unit-test-user",
    "other-unit-test-user",
    "third-unit-test-user",
  ])
    await disconnectDevice(key).catch(() => {});
  fixture.authorized = false;
  fixture.saved = false;
  fixture.running = true;
  fixture.contents.clear();
  store.blobs.clear();
  store.reads = 0;
  vi.clearAllMocks();
  fixture.launches.mockReset();
  snapshot.write.mockClear();
  snapshot.restore.mockClear();
  vi.unstubAllEnvs();
});
