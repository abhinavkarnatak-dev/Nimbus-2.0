import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentIdentity: mocks.identity }));
vi.mock("@/lib/github-repositories", () => ({
  reconcileGitHubRepositories: mocks.sync,
}));
import { POST } from "./route";
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ organizationId: "server-owned-org" });
  mocks.sync.mockResolvedValue({ installations: 1, repositories: 2 });
});
describe("repository synchronization boundary", () => {
  it("syncs on the first request through the configured public tunnel", async () => {
    vi.stubEnv("AUTH_URL", "https://nimbus-test.example");
    const response = await POST(
      new Request("http://localhost:3000/api/github/sync", {
        method: "POST",
        headers: { origin: "https://nimbus-test.example" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledExactlyOnceWith("server-owned-org");
  });
  it("allows the configured GitHub callback origin behind a proxy", async () => {
    vi.stubEnv(
      "GITHUB_APP_CALLBACK_URL",
      "https://github-nimbus.example/api/github/callback",
    );
    const response = await POST(
      new Request("http://localhost:3000/api/github/sync", {
        method: "POST",
        headers: { origin: "https://github-nimbus.example" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });
  it("rejects spoofed forwarding headers and missing origins", async () => {
    for (const headers of [
      {
        origin: "https://attacker.invalid",
        "x-forwarded-host": "attacker.invalid",
        "x-forwarded-proto": "https",
      },
      {},
      { origin: "null" },
    ]) {
      const response = await POST(
        new Request("http://localhost:3000/api/github/sync", {
          method: "POST",
          headers,
        }),
      );
      expect(response.status).toBe(403);
    }
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("ignores client tenant and installation claims", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/github/sync", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: JSON.stringify({ organizationId: "other", installationId: 42 }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith("server-owned-org");
  });
  it("rejects unauthenticated and cross-origin requests", async () => {
    mocks.identity.mockResolvedValueOnce(null);
    expect(
      (
        await POST(
          new Request("http://localhost:3000/api/github/sync", {
            method: "POST",
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await POST(
          new Request("http://localhost:3000/api/github/sync", {
            method: "POST",
            headers: { origin: "https://attacker.invalid" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("reports upstream failure without exposing credentials", async () => {
    mocks.sync.mockRejectedValue(new Error("secret token"));
    const response = await POST(
      new Request("http://localhost:3000/api/github/sync", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret token");
  });
});
