import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activeRequestId,
  auditLogs,
  outbox,
  closeDatabase,
  codexThreads,
  codexTurns,
  db,
  eq,
  finishStoppedRequest,
  inArray,
  organizations,
  requestWasStopped,
  stopRequest,
  taskEvents,
  taskMessages,
  tasks,
  users,
} from "@nimbus/database";
const fixture = vi.hoisted(() => ({
  userId: `stop_user_${Date.now()}`,
  organizationId: `stop_org_${Date.now()}`,
  role: "owner",
}));
vi.mock("@/lib/auth", () => ({ currentIdentity: async () => fixture }));
describe.runIf(process.env.NIMBUS_TASK_DATABASE_TEST === "true")(
  "request cancellation against PostgreSQL",
  () => {
    const ids: string[] = [];
    beforeAll(async () => {
      await db()
        .insert(users)
        .values({
          id: fixture.userId,
          name: "Stop test",
          email: `${fixture.userId}@example.invalid`,
        });
      await db().insert(organizations).values({
        id: fixture.organizationId,
        slug: fixture.organizationId,
        name: "Stop test",
      });
    });
    afterAll(async () => {
      if (ids.length) {
        const threads = await db()
          .select({ id: codexThreads.id })
          .from(codexThreads)
          .where(inArray(codexThreads.taskId, ids));
        if (threads.length)
          await db()
            .delete(codexTurns)
            .where(
              inArray(
                codexTurns.codexThreadId,
                threads.map((t) => t.id),
              ),
            );
        await db().delete(outbox).where(inArray(outbox.aggregateId, ids));
        await db()
          .delete(auditLogs)
          .where(eq(auditLogs.organizationId, fixture.organizationId));
        await db().delete(tasks).where(inArray(tasks.id, ids));
      }
      await db()
        .delete(organizations)
        .where(eq(organizations.id, fixture.organizationId));
      await db().delete(users).where(eq(users.id, fixture.userId));
      await closeDatabase();
    });
    async function task(status: "running" | "queued" = "running") {
      const id = `stop_task_${randomUUID()}`,
        messageId = `stop_msg_${randomUUID()}`;
      ids.push(id);
      await db().insert(tasks).values({
        id,
        organizationId: fixture.organizationId,
        createdByUserId: fixture.userId,
        title: "Stop fixture",
        objective: "Stop fixture",
        status,
        baseRef: "",
      });
      await db()
        .insert(taskMessages)
        .values({
          id: messageId,
          taskId: id,
          userId: fixture.userId,
          content: "First request",
          status: status === "queued" ? "queued" : "running",
          idempotencyKey: randomUUID(),
        });
      return { id, messageId };
    }
    it("stops one running request, preserves later messages, and is idempotent", async () => {
      const { id, messageId } = await task();
      const second = `stop_msg_${randomUUID()}`;
      await db()
        .insert(taskMessages)
        .values({
          id: second,
          taskId: id,
          userId: fixture.userId,
          content: "Follow-up",
          idempotencyKey: randomUUID(),
          createdAt: new Date(Date.now() + 1000).toISOString(),
        });
      expect(await activeRequestId(id)).toBe(messageId);
      expect(
        (await stopRequest(id, fixture.organizationId, second)).status,
      ).toBe(409);
      expect((await stopRequest(id, "wrong-org", messageId)).status).toBe(404);
      expect(
        (await stopRequest(id, fixture.organizationId, messageId)).status,
      ).toBe(202);
      expect(await requestWasStopped(messageId)).toBe(true);
      expect(
        (await stopRequest(id, fixture.organizationId, messageId)).status,
      ).toBe(202);
      expect(await finishStoppedRequest(id, messageId)).toBe(true);
      expect(await finishStoppedRequest(id, messageId)).toBe(false);
      const [saved] = await db().select().from(tasks).where(eq(tasks.id, id));
      expect(saved?.status).toBe("queued");
      expect(saved?.failureCode).toBeNull();
      const [next] = await db()
        .select()
        .from(taskMessages)
        .where(eq(taskMessages.id, second));
      expect(next?.status).toBe("queued");
      // Hold the fixture away from the live executor after validating the queue.
      await db()
        .update(tasks)
        .set({ status: "paused" })
        .where(eq(tasks.id, id));
      const events = await db()
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.taskId, id));
      expect(events.filter((e) => e.title === "Stopping request")).toHaveLength(
        1,
      );
      expect(events.filter((e) => e.title === "Request stopped")).toHaveLength(
        1,
      );
    });
    it("stops a queued request before execution and accepts future follow-ups", async () => {
      const { id, messageId } = await task("queued");
      expect(
        (await stopRequest(id, fixture.organizationId, messageId)).status,
      ).toBe(202);
      const [saved] = await db().select().from(tasks).where(eq(tasks.id, id));
      expect(saved?.status).toBe("cancelled");
      const { POST } = await import(
        "../app/api/tasks/[taskId]/messages/route.js"
      );
      const response = await POST(
        new Request(`http://localhost:3000/api/tasks/${id}/messages`, {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            host: "localhost:3000",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            content: "Continue here",
            idempotencyKey: randomUUID(),
          }),
        }),
        { params: Promise.resolve({ taskId: id }) },
      );
      expect(response.status).toBe(202);
      await db()
        .update(tasks)
        .set({ status: "paused" })
        .where(eq(tasks.id, id));
    });
    it("rejects unauthorized, viewer, cross-origin, and malformed stop requests", async () => {
      const { id, messageId } = await task();
      const { POST } = await import("../app/api/tasks/[taskId]/stop/route.js");
      const request = (origin: string, body: unknown) =>
        new Request(`http://localhost:3000/api/tasks/${id}/stop`, {
          method: "POST",
          headers: {
            origin,
            host: "localhost:3000",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
      fixture.role = "viewer";
      expect(
        (
          await POST(request("http://localhost:3000", { messageId }), {
            params: Promise.resolve({ taskId: id }),
          })
        ).status,
      ).toBe(403);
      fixture.role = "owner";
      expect(
        (
          await POST(request("https://attacker.invalid", { messageId }), {
            params: Promise.resolve({ taskId: id }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await POST(request("http://localhost:3000", {}), {
            params: Promise.resolve({ taskId: id }),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await POST(request("http://localhost:3000", { messageId }), {
            params: Promise.resolve({ taskId: id }),
          })
        ).status,
      ).toBe(202);
      expect(await finishStoppedRequest(id, messageId)).toBe(true);
    });
  },
);
