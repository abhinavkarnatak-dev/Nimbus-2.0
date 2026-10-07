import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  records: vi.fn(),
  sync: vi.fn(),
  tree: vi.fn(),
  read: vi.fn(),
  changes: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ currentIdentity: mocks.identity }));
vi.mock("@/lib/repository-root", () => ({
  nimbusRepositoryRoot: () => "/fixture",
}));
vi.mock("@/lib/remote-workspace", () => ({ remoteWorkspace: mocks.sync }));
vi.mock("@nimbus/database", () => ({
  db: () => ({
    select: () => ({
      from: () => ({ leftJoin: () => ({ where: mocks.records }) }),
    }),
  }),
  and: vi.fn(),
  eq: vi.fn(),
  tasks: {},
  workspaces: {},
}));
vi.mock("@/lib/workspace-files", () => ({
  FileBrowserError: class extends Error {},
  taskFileRoot: async () => "/fixture",
  listWorkspaceDirectory: mocks.tree,
  readWorkspaceFile: mocks.read,
  readWorkspaceVersion: mocks.read,
  workspaceFileHistory: mocks.tree,
  workspaceChanges: mocks.changes,
}));
import { GET } from "./route";
const get = (query: string) =>
  GET(new Request(`http://localhost/api/tasks/task_fixture/files?${query}`), {
    params: Promise.resolve({ taskId: "task_fixture" }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ organizationId: "org1" });
  mocks.records.mockResolvedValue([{ provider: "e2b", baseRef: "main" }]);
  mocks.tree.mockResolvedValue([]);
  mocks.read.mockResolvedValue("file contents");
  mocks.changes.mockResolvedValue({ files: [] });
});
describe("workspace browsing without repeated sandbox exports", () => {
  it.each([
    "operation=tree",
    "operation=tree&path=src",
    "operation=read&path=src/index.ts",
    "operation=history&path=src/index.ts",
  ])("reads the mirror for %s", async (query) => {
    expect((await get(query)).status).toBe(200);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("syncs once for explicit root refresh and keeps changes live", async () => {
    await get("operation=tree&sync=true");
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    await get("operation=changes");
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });
  it("does not let folder expansion request a sync", async () => {
    await get("operation=tree&path=src&sync=true");
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("retains authentication and tenant authorization before file access", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await get("operation=tree&sync=true")).status).toBe(401);
    expect(mocks.records).not.toHaveBeenCalled();
    mocks.identity.mockResolvedValue({ organizationId: "org1" });
    mocks.records.mockResolvedValue([]);
    expect((await get("operation=tree&sync=true")).status).toBe(404);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.tree).not.toHaveBeenCalled();
  });
});
