import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexAppServerProvider, StartTurnInput } from "@nimbus/codex";
import type { tasks } from "@nimbus/database";

const fixture = vi.hoisted(() => ({
  rows: [] as unknown[][],
  catalog: vi.fn(),
  resolve: vi.fn(),
  insert: vi.fn(),
  dispose: vi.fn(),
  instructions: vi.fn(),
}));
vi.mock("@nimbus/database", async (original) => ({
  ...(await original<object>()),
  db: () => ({
    select: () => ({
      from: () => ({ where: async () => fixture.rows.shift() ?? [] }),
    }),
    insert: () => ({ values: fixture.insert }),
  }),
  listChatSkillCatalog: fixture.catalog,
  resolveChatSkills: fixture.resolve,
  readAgentInstructions: fixture.instructions,
  persistGeneratedTaskTitle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./codex-device", () => ({ connectedDeviceProvider: vi.fn() }));
vi.mock("./request-stop-signal", () => ({
  requestStopSignal: () => ({
    signal: new AbortController().signal,
    dispose: fixture.dispose,
  }),
}));
import { generalChatOperation } from "./general-chat-turn";

const skill = {
  id: "frontend",
  name: "Frontend",
  description: "Accessible frontend UI",
  summary: "Include keyboard navigation.",
};
const task = {
  id: "task-demo",
  organizationId: "org",
  createdByUserId: "user",
  repositoryId: null,
  requestedModel: "test-model",
  requestedReasoningEffort: "medium",
  title: "Demo",
  titleGeneratedAt: "2026-10-07",
} as typeof tasks.$inferSelect;
function setup(version = 5) {
  fixture.rows = [
    [
      {
        providerThreadId: "thread",
        workspaceId: null,
        providerConfigVersion: version,
      },
    ],
    [
      {
        id: "message",
        content: "Build an accessible frontend",
        userId: "user",
        selectedSkills: [],
      },
    ],
  ];
}
beforeEach(() => {
  vi.resetAllMocks();
  fixture.catalog.mockResolvedValue([
    { id: skill.id, name: skill.name, description: skill.description },
  ]);
  fixture.resolve.mockResolvedValue([skill]);
  fixture.instructions.mockResolvedValue([]);
  setup();
});
describe("general chat automatic skills streaming integration", () => {
  it("loads a relevant skill through the turn callback and sends usage plus reply over NDJSON", async () => {
    const active = new Set<string>();
    const runTurn = vi.fn(async function* (input: StartTurnInput) {
      expect(input.prompt).toContain(skill.description);
      expect(input.prompt).not.toContain(skill.summary);
      expect(input.prompt).toContain("do not require a sandbox");
      expect(input).not.toHaveProperty("workspacePath");
      expect(input).not.toHaveProperty("onToolCall");
      expect(await input.onSkillCall!({ id: skill.id })).toMatchObject(skill);
      yield {
        type: "agent_message_delta" as const,
        text: "Here's the UI.",
        itemId: "reply",
      };
      yield {
        type: "turn_completed" as const,
        turnId: "turn",
        status: "completed" as const,
      };
    });
    const response = await generalChatOperation(
      new Request("http://localhost/internal"),
      task,
      { operation: "turn/start", threadId: "thread" },
      active,
      {
        startChatThread: vi.fn(),
        runTurn,
      } as unknown as CodexAppServerProvider,
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events[0]).toMatchObject({
      method: "nimbus/skill",
      payload: { name: "Frontend" },
    });
    expect(events.some((e) => e.text === "Here's the UI.")).toBe(true);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(fixture.catalog).toHaveBeenCalledWith("org", "user");
    expect(fixture.resolve).toHaveBeenCalledWith("org", "user", ["frontend"]);
    expect(active.size).toBe(0);
    expect(fixture.dispose).toHaveBeenCalledTimes(1);
  });
  it("keeps legacy conversation IDs and handles usage without a new dynamic tool", async () => {
    setup(3);
    const runTurn = vi.fn(async function* (input: StartTurnInput) {
      expect(input.threadId).toBe("thread");
      expect(input.prompt).toContain(skill.summary);
      yield {
        type: "agent_message_delta" as const,
        text: '<nimbus_skill>"frontend"</nimbus_skill>Reply',
        itemId: "reply",
      };
      yield {
        type: "turn_completed" as const,
        turnId: "turn",
        status: "completed" as const,
      };
    });
    const response = await generalChatOperation(
      new Request("http://localhost/internal"),
      task,
      { operation: "turn/start", threadId: "thread" },
      new Set(),
      {
        startChatThread: vi.fn(),
        runTurn,
      } as unknown as CodexAppServerProvider,
    );
    const body = await response.text();
    expect(body).toContain("nimbus/skill");
    expect(body).toContain('"text":"Reply"');
    expect(body).not.toContain("<nimbus_skill>");
    expect(runTurn).toHaveBeenCalledTimes(1);
  });
  it("records the skill-capable version for new general chat threads without changing login", async () => {
    fixture.rows = [[]];
    const startChatThread = vi.fn().mockResolvedValue("new-thread");
    const response = await generalChatOperation(
      new Request("http://localhost/internal"),
      task,
      { operation: "thread/start" },
      new Set(),
      { startChatThread } as unknown as CodexAppServerProvider,
    );
    expect(await response.json()).toEqual({ threadId: "new-thread" });
    expect(startChatThread).toHaveBeenCalledExactlyOnceWith("test-model");
    expect(fixture.insert).toHaveBeenCalledWith(
      expect.objectContaining({ providerConfigVersion: 5, workspaceId: null }),
    );
  });
});
