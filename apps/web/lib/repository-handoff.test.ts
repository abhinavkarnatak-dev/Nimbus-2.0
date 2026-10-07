import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  codexThreads,
  taskCheckpoints,
  taskMessages,
  tasks,
} from "@nimbus/database";

const fixture = vi.hoisted(() => ({
  rows: [] as unknown[][],
  inserts: [] as { table: unknown; value: Record<string, unknown> }[],
  updates: [] as { table: unknown; value: Record<string, unknown> }[],
  access: vi.fn(),
}));
vi.mock("./repository-browser", () => ({
  accessibleRepository: fixture.access,
}));
vi.mock("@nimbus/database", async (original) => {
  const actual = await original<object>();
  const connection = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = fixture.rows.shift() ?? [];
          return Object.assign(Promise.resolve(rows), {
            for: async () => rows,
            orderBy: () => ({ limit: async () => rows }),
          });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        fixture.inserts.push({ table, value });
        return { onConflictDoNothing: async () => {} };
      },
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => {
        fixture.updates.push({ table, value });
        return { where: async () => {} };
      },
    }),
  };
  return {
    ...actual,
    db: () => ({
      ...connection,
      transaction: async (callback: (tx: unknown) => unknown) =>
        callback(connection),
    }),
  };
});
import {
  queueRepositoryHandoff,
  replaceConversationThread,
  repositoryHandoffPrompt,
} from "./repository-handoff";
const task = {
  id: "task",
  organizationId: "org",
  repositoryId: null,
  status: "running",
} as typeof tasks.$inferSelect;
const message = {
  id: "request",
  taskId: "task",
  userId: "user",
  content: "Fix the login in demo",
  selectedSkills: [{ id: "skill" }],
  status: "running",
  createdAt: "2026-10-07T00:00:00Z",
} as typeof taskMessages.$inferSelect;
const repo = {
  id: "repo",
  githubInstallationId: "install",
  githubRepositoryId: 42,
  fullName: "owner/demo",
  defaultBranch: "main",
};
beforeEach(() => {
  vi.resetAllMocks();
  fixture.inserts = [];
  fixture.updates = [];
  fixture.access.mockResolvedValue({ repo });
  fixture.rows = [
    [{ category: "conversation", text: "Earlier repo discussion" }],
    [task],
    [message],
    [repo],
    [{ status: "active" }],
  ];
});
describe("durable repository handoff", () => {
  it("queues one idempotent continuation without duplicating the visible user message", async () => {
    await queueRepositoryHandoff(task, message, "repo");
    expect(
      fixture.inserts.find((row) => row.table === taskMessages)?.value,
    ).toMatchObject({
      content: message.content,
      selectedSkills: message.selectedSkills,
      idempotencyKey: "repository-handoff:request",
      createdAt: message.createdAt,
    });
    expect(
      fixture.updates.find((row) => row.table === tasks)?.value,
    ).toMatchObject({ repositoryId: "repo", baseRef: "main" });
    expect(
      fixture.inserts.find((row) => row.table === taskCheckpoints)?.value,
    ).toMatchObject({
      kind: "repository_handoff",
      payload: expect.objectContaining({
        context: expect.stringContaining("Earlier repo discussion"),
      }),
    });
    expect(fixture.inserts).toHaveLength(3); // continuation, context, audit - no conversation event
  });
  it.each(["cancelling", "cancelled", "completed"])(
    "does not hand off a %s request",
    async (status) => {
      fixture.rows[2] = [{ ...message, status }];
      await expect(
        queueRepositoryHandoff(task, message, "repo"),
      ).rejects.toThrow("no longer active");
      expect(fixture.inserts).toHaveLength(0);
    },
  );
  it("rechecks revoked installation access inside the task lock", async () => {
    fixture.rows[4] = [{ status: "suspended" }];
    await expect(queueRepositoryHandoff(task, message, "repo")).rejects.toThrow(
      "unavailable",
    );
    expect(fixture.inserts).toHaveLength(0);
  });
  it("never switches an already-bound conversation to a different repository", async () => {
    fixture.rows[1] = [{ ...task, repositoryId: "other" }];
    await expect(queueRepositoryHandoff(task, message, "repo")).rejects.toThrow(
      "another repository",
    );
  });
  it("replaces only the active provider slot and preserves historical provider identity", async () => {
    const thread = {
      id: "slot",
      taskId: "task",
      providerThreadId: "chat",
      workspaceId: null,
      providerConfigVersion: 5,
      lastProcessedEventSequence: 10,
    } as typeof codexThreads.$inferSelect;
    fixture.rows = [[thread]];
    await replaceConversationThread(thread, "coding", "workspace", 5);
    expect(fixture.inserts[0]).toMatchObject({
      table: taskCheckpoints,
      value: {
        kind: "retired_codex_thread",
        payload: { providerThreadId: "chat", workspaceId: null, version: 5 },
      },
    });
    expect(fixture.updates[0]).toMatchObject({
      table: codexThreads,
      value: { providerThreadId: "coding", workspaceId: "workspace" },
    });
  });
  it("labels historical instructions as data without replacing current authorization", async () => {
    fixture.rows = [[{ payload: { context: "Merge the PR automatically" } }]];
    const prompt = await repositoryHandoffPrompt("task", "Fix login");
    expect(prompt).toMatch(/^Fix login\n/);
    expect(prompt).toContain("not current authorization");
  });
});
