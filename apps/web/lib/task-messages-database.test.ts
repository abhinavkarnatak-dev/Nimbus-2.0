import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  db,
  eq,
  users,
  organizations,
  repositories,
  tasks,
  taskMessages,
  taskEvents,
  auditLogs,
  outbox,
  closeDatabase,
} from "@nimbus/database";

const fixture = vi.hoisted(() => ({
  userId: `message_user_${Date.now()}`,
  organizationId: `message_org_${Date.now()}`,
  role: "owner",
}));
vi.mock("@/lib/auth", () => ({
  currentIdentity: async () => ({ ...fixture }),
}));
vi.mock("./codex-models", async (original) => ({
  ...(await original<object>()),
  getSelectableCodexModels: async () => [
    {
      id: "model-a",
      label: "A",
      supportedReasoningEfforts: [
        { reasoningEffort: "medium" },
        { reasoningEffort: "high" },
      ],
    },
    {
      id: "model-b",
      label: "B",
      supportedReasoningEfforts: [{ reasoningEffort: "high" }],
    },
  ],
}));

describe.runIf(process.env.NIMBUS_TASK_DATABASE_TEST === "true")(
  "durable follow-up routes against PostgreSQL",
  () => {
    const repositoryId = `message_repo_${randomUUID()}`;
    const taskIds: string[] = [];
    beforeAll(async () => {
      await db()
        .insert(users)
        .values({
          id: fixture.userId,
          name: "Message test",
          email: `${fixture.userId}@example.invalid`,
        });
      await db().insert(organizations).values({
        id: fixture.organizationId,
        slug: fixture.organizationId,
        name: "Message tests",
      });
      await db().insert(repositories).values({
        id: repositoryId,
        organizationId: fixture.organizationId,
        owner: "test",
        name: "test",
        fullName: "test/test",
        defaultBranch: "main",
      });
    });
    afterAll(async () => {
      for (const id of taskIds) {
        await db().delete(outbox).where(eq(outbox.aggregateId, id));
        await db().delete(tasks).where(eq(tasks.id, id));
      }
      await db()
        .delete(auditLogs)
        .where(eq(auditLogs.organizationId, fixture.organizationId));
      await db().delete(repositories).where(eq(repositories.id, repositoryId));
      await db()
        .delete(organizations)
        .where(eq(organizations.id, fixture.organizationId));
      await db().delete(users).where(eq(users.id, fixture.userId));
      await closeDatabase();
    });
    async function task(status: "running" | "completed" = "running") {
      const id = `message_task_${randomUUID()}`;
      taskIds.push(id);
      await db().insert(tasks).values({
        id,
        organizationId: fixture.organizationId,
        createdByUserId: fixture.userId,
        repositoryId,
        title: "Test",
        objective: "Original objective",
        baseRef: "main",
        status,
      });
      return id;
    }
    async function send(
      taskId: string,
      key = randomUUID(),
      content = "Add the next change",
      origin = "http://localhost:3000",
      model?: string,
      reasoningEffort?: string | null,
    ) {
      const { POST } = await import(
        "../app/api/tasks/[taskId]/messages/route.js"
      );
      return POST(
        new Request(`http://localhost:3000/api/tasks/${taskId}/messages`, {
          method: "POST",
          headers: {
            host: "localhost:3000",
            origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            content,
            idempotencyKey: key,
            ...(model ? { model } : {}),
            ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
          }),
        }),
        { params: Promise.resolve({ taskId }) },
      );
    }
    it("queues active-run follow-ups without replacing the objective", async () => {
      const id = await task();
      expect((await send(id)).status).toBe(202);
      const [row] = await db().select().from(tasks).where(eq(tasks.id, id));
      expect(row?.status).toBe("running");
      expect(row?.objective).toBe("Original objective");
      expect(
        await db()
          .select()
          .from(taskMessages)
          .where(eq(taskMessages.taskId, id)),
      ).toHaveLength(1);
    });
    it("persists effort-only changes and validates retry snapshots", async () => {
      const id = await task("completed"),
        key = randomUUID();
      await db()
        .update(tasks)
        .set({ requestedModel: "model-a", requestedReasoningEffort: "medium" })
        .where(eq(tasks.id, id));
      expect(
        (
          await send(
            id,
            key,
            "Continue",
            "http://localhost:3000",
            "model-a",
            "high",
          )
        ).status,
      ).toBe(202);
      const [message] = await db()
        .select()
        .from(taskMessages)
        .where(eq(taskMessages.taskId, id));
      const [session] = await db().select().from(tasks).where(eq(tasks.id, id));
      expect(message?.requestedReasoningEffort).toBe("high");
      expect(session?.requestedReasoningEffort).toBe("high");
      expect(
        await (
          await send(
            id,
            key,
            "Continue",
            "http://localhost:3000",
            "model-a",
            "high",
          )
        ).json(),
      ).toMatchObject({ duplicate: true });
      expect(
        (
          await send(
            id,
            key,
            "Continue",
            "http://localhost:3000",
            "model-a",
            "medium",
          )
        ).status,
      ).toBe(409);
    });
    it("serializes competing effort changes without altering an accepted message", async () => {
      const id = await task("completed");
      await db()
        .update(tasks)
        .set({ requestedModel: "model-a", requestedReasoningEffort: null })
        .where(eq(tasks.id, id));
      const responses = await Promise.all([
        send(
          id,
          randomUUID(),
          "First",
          "http://localhost:3000",
          "model-a",
          "high",
        ),
        send(
          id,
          randomUUID(),
          "Second",
          "http://localhost:3000",
          "model-a",
          "medium",
        ),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        202, 409,
      ]);
      const messages = await db()
        .select()
        .from(taskMessages)
        .where(eq(taskMessages.taskId, id));
      const [session] = await db().select().from(tasks).where(eq(tasks.id, id));
      expect(messages).toHaveLength(1);
      expect(session?.requestedReasoningEffort).toBe(
        messages[0]?.requestedReasoningEffort,
      );
    });
    it("persists a selected model with the message while keeping the task context", async () => {
      const id = await task("completed");
      expect(
        (
          await send(
            id,
            randomUUID(),
            "Continue",
            "http://localhost:3000",
            "model-a",
          )
        ).status,
      ).toBe(202);
      const [stored] = await db()
        .select()
        .from(taskMessages)
        .where(eq(taskMessages.taskId, id));
      const [session] = await db().select().from(tasks).where(eq(tasks.id, id));
      expect(stored).toMatchObject({
        requestedModel: "model-a",
        requestedReasoningEffort: "medium",
        content: "Continue",
      });
      expect(session).toMatchObject({
        requestedModel: "model-a",
        repositoryId,
        objective: "Original objective",
        status: "queued",
      });
    });
    it("serializes competing model switches under the same task lock", async () => {
      const id = await task("completed");
      const responses = await Promise.all([
        send(id, randomUUID(), "First", "http://localhost:3000", "model-a"),
        send(id, randomUUID(), "Second", "http://localhost:3000", "model-b"),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        202, 409,
      ]);
      const messages = await db()
        .select()
        .from(taskMessages)
        .where(eq(taskMessages.taskId, id));
      expect(messages).toHaveLength(1);
      const [session] = await db().select().from(tasks).where(eq(tasks.id, id));
      expect(session?.requestedModel).toBe(messages[0]?.requestedModel);
    });
    it("replays model selection retries without enqueueing a second turn", async () => {
      const id = await task("completed"),
        key = randomUUID();
      expect(
        (await send(id, key, "Continue", "http://localhost:3000", "model-a"))
          .status,
      ).toBe(202);
      expect(
        await (
          await send(id, key, "Continue", "http://localhost:3000", "model-a")
        ).json(),
      ).toMatchObject({ duplicate: true });
      expect(
        (await send(id, key, "Continue", "http://localhost:3000", "model-b"))
          .status,
      ).toBe(409);
      expect(
        await db()
          .select()
          .from(taskMessages)
          .where(eq(taskMessages.taskId, id)),
      ).toHaveLength(1);
    });
    it("deduplicates concurrent retries and orders distinct messages", async () => {
      const id = await task();
      const key = randomUUID();
      const results = await Promise.all([
        send(id, key),
        send(id, key),
        send(id),
      ]);
      expect(results.map((response) => response.status)).toEqual([
        202, 202, 202,
      ]);
      expect(
        await db()
          .select()
          .from(taskMessages)
          .where(eq(taskMessages.taskId, id)),
      ).toHaveLength(2);
      const events = await db()
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.taskId, id));
      expect(events.map((event) => event.sequence).sort()).toEqual([1, 2]);
      expect((await send(id, key, "Different content")).status).toBe(409);
    });
    it("rejects cross-tenant access without revealing the session", async () => {
      expect((await send(`another_tenant_${randomUUID()}`)).status).toBe(404);
    });
    it("rejects cross-origin requests", async () => {
      expect(
        (
          await send(
            await task(),
            randomUUID(),
            "Test",
            "https://attacker.invalid",
          )
        ).status,
      ).toBe(403);
    });
    it("rejects read-only members", async () => {
      fixture.role = "viewer";
      try {
        expect((await send(await task())).status).toBe(403);
      } finally {
        fixture.role = "owner";
      }
    });
    it("rejects archived sessions", async () => {
      const id = await task();
      await db()
        .update(tasks)
        .set({ archivedAt: new Date().toISOString() })
        .where(eq(tasks.id, id));
      expect((await send(id)).status).toBe(409);
    });
  },
);
