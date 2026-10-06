import { afterEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  identity: { userId: "test-user", organizationId: "test-org" } as {
    userId: string;
    organizationId: string;
  } | null,
  state: { ready: false, completed: false },
  update: vi.fn(),
  where: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth", () => ({
  currentIdentity: async () => fixture.identity,
}));
vi.mock("@/lib/onboarding", () => ({
  onboardingStatus: async () => fixture.state,
}));
vi.mock("@nimbus/database", () => ({
  db: () => ({ update: fixture.update }),
  users: { id: "users.id" },
  eq: (field: unknown, value: unknown) => ({ field, value }),
}));
import { GET, POST } from "./route";
afterEach(() => {
  vi.unstubAllEnvs();
  fixture.identity = { userId: "test-user", organizationId: "test-org" };
  fixture.state = { ready: false, completed: false };
  vi.clearAllMocks();
});
it("uses the registered app origin instead of the internal Next.js address", async () => {
  vi.stubEnv("AUTH_URL", "http://localhost:3000");
  fixture.state.completed = true;
  const internal = new Request("http://0.0.0.0:3000/api/onboarding", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
  });
  expect((await POST(internal)).status).toBe(200);
});
function request(origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/onboarding", {
    method: "POST",
    headers: { origin },
    body: JSON.stringify({ userId: "someone-else" }),
  });
}
it("requires an authenticated identity", async () => {
  fixture.identity = null;
  expect((await GET()).status).toBe(401);
  expect((await POST(request())).status).toBe(401);
});
it("rejects cross-origin completion", async () => {
  expect((await POST(request("https://evil.test"))).status).toBe(403);
  expect(fixture.update).not.toHaveBeenCalled();
});
it("does not complete before both connections are ready", async () => {
  expect((await POST(request())).status).toBe(409);
  expect(fixture.update).not.toHaveBeenCalled();
});
it("persists completion only for the authenticated user", async () => {
  fixture.state.ready = true;
  fixture.update.mockReturnValue({ set: () => ({ where: fixture.where }) });
  expect((await POST(request())).status).toBe(200);
  expect(fixture.where).toHaveBeenCalledWith({
    field: "users.id",
    value: "test-user",
  });
});
it("completion is idempotent even after a later disconnect", async () => {
  fixture.state.completed = true;
  expect((await POST(request())).status).toBe(200);
  expect(fixture.update).not.toHaveBeenCalled();
});
