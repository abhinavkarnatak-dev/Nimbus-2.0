import { afterEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  authorized: false,
  start: vi.fn(),
  cancel: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@nimbus/codex", () => ({
  CodexAppServerProvider: class {
    async start() {}
    async stop() {
      fixture.stop();
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
  await disconnectDevice("unit-test-user");
  fixture.authorized = false;
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describe("local Codex device connection", () => {
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
