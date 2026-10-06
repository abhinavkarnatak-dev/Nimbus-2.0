import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  records: [] as { provider: string | null }[],
  where: vi.fn(),
  root: vi.fn(),
  read: vi.fn(),
  tree: vi.fn(),
  history: vi.fn(),
  version: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ currentIdentity: mocks.identity }));
vi.mock("@nimbus/database", async (original) => {
  const actual = await original<typeof import("@nimbus/database")>();
  return {
    ...actual,
    db: () => ({
      select: () => ({
        from: () => ({ leftJoin: () => ({ where: mocks.where }) }),
      }),
    }),
  };
});
vi.mock("@/lib/workspace-files", async (original) => {
  const actual = await original<typeof import("@/lib/workspace-files")>();
  return {
    ...actual,
    taskFileRoot: mocks.root,
    readWorkspaceFile: mocks.read,
    listWorkspaceDirectory: mocks.tree,
    workspaceFileHistory: mocks.history,
    readWorkspaceVersion: mocks.version,
  };
});
import { GET } from "./route";
const context = { params: Promise.resolve({ taskId: "task-test" }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ organizationId: "org-owned" });
  mocks.records = [{ provider: "local-test" }];
  mocks.where.mockImplementation(() => Promise.resolve(mocks.records));
  mocks.root.mockResolvedValue("assigned-root");
  mocks.read.mockResolvedValue("actual source");
});
describe("task file access boundary", () => {
  it("never touches files for anonymous or nonexistent/foreign tasks", async () => {
    mocks.identity.mockResolvedValueOnce(null);
    expect(
      (await GET(new Request("http://localhost/api/files"), context)).status,
    ).toBe(401);
    expect(mocks.where).not.toHaveBeenCalled();
    mocks.records = [];
    expect(
      (
        await GET(
          new Request(
            "http://localhost/api/files?operation=read&path=README.md",
          ),
          context,
        )
      ).status,
    ).toBe(404);
    expect(mocks.root).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("reads only through the assigned task workspace and excludes responses from caches", async () => {
    const response = await GET(
      new Request("http://localhost/api/files?operation=read&path=README.md"),
      context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.root).toHaveBeenCalledWith(expect.any(String), "task-test");
    expect(mocks.read).toHaveBeenCalledWith("assigned-root", "README.md");
    expect(await response.json()).toEqual({
      path: "README.md",
      revision: null,
      content: "actual source",
    });
  });
  it("does not substitute another workspace provider or expose internal error paths", async () => {
    mocks.records = [{ provider: "remote" }];
    expect(
      (await GET(new Request("http://localhost/api/files"), context)).status,
    ).toBe(409);
    expect(mocks.root).not.toHaveBeenCalled();
    mocks.records = [{ provider: "local-test" }];
    mocks.root.mockRejectedValue(new Error("C:/private/secret"));
    const response = await GET(
      new Request("http://localhost/api/files"),
      context,
    );
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("private/secret");
  });
});
