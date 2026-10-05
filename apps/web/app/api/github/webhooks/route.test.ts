import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GitHub webhook receiver", () => {
  it("fails closed when a webhook secret is absent", async () => {
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "");
    const response = await POST(
      new Request("http://localhost/api/github/webhooks", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(503);
  });
  it("rejects an unsigned delivery before database access", async () => {
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "unit-test-only-secret");
    const response = await POST(
      new Request("http://localhost/api/github/webhooks", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
  });
});
