import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ detail: vi.fn(), files: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireIdentity: async () => ({ userId: "user", organizationId: "org" }),
}));
vi.mock("@/lib/task-data", () => ({ getTaskDetail: fixture.detail }));
vi.mock("./live-agent-workspace", () => ({
  LiveAgentWorkspace: ({ workbench }: { workbench: ReactNode }) =>
    createElement("div", { "data-workspace": true }, workbench),
}));
vi.mock("../edit-task-title", () => ({ EditTaskTitle: () => null }));
vi.mock("./files-workbench", () => ({
  FilesWorkbench: (props: unknown) => {
    fixture.files(props);
    return createElement("div", null, "Repository files");
  },
}));
vi.mock("./changes-workbench", () => ({
  ChangesWorkbench: () => createElement("div", null, "Workspace changes"),
}));
vi.mock("./pull-request-actions", () => ({ PullRequestActions: () => null }));
vi.mock("./artifacts-workbench", () => ({ ArtifactsWorkbench: () => null }));
import TaskPage from "./page";
const data = {
  task: {
    id: "task",
    title: "Chat",
    status: "completed",
    repository: null,
    updatedAt: "2026-10-07T12:00:00Z",
  },
  events: [],
  workspace: null,
  thread: null,
  inspectedRepository: null,
  commands: [],
  artifacts: [],
  pullRequest: null,
};
const render = async (tab = "process") =>
  renderToStaticMarkup(
    await TaskPage({
      params: Promise.resolve({ taskId: "task" }),
      searchParams: Promise.resolve({ tab }),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("React", React);
  fixture.detail.mockResolvedValue(data);
});
describe("general-chat workspace", () => {
  it.each([
    "process",
    "files",
    "changes",
    "terminal",
    "checks",
    "pull-request",
    "artifacts",
  ])(
    "keeps %s enabled with an empty state before a repository request",
    async (tab) => {
      const html = await render(tab);
      expect(html).toContain("workbench-pane");
      expect(html).toContain(`?tab=${tab}`);
      expect(html).toContain("Your workspace is ready");
      expect(fixture.files).not.toHaveBeenCalled();
    },
  );
  it("shows read-only files only after an explicit repository inspection", async () => {
    fixture.detail.mockResolvedValue({
      ...data,
      inspectedRepository: { repositoryId: "repo", sha: "a".repeat(40) },
    });
    const html = await render("files");
    expect(html).toContain("Repository files");
    expect(fixture.files).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceVersion: `github:repo:${"a".repeat(40)}`,
      }),
    );
  });
  it("shows normal changes after binding the same conversation to a coding workspace", async () => {
    fixture.detail.mockResolvedValue({
      ...data,
      task: { ...data.task, repository: "owner/repo" },
      workspace: { provider: "e2b", lastHeartbeatAt: "version" },
    });
    expect(await render("changes")).toContain("Workspace changes");
  });
});
