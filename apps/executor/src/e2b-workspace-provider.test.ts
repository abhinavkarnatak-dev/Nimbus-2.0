import { afterEach, describe, expect, it, vi } from "vitest";
import {
  E2BWorkspaceProvider,
  E2B_NETWORK,
  sandboxPath,
  shellQuote,
  verifyPublicRepository,
} from "./e2b-workspace-provider.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("E2B execution boundary", () => {
  it("refreshes the provider deadline for warm idle and active follow-ups", async () => {
    const provider = new E2BWorkspaceProvider("test-only");
    const setTimeout = vi.fn(async () => {});
    vi.spyOn(provider, "handle").mockReturnValue({
      setTimeout,
    } as unknown as ReturnType<E2BWorkspaceProvider["handle"]>);
    const workspace = { id: "test", root: "/workspace/repo" };
    await provider.keepAlive(workspace, 180_000);
    expect(setTimeout).toHaveBeenLastCalledWith(180_000);
    await provider.keepAlive(workspace);
    expect(setTimeout).toHaveBeenLastCalledWith(1_800_000);
  });
  it("fails without a provisioning credential rather than selecting local execution", () => {
    expect(() => new E2BWorkspaceProvider("")).toThrow(
      "local execution fallback is forbidden",
    );
  });
  it("quotes shell metacharacters as data", () => {
    expect(shellQuote("file'; echo stolen; '")).toBe(
      "'file'\"'\"'; echo stolen; '\"'\"''",
    );
    expect(() => shellQuote("bad\0arg")).toThrow();
  });
  it("rejects paths outside the remote repository", () => {
    for (const path of [
      "../secret",
      "/etc/passwd",
      "C:\\Users\\secret",
      "a\0b",
      "a:b",
    ])
      expect(() => sandboxPath(path)).toThrow();
    expect(sandboxPath("phase 2/test.py")).toBe(
      "/workspace/repo/phase 2/test.py",
    );
  });
  it("does not open unauthenticated public ports or override private-network denies", () => {
    expect(E2B_NETWORK.allowPublicTraffic).toBe(false);
    expect(E2B_NETWORK).not.toHaveProperty("allowOut");
    expect(E2B_NETWORK.denyOut).toContain("169.254.0.0/16");
  });
  it("checks actual public visibility without sending authentication", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        private: false,
        visibility: "public",
        full_name: "owner/repo",
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await verifyPublicRepository({
      owner: "owner",
      name: "repo",
      baseRef: "main",
    });
    expect(fetch.mock.calls[0]?.[1].headers).not.toHaveProperty(
      "authorization",
    );
    expect(fetch.mock.calls[0]?.[1].redirect).toBe("error");
  });
  it("rejects private, redirected and mismatched repositories", async () => {
    for (const data of [
      { private: true, visibility: "private", full_name: "owner/repo" },
      { private: false, visibility: "public", full_name: "other/repo" },
      {},
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
      await expect(
        verifyPublicRepository({
          owner: "owner",
          name: "repo",
          baseRef: "main",
        }),
      ).rejects.toThrow("Only public");
    }
  });
  it("rejects injected repository names and branches before requesting GitHub", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const baseRef of [
      "--upload-pack=evil",
      "main; echo stolen",
      "../main",
      "a\nb",
    ])
      await expect(
        verifyPublicRepository({ owner: "owner", name: "repo", baseRef }),
      ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses to execute against an unconnected workspace", async () => {
    const provider = new E2BWorkspaceProvider("test-only");
    await expect(
      provider.execute(
        { id: "unknown", root: "/workspace/repo" },
        { argv: ["echo", "hello"], timeoutMs: 1000 },
      ),
    ).rejects.toThrow("local fallback");
  });
});
