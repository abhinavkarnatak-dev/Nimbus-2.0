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
          body: JSON.stringify({ content, idempotencyKey: key }),
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
