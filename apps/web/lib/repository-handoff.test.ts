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
    execute: async () => fixture.rows.shift() ?? [],
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
  conversationHandoffContext,
  serializeConversationContext,
  recoveredConversationContext,
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
  it("keeps the full numbered suggestion before a short follow-up", async () => {
    fixture.rows = [
      [
        {
          category: "agent_message",
          text: `1. Fix uniqueness reporting\n${"explanation ".repeat(900)}\n2. Improve scanning`,
        },
        {
          category: "conversation",
          text: "implement the fix 1 and create a pr",
        },
      ],
    ];
    const context = await conversationHandoffContext("task");
    expect(context).toContain("1. Fix uniqueness reporting");
    expect(context).toContain("implement the fix 1 and create a pr");
    expect(JSON.parse(context)).toHaveLength(2);
  });
  it("bounds history using whole messages and valid JSON, not a trailing string slice", () => {
    const result = serializeConversationContext([
      { category: "agent_message", text: "old".repeat(10000) },
      {
        category: "agent_message",
        text: "1. Fix uniqueness\n" + "detail".repeat(4000),
      },
      { category: "conversation", text: "implement fix 1" },
    ]);
    expect(result.length).toBeLessThanOrEqual(32000);
    expect(JSON.parse(result)).toHaveLength(2);
    expect(result).toContain("1. Fix uniqueness");
  });
  it("keeps a numbered recommendation and follow-up when escaped content fills the budget", () => {
    const result = serializeConversationContext([
      {
        category: "agent_message",
        text: "1. Fix uniqueness\n" + "\u0000".repeat(24000),
      },
      { category: "conversation", text: "implement the fix 1 and create a pr" },
    ]);
    expect(result.length).toBeLessThanOrEqual(32000);
    expect(JSON.parse(result)).toHaveLength(2);
    expect(result).toContain("1. Fix uniqueness");
    expect(result).toContain("implement the fix 1 and create a pr");
  });
  it("retrieves recovery context only for the matching replacement thread", async () => {
    fixture.rows = [
      [
        {
          payload: {
            context: "1. Fix uniqueness",
            replacementProviderThreadId: "replacement",
          },
        },
      ],
    ];
    expect(await recoveredConversationContext("task", "replacement")).toBe(
      "1. Fix uniqueness",
    );
  });
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
