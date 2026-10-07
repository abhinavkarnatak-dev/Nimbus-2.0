import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodingAgentEvent } from "@nimbus/codex";
import type { tasks, taskMessages } from "@nimbus/database";

const fixture = vi.hoisted(() => ({
  catalog: vi.fn(),
  access: vi.fn(),
  read: vi.fn(),
  remember: vi.fn(),
  queue: vi.fn(),
}));
vi.mock("./available-repositories", () => ({
  listAvailableRepositories: fixture.catalog,
}));
vi.mock("./repository-browser", () => ({
  accessibleRepository: fixture.access,
  readConnectedRepository: fixture.read,
  rememberRepositoryContext: fixture.remember,
}));
vi.mock("./repository-handoff", () => ({
  queueRepositoryHandoff: fixture.queue,
}));
import { prepareChatRepositories } from "./chat-repositories";

const repo = {
  id: "repo",
  fullName: "owner/demo",
  defaultBranch: "main",
  githubInstallationId: "install",
  private: false,
};
const task = { id: "task", organizationId: "org" } as typeof tasks.$inferSelect;
const message = (content: string) =>
  ({ id: "message", content }) as typeof taskMessages.$inferSelect;
async function collect(source: AsyncIterable<CodingAgentEvent>) {
  const events = [];
  for await (const event of source) events.push(event);
  return events;
}
async function* terminal(
  status: "completed" | "failed" | "interrupted" = "completed",
): AsyncGenerator<CodingAgentEvent> {
  yield { type: "turn_completed", turnId: "turn", status };
}
beforeEach(() => {
  vi.resetAllMocks();
  fixture.catalog.mockResolvedValue([
    repo,
    { ...repo, id: "private", private: true },
  ]);
  fixture.access.mockResolvedValue({ repo });
  fixture.read.mockResolvedValue({
    repositoryId: repo.id,
    fullName: repo.fullName,
    ref: "main",
    sha: "a".repeat(40),
    path: "README.md",
    content: "Project overview",
  });
  fixture.queue.mockResolvedValue({
    repositoryId: repo.id,
    fullName: repo.fullName,
  });
});
describe("repository-aware general chat", () => {
  it("injects only catalog metadata for normal chat, without reads or a handoff", async () => {
    const tools = await prepareChatRepositories(
      task,
      message("Hello"),
      new AbortController().signal,
    );
    expect(tools.prompt).toContain("owner/demo");
    expect(
      await tools.onRepositoryCall("nimbus_list_repositories", {}),
    ).toEqual({
      repositories: [
        { id: "repo", fullName: "owner/demo", defaultBranch: "main" },
      ],
      more: false,
    });
    await collect(tools.present(terminal()));
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.queue).not.toHaveBeenCalled();
  });
  it("reads only a requested connected repository and persists the file-browser context", async () => {
    const tools = await prepareChatRepositories(
      task,
      message("What is demo about?"),
      new AbortController().signal,
    );
    const result = await tools.onRepositoryCall("nimbus_read_repository", {
      repositoryId: "repo",
      path: "README.md",
    });
    expect(result).toMatchObject({
      content: "Project overview",
      authority: expect.stringContaining("untrusted"),
    });
    expect(fixture.read).toHaveBeenCalledWith("org", "repo", "README.md");
    expect(fixture.remember).toHaveBeenCalledWith(
      "task",
      expect.objectContaining({ repositoryId: "repo" }),
    );
    const events = await collect(tools.present(terminal()));
    expect(events[0]).toMatchObject({ method: "nimbus/repositoryRead" });
    expect(fixture.queue).not.toHaveBeenCalled();
    await expect(
      tools.onRepositoryCall("nimbus_read_repository", {
        repositoryId: "private",
      }),
    ).rejects.toThrow("not available");
    await expect(
      tools.onRepositoryCall("nimbus_read_repository", {
        repositoryId: "other-org",
      }),
    ).rejects.toThrow("not available");
  });
  it("rejects a handoff for a read-only question even if the agent calls the tool", async () => {
    const tools = await prepareChatRepositories(
      task,
      message("How would you fix demo?"),
      new AbortController().signal,
    );
    await expect(
      tools.onRepositoryCall("nimbus_start_repository_work", {
        repositoryId: "repo",
      }),
    ).rejects.toThrow("does not authorize");
    expect(fixture.access).not.toHaveBeenCalled();
  });
  it("defers explicit work until successful completion and retains the exact original request", async () => {
    const request = message("Fix the login in demo");
    const controller = new AbortController();
    const tools = await prepareChatRepositories(
      task,
      request,
      controller.signal,
    );
    await tools.onRepositoryCall("nimbus_start_repository_work", {
      repositoryId: "repo",
    });
    expect(fixture.queue).not.toHaveBeenCalled();
    const events = await collect(tools.present(terminal()));
    expect(fixture.queue).toHaveBeenCalledExactlyOnceWith(
      task,
      request,
      "repo",
      controller.signal,
    );
    expect(events[0]).toMatchObject({ method: "nimbus/repositoryWork" });
  });
  it.each(["failed", "interrupted"] as const)(
    "never queues work after %s",
    async (status) => {
      const tools = await prepareChatRepositories(
        task,
        message("Fix demo"),
        new AbortController().signal,
      );
      await tools.onRepositoryCall("nimbus_start_repository_work", {
        repositoryId: "repo",
      });
      await collect(tools.present(terminal(status)));
      expect(fixture.queue).not.toHaveBeenCalled();
    },
  );
  it("does not queue an aborted request", async () => {
    const controller = new AbortController();
    const tools = await prepareChatRepositories(
      task,
      message("Fix demo"),
      controller.signal,
    );
    await tools.onRepositoryCall("nimbus_start_repository_work", {
      repositoryId: "repo",
    });
    controller.abort();
    await expect(collect(tools.present(terminal()))).rejects.toThrow();
    expect(fixture.queue).not.toHaveBeenCalled();
  });
  it("bounds repository context and rejects extra tool arguments", async () => {
    const tools = await prepareChatRepositories(
      task,
      message("Explain demo"),
      new AbortController().signal,
    );
    await expect(
      tools.onRepositoryCall("nimbus_read_repository", {
        repositoryId: "repo",
        command: "shell",
      }),
    ).rejects.toThrow();
    for (let i = 0; i < 12; i++)
      await tools.onRepositoryCall("nimbus_read_repository", {
        repositoryId: "repo",
      });
    await expect(
      tools.onRepositoryCall("nimbus_read_repository", {
        repositoryId: "repo",
      }),
    ).rejects.toThrow("limit");
    expect(fixture.read).toHaveBeenCalledTimes(12);
  });
});
