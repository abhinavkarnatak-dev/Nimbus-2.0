import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  rows: [] as unknown[][],
  writes: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  models: vi.fn(),
  role: "owner",
}));
vi.mock("./auth", () => ({
  currentIdentity: async () => ({
    userId: "user",
    organizationId: "org",
    role: fixture.role,
  }),
}));
vi.mock("./codex-models", async (original) => ({
  ...(await original<object>()),
  getSelectableCodexModels: fixture.models,
}));
vi.mock("@nimbus/database", async (original) => {
  const actual = await original<object>();
  const next = () => Promise.resolve(fixture.rows.shift() ?? []);
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          then: (
            resolve: (rows: unknown[]) => unknown,
            reject: (error: unknown) => unknown,
          ) => next().then(resolve, reject),
          for: next,
          limit: next,
          orderBy: next,
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          fixture.writes.push({ table, values });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        fixture.writes.push({ table, values });
      },
    }),
  };
  return {
    ...actual,
    db: () => ({
      transaction: async (run: (tx: unknown) => unknown) => run(tx),
    }),
    listChatSkills: async () => [],
    resolveChatSkills: async () => [],
  };
});
import { POST } from "../app/api/tasks/[taskId]/messages/route";
import { taskMessages, tasks } from "@nimbus/database";

const task = {
  id: "task",
  status: "completed",
  selectedSkillIds: [],
  requestedModel: "old",
  requestedReasoningEffort: "high",
  repositoryId: null,
};
const key = "16a17b71-b578-43ea-b1d7-88e17d66466a";
function send(model?: string, reasoningEffort?: string | null) {
  return POST(
    new Request("http://localhost:3000/api/tasks/task/messages", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        host: "localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "Continue",
        idempotencyKey: key,
        ...(model ? { model } : {}),
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      }),
    }),
    { params: Promise.resolve({ taskId: "task" }) },
  );
}
beforeEach(() => {
  fixture.rows = [[{ ...task }], [], [], [], []];
  fixture.writes = [];
  fixture.role = "owner";
  fixture.models.mockReset().mockResolvedValue([
    {
      id: "old",
      label: "Old",
      isDefault: true,
      supportedReasoningEfforts: [
        { reasoningEffort: "medium" },
        { reasoningEffort: "high" },
      ],
    },
    {
      id: "new",
      label: "New",
      isDefault: false,
      supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
    },
    {
      id: "compatible",
      label: "Compatible",
      isDefault: false,
      supportedReasoningEfforts: [{ reasoningEffort: "high" }],
    },
    { id: "no-effort", label: "Default", isDefault: false },
  ]);
});
describe("follow-up model selection", () => {
  it("persists an explicit thinking effort for the same model", async () => {
    expect((await send("old", "medium")).status).toBe(202);
    expect(
      fixture.writes.find((write) => write.table === taskMessages)?.values,
    ).toMatchObject({
      requestedModel: "old",
      requestedReasoningEffort: "medium",
    });
    expect(
      fixture.writes.find((write) => write.table === tasks)?.values,
    ).toMatchObject({ requestedReasoningEffort: "medium" });
  });
  it("rejects unsupported effort without writes", async () => {
    expect((await send("new", "high")).status).toBe(400);
    expect(fixture.writes).toEqual([]);
  });
  it("locks effort-only changes during active work", async () => {
    fixture.rows[0] = [{ ...task, status: "running" }];
    expect((await send("old", "medium")).status).toBe(409);
    expect(fixture.writes).toEqual([]);
  });
  it("allows queuing with identical model and effort", async () => {
    fixture.rows[0] = [{ ...task, status: "running" }];
    expect((await send("old", "high")).status).toBe(202);
  });
  it("locks effort-only changes when a queued message exists", async () => {
    fixture.rows[2] = [{ id: "queued" }];
    expect((await send("old", "medium")).status).toBe(409);
    expect(fixture.writes).toEqual([]);
  });
  it("rejects retry keys reused with different effort", async () => {
    fixture.rows[1] = [
      {
        id: "sent",
        content: "Continue",
        selectedSkills: [],
        requestedModel: "old",
        requestedReasoningEffort: "high",
      },
    ];
    expect((await send("old", "medium")).status).toBe(409);
    expect(fixture.writes).toEqual([]);
  });
  it("accepts an explicit model default", async () => {
    expect((await send("no-effort", null)).status).toBe(202);
    expect(
      fixture.writes.find((write) => write.table === taskMessages)?.values
        .requestedReasoningEffort,
    ).toBeNull();
  });
  it("saves the next message and session model atomically, resetting incompatible effort", async () => {
    expect((await send("new")).status).toBe(202);
    expect(
      fixture.writes.find((write) => write.table === taskMessages)?.values,
    ).toMatchObject({
      requestedModel: "new",
      requestedReasoningEffort: "medium",
      content: "Continue",
    });
    expect(
      fixture.writes.find((write) => write.table === tasks)?.values,
    ).toMatchObject({
      requestedModel: "new",
      requestedReasoningEffort: "medium",
    });
  });
  it("keeps compatible effort", async () => {
    expect((await send("compatible")).status).toBe(202);
    expect(
      fixture.writes.find((write) => write.table === taskMessages)?.values
        .requestedReasoningEffort,
    ).toBe("high");
  });
  it("clears effort when the model has no effort options", async () => {
    expect((await send("no-effort")).status).toBe(202);
    expect(
      fixture.writes.find((write) => write.table === taskMessages)?.values
        .requestedReasoningEffort,
    ).toBeNull();
  });
  it.each([
    "queued",
    "provisioning",
    "running",
    "preparing_pr",
    "pushing",
    "creating_pr",
  ])("rejects switching during %s without mutations", async (status) => {
    fixture.rows[0] = [{ ...task, status }];
    expect((await send("new")).status).toBe(409);
    expect(fixture.writes).toEqual([]);
  });
  it("rejects switching when a queued message exists even if the status is stale", async () => {
    fixture.rows[2] = [{ id: "queued-message" }];
    expect((await send("new")).status).toBe(409);
    expect(fixture.writes).toEqual([]);
  });
  it("preserves active-turn queuing for unchanged models", async () => {
    fixture.rows[0] = [{ ...task, status: "running" }];
    expect((await send("old")).status).toBe(202);
    expect(
      fixture.writes.find((write) => write.table === taskMessages)?.values
        .requestedModel,
    ).toBe("old");
  });
  it("preserves legacy follow-ups without requiring a catalog refresh", async () => {
    fixture.rows[0] = [{ ...task, status: "running" }];
    expect((await send()).status).toBe(202);
    expect(fixture.models).not.toHaveBeenCalled();
  });
  it("rejects unknown models", async () => {
    expect((await send("invented")).status).toBe(400);
    expect(fixture.writes).toEqual([]);
  });
  it("validates against the execution owner's catalog for a shared session", async () => {
    fixture.rows[0] = [{ ...task, createdByUserId: "another-user" }];
    fixture.models
      .mockResolvedValueOnce([{ id: "new", label: "New" }])
      .mockResolvedValueOnce([{ id: "old", label: "Old" }]);
    expect((await send("new")).status).toBe(400);
    expect(fixture.models).toHaveBeenLastCalledWith(
      "another-user",
      "org",
      expect.anything(),
    );
    expect(fixture.writes).toEqual([]);
  });
  it("fails safely on catalog failure", async () => {
    fixture.models.mockRejectedValue(new Error("unavailable"));
    expect((await send("new")).status).toBe(503);
    expect(fixture.writes).toEqual([]);
  });
  it("deduplicates retries after the task has already started", async () => {
    fixture.rows = [
      [{ ...task, status: "running", requestedModel: "new" }],
      [
        {
          id: "sent",
          content: "Continue",
          selectedSkills: [],
          requestedModel: "new",
        },
      ],
    ];
    expect(await (await send("new")).json()).toMatchObject({
      duplicate: true,
      messageId: "sent",
    });
    expect(fixture.writes).toEqual([]);
  });
  it("rejects reusing a request key with a different model", async () => {
    fixture.rows[1] = [
      {
        id: "sent",
        content: "Continue",
        selectedSkills: [],
        requestedModel: "old",
      },
    ];
    expect((await send("new")).status).toBe(409);
    expect(fixture.writes).toEqual([]);
  });
  it("rejects cross-tenant tasks and read-only users", async () => {
    fixture.rows[0] = [];
    expect((await send("new")).status).toBe(404);
    fixture.role = "viewer";
    expect((await send("new")).status).toBe(403);
    expect(fixture.writes).toEqual([]);
  });
});
