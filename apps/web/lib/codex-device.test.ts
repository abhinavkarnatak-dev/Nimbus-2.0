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
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  chmod: vi.fn(),
  lstat: async (path: string) => {
    if (path.endsWith("auth.json") && !fixture.saved)
      throw Object.assign(new Error("absent"), { code: "ENOENT" });
    return { isFile: () => true, isSymbolicLink: () => false };
  },
  unlink: async () => {
    fixture.saved = false;
  },
}));
vi.mock("@nimbus/codex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nimbus/codex")>()),
  CodexAppServerProvider: class {
    get hasActiveTurn() {
      return fixture.active;
    }
    get isRunning() {
      return fixture.running;
    }
    async start() {
      await fixture.launches();
      fixture.running = true;
    }
    async stop() {
      fixture.stop();
      fixture.running = false;
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
} from "./codex-device";

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  fixture.active = false;
  await disconnectDevice("unit-test-user");
  fixture.authorized = false;
  fixture.saved = false;
  vi.clearAllMocks();
  fixture.launches.mockReset();
  vi.unstubAllEnvs();
});
describe("local Codex device connection", () => {
  it("does not reserve connection capacity after a CLI startup failure", async () => {
    fixture.launches.mockRejectedValueOnce(new Error("missing binary"));
    await expect(deviceConnection("unit-test-user", true)).rejects.toThrow(
      "CLI could not start",
    );
    expect(await deviceConnection("unit-test-user", true)).toMatchObject({
      status: "pending",
    });
  });
  it("enforces the process cap across concurrent identities", async () => {
    vi.stubEnv("NIMBUS_CODEX_MAX_CONNECTIONS", "1");
    const results = await Promise.allSettled([
      deviceConnection("unit-test-user", true),
      deviceConnection("other-unit-test-user", true),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await disconnectDevice("other-unit-test-user");
  });
  it("recovers a stopped authenticated process without issuing a new code", async () => {
    await deviceConnection("unit-test-user", true);
    fixture.saved = true;
    fixture.authorized = true;
    await deviceConnection("unit-test-user");
    fixture.running = false;
    expect(await deviceConnection("unit-test-user")).toMatchObject({
      status: "connected",
    });
    expect(fixture.start).toHaveBeenCalledOnce();
  });
  it("expires abandoned codes and starts a fresh login only on explicit retry", async () => {
    vi.useFakeTimers();
    await deviceConnection("unit-test-user", true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await deviceConnection("unit-test-user")).toEqual({
      status: "expired",
    });
    expect(fixture.cancel).toHaveBeenCalledOnce();
    await deviceConnection("unit-test-user", true);
    expect(fixture.start).toHaveBeenCalledTimes(2);
  });
  it("does not disconnect a user during an active turn", async () => {
    await deviceConnection("unit-test-user", true);
    fixture.active = true;
    await expect(disconnectDevice("unit-test-user")).rejects.toThrow(
      "Stop your current task",
    );
    expect(fixture.logout).not.toHaveBeenCalled();
  });
  it("requires persistent storage for an explicitly enabled server connection", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NIMBUS_DEVICE_AUTH_ENABLED", "true");
    vi.stubEnv("NIMBUS_CODEX_HOME", "");
    await expect(deviceConnection("unit-test-user", true)).rejects.toThrow(
      "persistent storage",
    );
  });
  it("serializes simultaneous connect requests into one code", async () => {
    const result = await Promise.all([
      deviceConnection("unit-test-user", true),
      deviceConnection("unit-test-user", true),
    ]);
    expect(result[0]).toEqual(result[1]);
    expect(fixture.start).toHaveBeenCalledOnce();
  });
  it("restores saved credentials without starting another device login", async () => {
    fixture.saved = true;
    fixture.authorized = true;
    expect(await deviceConnection("unit-test-user")).toMatchObject({
      status: "connected",
    });
    expect(fixture.start).not.toHaveBeenCalled();
    await disconnectDevice("unit-test-user");
    expect(fixture.logout).toHaveBeenCalledOnce();
    expect(await deviceConnection("unit-test-user")).toEqual({
      status: "disconnected",
    });
  });
  it("starts one device login and preserves the code across browser refresh", async () => {
    const first = await deviceConnection("unit-test-user", true);
    expect(first).toMatchObject({
      status: "pending",
      userCode: "TEST-1234",
      verificationUrl: "https://auth.openai.com/codex/device",
    });
    expect(await deviceConnection("unit-test-user", true)).toEqual(first);
    expect(fixture.start).toHaveBeenCalledTimes(1);
  });
  it("reports connected only after Codex confirms the account and returns its catalog", async () => {
    await deviceConnection("unit-test-user", true);
    fixture.authorized = true;
    expect(await deviceConnection("unit-test-user")).toMatchObject({
      status: "connected",
      models: [{ id: "returned-by-codex" }],
    });
  });
  it("does not expose another user's pending code", async () => {
    await deviceConnection("unit-test-user", true);
    expect(await deviceConnection("other-unit-test-user")).toEqual({
      status: "disconnected",
    });
  });
  it("cancels pending login and disconnects", async () => {
    await deviceConnection("unit-test-user", true);
    await disconnectDevice("unit-test-user");
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(await deviceConnection("unit-test-user")).toEqual({
      status: "disconnected",
    });
  });
  it("rejects public hosts, tunnels, and production", () => {
    const local = new Request("http://localhost:3000", {
      headers: { host: "localhost:3000" },
    });
    expect(isLocalDeviceRequest(local)).toBe(true);
    expect(
      isLocalDeviceRequest(
        new Request("http://localhost:3000", {
          headers: {
            host: "localhost:3000",
            "x-forwarded-host": "localhost:3000",
          },
        }),
      ),
    ).toBe(true);
    expect(
      isLocalDeviceRequest(
        new Request("https://nimbus.example", {
          headers: { host: "nimbus.example" },
        }),
      ),
    ).toBe(false);
    expect(
      isLocalDeviceRequest(
        new Request("http://localhost:3000", {
          headers: { host: "localhost:3000", "cf-connecting-ip": "1.2.3.4" },
        }),
      ),
    ).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(isLocalDeviceRequest(local)).toBe(false);
  });
});
