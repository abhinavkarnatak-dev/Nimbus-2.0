import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  rows: [] as unknown[][],
  token: vi.fn(),
  verify: vi.fn(),
  ref: vi.fn(),
  contents: vi.fn(),
}));
vi.mock("@nimbus/database", async (original) => ({
  ...(await original<object>()),
  db: () => ({
    select: () => ({
      from: () => ({ where: async () => fixture.rows.shift() ?? [] }),
    }),
  }),
}));
vi.mock("@nimbus/github", () => ({
  loadGitHubAppConfig: () => ({}),
  GitHubAppClient: class {
    createInstallationToken = fixture.token;
    verifyPublicRepository = fixture.verify;
    readRepositoryRef = fixture.ref;
    readRepositoryContents = fixture.contents;
  },
}));
import {
  accessibleRepository,
  readConnectedRepository,
} from "./repository-browser";
const repo = {
  id: "repo",
  owner: "owner",
  name: "demo",
  fullName: "owner/demo",
  defaultBranch: "main",
  githubRepositoryId: 42,
  githubInstallationId: "install",
  private: false,
};
function access() {
  fixture.rows.push([repo], [{ installationId: 7, status: "active" }]);
}
beforeEach(() => {
  vi.resetAllMocks();
  fixture.rows = [];
  fixture.token.mockResolvedValue({ token: "scoped" });
  fixture.ref.mockResolvedValue("a".repeat(40));
  fixture.contents.mockResolvedValue({ content: "Actual file" });
});
describe("read-only repository browser boundaries", () => {
  it("scopes credentials to the authorized repository and reads a pinned commit", async () => {
    access();
    const result = await readConnectedRepository(
      "org-first",
      "repo",
      "README.md",
    );
    expect(result).toMatchObject({
      content: "Actual file",
      sha: "a".repeat(40),
    });
    expect(fixture.token).toHaveBeenCalledWith(7, [42], "read");
    expect(fixture.verify).toHaveBeenCalledWith("scoped", "owner", "demo", 42);
    expect(fixture.contents).toHaveBeenCalledWith(
      "scoped",
      "owner",
      "demo",
      "a".repeat(40),
      "README.md",
    );
  });
  it("reuses commit content but checks authorization again before serving cached data", async () => {
    access();
    await readConnectedRepository("org-cache", "repo", "README.md");
    access();
    await readConnectedRepository("org-cache", "repo", "README.md");
    expect(fixture.contents).toHaveBeenCalledTimes(1);
    expect(fixture.token).toHaveBeenCalledTimes(2);
    fixture.rows = [[repo], [{ installationId: 7, status: "suspended" }]];
    await expect(
      readConnectedRepository("org-cache", "repo", "README.md"),
    ).rejects.toThrow("unavailable");
    expect(fixture.contents).toHaveBeenCalledTimes(1);
  });
  it("does not leak cached content to another workspace", async () => {
    fixture.rows = [[]];
    await expect(accessibleRepository("foreign-org", "repo")).rejects.toThrow(
      "not connected",
    );
    expect(fixture.token).not.toHaveBeenCalled();
  });
  it("rejects traversal before any credentials or provider calls", async () => {
    await expect(
      readConnectedRepository("org", "repo", "../secret"),
    ).rejects.toThrow();
    expect(fixture.token).not.toHaveBeenCalled();
  });
});
