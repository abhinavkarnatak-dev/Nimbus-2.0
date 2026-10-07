import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  token: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@nimbus/database", async (original) => ({
  ...(await original<typeof import("@nimbus/database")>()),
  db: () => ({ select: () => ({ from: () => ({ where: fixture.query }) }) }),
}));
vi.mock("@nimbus/github", async (original) => ({
  ...(await original<typeof import("@nimbus/github")>()),
  loadGitHubAppConfig: () => ({}),
  GitHubAppClient: class {
    createInstallationToken = fixture.token;
    verifyPublicRepository = fixture.verify;
  },
}));
import { authorizeTaskRepository } from "./repository-authorization";
const task = {
  status: "provisioning",
  repositoryId: "repo-a",
  organizationId: "org-a",
  baseRef: "main",
};
const repo = {
  owner: "owner",
  name: "repo",
  archived: false,
  githubInstallationId: "install-a",
  githubRepositoryId: 42,
};
beforeEach(() => {
  vi.resetAllMocks();
  fixture.token.mockResolvedValue({ token: "secret-installation-token" });
});
describe("claimed task repository authorization", () => {
  it("uses a repo-scoped installation token and returns metadata without credentials", async () => {
    fixture.query
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([repo])
      .mockResolvedValueOnce([{ installationId: 9, status: "active" }]);
    const result = await authorizeTaskRepository("task-a");
    expect(fixture.token).toHaveBeenCalledWith(9, [42]);
    expect(fixture.verify).toHaveBeenCalledWith(
      "secret-installation-token",
      "owner",
      "repo",
      42,
    );
    expect(result).toEqual({
      owner: "owner",
      name: "repo",
      baseRef: "main",
      public: true,
    });
    expect(JSON.stringify(result)).not.toContain("token");
  });
  it("rejects unclaimed tasks before requesting GitHub credentials", async () => {
    fixture.query.mockResolvedValueOnce([{ ...task, status: "queued" }]);
    await expect(authorizeTaskRepository("task-a")).rejects.toThrow("claimed");
    expect(fixture.token).not.toHaveBeenCalled();
  });
  it("fails closed for revoked installations and private repository checks", async () => {
    fixture.query
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([repo])
      .mockResolvedValueOnce([{ installationId: 9, status: "suspended" }]);
    await expect(authorizeTaskRepository("task-a")).rejects.toThrow(
      "suspended",
    );
    expect(fixture.token).not.toHaveBeenCalled();
    fixture.query
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([repo])
      .mockResolvedValueOnce([{ installationId: 9, status: "active" }]);
    fixture.verify.mockRejectedValueOnce(
      new Error("This repository is private"),
    );
    await expect(authorizeTaskRepository("task-a")).rejects.toThrow("private");
  });
});
