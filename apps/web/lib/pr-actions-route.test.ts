import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  identity: { organizationId: "org", role: "owner" } as {
    organizationId: string;
    role: string;
  } | null,
  manage: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ currentIdentity: async () => state.identity }));
vi.mock("@/lib/pr-actions", () => ({ manageTaskPullRequest: state.manage }));
import { POST } from "../app/api/tasks/[taskId]/pull-request/route";
const context = { params: Promise.resolve({ taskId: "task_test" }) };
const body = {
  action: "merge",
  expectedHeadSha: "a".repeat(40),
  confirmed: true,
};
function request(value: unknown = body, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/tasks/task_test/pull-request", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  });
}
beforeEach(() => {
  state.identity = { organizationId: "org", role: "owner" };
  state.manage.mockReset();
});
describe("confirmed PR action endpoint", () => {
  it("requires authentication", async () => {
    state.identity = null;
    expect((await POST(request(), context)).status).toBe(401);
    expect(state.manage).not.toHaveBeenCalled();
  });
  it("rejects viewers", async () => {
    state.identity!.role = "viewer";
    expect((await POST(request(), context)).status).toBe(403);
    expect(state.manage).not.toHaveBeenCalled();
  });
  it("rejects cross-site writes", async () => {
    expect(
      (await POST(request(body, "https://attacker.invalid"), context)).status,
    ).toBe(403);
    expect(state.manage).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation", async () => {
    expect(
      (await POST(request({ ...body, confirmed: false }), context)).status,
    ).toBe(400);
    expect(state.manage).not.toHaveBeenCalled();
  });
  it("passes the authenticated tenant rather than client-supplied tenant", async () => {
    state.manage.mockResolvedValue({ state: "merged" });
    expect(
      (await POST(request({ ...body, organizationId: "foreign" }), context))
        .status,
    ).toBe(200);
    expect(state.manage).toHaveBeenCalledWith("org", "task_test", body);
  });
  it("surfaces protected-branch errors without a successful response", async () => {
    state.manage.mockRejectedValue(
      new Error("Required checks have not passed"),
    );
    const result = await POST(request(), context);
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({
      error: "Required checks have not passed",
    });
  });
});
