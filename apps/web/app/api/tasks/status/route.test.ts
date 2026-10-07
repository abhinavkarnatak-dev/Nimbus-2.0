import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  and: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ currentIdentity: mocks.identity }));
vi.mock("@nimbus/database", () => ({
  db: () => ({ select: mocks.select }),
  tasks: {
    id: "task-id",
    status: "status",
    updatedAt: "updated",
    archivedAt: "archived",
    organizationId: "organization",
  },
  workspaces: { taskId: "workspace-task-id", status: "workspace-status" },
  eq: mocks.eq,
  inArray: mocks.inArray,
  and: mocks.and,
}));
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ organizationId: "org-owner" });
  mocks.select.mockReturnValue({
    from: () => ({ leftJoin: () => ({ where: mocks.where }) }),
  });
  mocks.where.mockResolvedValue([
    { id: "task_one", status: "completed", workspaceStatus: "paused" },
  ]);
});
describe("session status polling", () => {
  it("requires authentication before reading the database", async () => {
    mocks.identity.mockResolvedValue(null);
    expect(
      (
        await GET(
          new Request("https://nimbus.test/api/tasks/status?ids=task_one"),
        )
      ).status,
    ).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "wrong-id",
    Array.from({ length: 101 }, (_, index) => `task_${index}`).join(","),
  ])("rejects invalid or excessive ids", async (ids) => {
    expect(
      (
        await GET(
          new Request(`https://nimbus.test/api/tasks/status?ids=${ids}`),
        )
      ).status,
    ).toBe(400);
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("scopes the read to the signed-in organization and deduplicates ids", async () => {
    const response = await GET(
      new Request("https://nimbus.test/api/tasks/status?ids=task_one,task_one"),
    );
    expect(response.status).toBe(200);
    expect(mocks.eq).toHaveBeenCalledWith("organization", "org-owner");
    expect(mocks.inArray).toHaveBeenCalledWith("task-id", ["task_one"]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      tasks: [
        { id: "task_one", status: "completed", workspaceStatus: "paused" },
      ],
    });
  });
});
