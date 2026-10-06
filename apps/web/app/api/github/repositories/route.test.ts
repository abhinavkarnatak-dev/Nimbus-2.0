import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentIdentity: mocks.identity }));
vi.mock("@/lib/available-repositories", () => ({
  listAvailableRepositories: mocks.list,
}));
import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ organizationId: "current-tenant" });
  mocks.list.mockResolvedValue([
    { id: "repo-1", fullName: "owner/current", secret: "not-public" },
  ]);
});
describe("current repository list", () => {
  it("returns only picker fields from the signed-in tenant without caching", async () => {
    const response = await GET();
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith("current-tenant");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      repositories: [{ id: "repo-1", fullName: "owner/current" }],
    });
  });
  it("rejects anonymous reads before database access", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
