import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  auditLogs,
  closeDatabase,
  db,
  eq,
  organizations,
  outbox,
  tasks,
  users,
  workspaces,
} from "@nimbus/database";

const identity = vi.hoisted(() => ({
  userId: `chat_user_${Date.now()}`,
  organizationId: `chat_org_${Date.now()}`,
  role: "owner",
}));
vi.mock("@/lib/auth", () => ({ currentIdentity: async () => identity }));
vi.mock("@/lib/codex-models", async (original) => ({
  ...(await original<typeof import("./codex-models")>()),
  getSelectableCodexModels: async () => [
    { id: "fake-codex-test-provider", label: "Test" },
  ],
}));

describe.runIf(process.env.NIMBUS_TASK_DATABASE_TEST === "true")(
  "general chat persistence without GitHub",
  () => {
    const ids: string[] = [];
    beforeAll(async () => {
      await db()
        .insert(users)
        .values({
          id: identity.userId,
          name: "Chat test",
          email: `${identity.userId}@example.invalid`,
        });
      await db().insert(organizations).values({
        id: identity.organizationId,
        name: "Chat tests",
        slug: identity.organizationId,
      });
    });
    afterAll(async () => {
      for (const id of ids) {
        await vi.waitFor(
          async () => {
            const [row] = await db()
              .select()
              .from(tasks)
              .where(eq(tasks.id, id));
            expect(
              ["completed", "failed", "cancelled"].includes(
                row?.status ?? "completed",
              ),
            ).toBe(true);
          },
          { timeout: 30_000, interval: 200 },
        );
        await db().delete(outbox).where(eq(outbox.aggregateId, id));
        await db().delete(tasks).where(eq(tasks.id, id));
      }
      await db()
        .delete(auditLogs)
        .where(eq(auditLogs.organizationId, identity.organizationId));
      await db()
        .delete(organizations)
        .where(eq(organizations.id, identity.organizationId));
      await db().delete(users).where(eq(users.id, identity.userId));
      await closeDatabase();
    });
    it("creates a short general request, keeps it in history, and resumes without repository authorization", async () => {
      const { POST } = await import("../app/api/tasks/route.js");
      const body = new FormData();
      body.set("objective", "Hi");
      body.set("repositoryId", "");
      body.set("model", "fake-codex-test-provider");
      body.set("idempotencyKey", randomUUID());
      const response = await POST(
        new Request("http://localhost:3000/api/tasks", {
          method: "POST",
          headers: { accept: "application/json" },
          body,
        }),
      );
      expect(response.status).toBe(201);
      const { taskId } = await response.json();
      ids.push(taskId);
      const [task] = await db()
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId));
      expect(task?.repositoryId).toBeNull();
      expect(task?.baseRef).toBe("");
      const { listTasks, getTaskDetail } = await import("./task-data.js");
      expect(
        (await listTasks(identity.organizationId)).some(
          (t) => t.id === taskId && t.repository === null,
        ),
      ).toBe(true);
      expect(
        (await getTaskDetail(identity.organizationId, taskId))?.task.id,
      ).toBe(taskId);
      expect(await getTaskDetail("other-org", taskId)).toBeNull();
      await db()
        .update(tasks)
        .set({ status: "completed" })
        .where(eq(tasks.id, taskId));
      const { POST: followup } = await import(
        "../app/api/tasks/[taskId]/messages/route.js"
      );
      const result = await followup(
        new Request(`http://localhost:3000/api/tasks/${taskId}/messages`, {
          method: "POST",
          headers: {
            host: "localhost:3000",
            origin: "http://localhost:3000",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            content: "Continue chatting",
            idempotencyKey: randomUUID(),
          }),
        }),
        { params: Promise.resolve({ taskId }) },
      );
      expect(result.status).toBe(202);
      expect(
        await db()
          .select()
          .from(workspaces)
          .where(eq(workspaces.taskId, taskId)),
      ).toHaveLength(0);
    }, 30_000);
    it("does not turn an invalid explicitly selected repository into general chat", async () => {
      const { POST } = await import("../app/api/tasks/route.js");
      const body = new FormData();
      body.set("objective", "Hi");
      body.set("repositoryId", "repo_nonexistent");
      body.set("model", "fake-codex-test-provider");
      body.set("idempotencyKey", randomUUID());
      expect(
        (
          await POST(
            new Request("http://localhost:3000/api/tasks", {
              method: "POST",
              body,
            }),
          )
        ).status,
      ).toBe(404);
    });
  },
);
