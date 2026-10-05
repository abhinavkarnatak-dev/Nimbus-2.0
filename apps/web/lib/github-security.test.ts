import { describe, it, expect, vi, afterEach } from "vitest";
import {
  gitHubCallbackUrl,
  hashGitHubState,
  readBoundedBody,
} from "./github-security";

afterEach(() => vi.unstubAllEnvs());

describe("GitHub connection boundaries", () => {
  it("accepts the exact localhost callback during development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(
      "GITHUB_APP_CALLBACK_URL",
      "http://localhost:3000/api/github/callback",
    );
    expect(gitHubCallbackUrl()).toBe(
      "http://localhost:3000/api/github/callback",
    );
  });
  it("rejects insecure remote callbacks and URL credentials", () => {
    vi.stubEnv(
      "GITHUB_APP_CALLBACK_URL",
      "http://example.com/api/github/callback",
    );
    expect(gitHubCallbackUrl).toThrow();
    vi.stubEnv(
      "GITHUB_APP_CALLBACK_URL",
      "https://secret@example.com/api/github/callback",
    );
    expect(gitHubCallbackUrl).toThrow();
  });
  it("rejects callback query parameters", () => {
    vi.stubEnv(
      "GITHUB_APP_CALLBACK_URL",
      "https://example.com/api/github/callback?next=https://evil.example",
    );
    expect(gitHubCallbackUrl).toThrow();
  });
  it("limits a streamed request even without a content-length header", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: "oversized",
    });
    await expect(readBoundedBody(request, 3)).rejects.toThrow("exceeds limit");
  });
  it("retains the exact bytes needed for webhook HMAC verification", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: '{ "action": "ping" }',
    });
    expect((await readBoundedBody(request)).toString()).toBe(
      '{ "action": "ping" }',
    );
    expect(hashGitHubState("state")).toHaveLength(64);
  });
});
