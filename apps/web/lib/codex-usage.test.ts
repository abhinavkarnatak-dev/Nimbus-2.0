import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  identity: vi.fn(),
  connected: vi.fn(),
  local: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ currentIdentity: fixture.identity }));
vi.mock("@/lib/codex-device", () => ({
  deviceUsageProvider: fixture.connected,
  isLocalDeviceRequest: fixture.local,
}));
import { GET } from "../app/api/codex/usage/route";

beforeEach(() => {
  vi.resetAllMocks();
  fixture.identity.mockResolvedValue({
    organizationId: "org-a",
    userId: "user-a",
  });
  fixture.local.mockReturnValue(true);
  fixture.connected.mockResolvedValue({ readRateLimits: fixture.read });
  fixture.read.mockResolvedValue([
    { id: "codex", primary: { usedPercent: 100 } },
  ]);
});
describe("account-scoped usage endpoint", () => {
  it("explains when hot reload retained a connection without the new reader", async () => {
    fixture.connected.mockResolvedValueOnce({});
    const result = await (
      await GET(new Request("http://localhost:3000"))
    ).json();
    expect(result.status).toBe("unavailable");
    expect(result.error).toContain("Reconnect Codex once");
  });
  it("requires authentication before accessing a Codex account", async () => {
    fixture.identity.mockResolvedValue(null);
    expect(
      (await GET(new Request("http://localhost:3000/api/codex/usage"))).status,
    ).toBe(401);
    expect(fixture.connected).not.toHaveBeenCalled();
  });
  it("derives the account from the authenticated identity, not query parameters", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/codex/usage?userId=other"),
    );
    expect(fixture.connected).toHaveBeenCalledWith("org-a:user-a");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      status: "available",
      limits: [{ id: "codex" }],
    });
  });
  it("does not read personal account data through a public host", async () => {
    fixture.local.mockReturnValue(false);
    const response = await GET(
      new Request("https://public.invalid/api/codex/usage"),
    );
    expect(await response.json()).toMatchObject({ status: "unavailable" });
    expect(fixture.connected).not.toHaveBeenCalled();
  });
  it("distinguishes disconnected from a failed limit fetch without leaking errors", async () => {
    fixture.connected.mockRejectedValueOnce(
      new Error("private provider error"),
    );
    expect(
      await (await GET(new Request("http://localhost:3000"))).json(),
    ).toEqual({ status: "disconnected" });
    fixture.read.mockRejectedValueOnce(new Error("private credential error"));
    const result = await (
      await GET(new Request("http://localhost:3000"))
    ).json();
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
