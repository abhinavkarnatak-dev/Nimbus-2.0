import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const fixture = vi.hoisted(() => ({
  get: vi.fn(async () => new Response("GET")),
  post: vi.fn(async () => new Response("POST")),
}));
vi.mock("@/auth", () => ({
  handlers: { GET: fixture.get, POST: fixture.post },
}));
import { GET, POST } from "./route";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function configure() {
  vi.stubEnv("AUTH_URL", "http://localhost:3000");
  vi.stubEnv("AUTH_SECRET", "test-secret-with-at-least-32-characters");
  vi.stubEnv("AUTH_GOOGLE_ID", "test-client");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "test-secret");
}
it("fails closed before processing a callback without configuration", async () => {
  vi.stubEnv("AUTH_GOOGLE_SECRET", "");
  const response = await GET(
    new NextRequest("http://localhost:3000/api/auth/callback/google"),
  );
  expect(response.status).toBe(503);
  expect(fixture.get).not.toHaveBeenCalled();
});
it("rejects a mismatched forwarded host", async () => {
  configure();
  const response = await GET(
    new NextRequest("http://localhost:3000/api/auth/callback/google", {
      headers: { host: "localhost:3000", "x-forwarded-host": "evil.test" },
    }),
  );
  expect(response.status).toBe(403);
  expect(fixture.get).not.toHaveBeenCalled();
});
it("delegates valid requests to Auth.js including its OAuth and CSRF checks", async () => {
  configure();
  const get = new NextRequest("http://localhost:3000/api/auth/session", {
    headers: { host: "localhost:3000" },
  });
  const post = new NextRequest("http://localhost:3000/api/auth/signin/google", {
    method: "POST",
    headers: { host: "localhost:3000" },
  });
  expect(await (await GET(get)).text()).toBe("GET");
  expect(await (await POST(post)).text()).toBe("POST");
  expect(fixture.get).toHaveBeenCalledWith(get);
  expect(fixture.post).toHaveBeenCalledWith(post);
});
