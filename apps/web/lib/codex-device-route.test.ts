import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  identity: vi.fn(),
  device: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ currentIdentity: fixture.identity }));
vi.mock("@/lib/codex-device", async () => {
  const { deviceRequestAllowed } = await import("@nimbus/codex");
  return {
    isLocalDeviceRequest: deviceRequestAllowed,
    deviceConnection: fixture.device,
    disconnectDevice: fixture.disconnect,
    DeviceConnectionError: class extends Error {},
  };
});
import { DeviceConnectionError } from "./codex-device";
import { GET, POST, DELETE } from "../app/api/codex/device/route";

function request(method = "GET", headers: Record<string, string> = {}) {
  return new Request(
    "https://nimbus.example/api/codex/device?userId=someone-else",
    {
      method,
      headers: {
        host: "nimbus.example",
        origin: "https://nimbus.example",
        ...headers,
      },
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NIMBUS_DEVICE_AUTH_ENABLED", "true");
  vi.stubEnv("AUTH_URL", "https://nimbus.example");
  fixture.identity.mockResolvedValue({
    organizationId: "org-a",
    userId: "user-a",
    role: "owner",
  });
  fixture.device.mockResolvedValue({ status: "disconnected" });
});
afterEach(() => vi.unstubAllEnvs());

describe("hosted device connection endpoint", () => {
  it("requires a signed-in user even on an enabled server", async () => {
    fixture.identity.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(fixture.device).not.toHaveBeenCalled();
  });
  it("scopes reads and writes to the authenticated identity, never request parameters", async () => {
    const read = await GET(request());
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(fixture.device).toHaveBeenCalledWith("org-a:user-a", false);
    await POST(request("POST"));
    expect(fixture.device).toHaveBeenCalledWith("org-a:user-a", true);
    await DELETE(request("DELETE"));
    expect(fixture.disconnect).toHaveBeenCalledWith("org-a:user-a");
  });
  it("blocks cross-origin writes, absent origins, and viewer mutations", async () => {
    for (const origin of ["https://evil.example", "", "http://nimbus.example"])
      expect((await POST(request("POST", { origin }))).status).toBe(403);
    fixture.identity.mockResolvedValue({
      organizationId: "org-a",
      userId: "user-a",
      role: "viewer",
    });
    expect((await DELETE(request("DELETE"))).status).toBe(403);
    expect(fixture.device).not.toHaveBeenCalled();
    expect(fixture.disconnect).not.toHaveBeenCalled();
  });
  it("does not expose upstream errors or credentials", async () => {
    fixture.device.mockRejectedValue(
      new Error("access_token=private-provider-token"),
    );
    const response = await POST(request("POST"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-provider-token");
  });
  it("returns actionable safe storage/capacity errors", async () => {
    fixture.device.mockRejectedValue(
      new DeviceConnectionError("Persistent storage is required"),
    );
    expect(await (await POST(request("POST"))).json()).toEqual({
      error: "Persistent storage is required",
    });
  });
});
