import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  auditLogs,
  closeDatabase,
  db,
  eq,
  organizations,
  outbox,
  skills,
  tasks,
  taskMessages,
  users,
  listChatSkills,
} from "@nimbus/database";
const identity = vi.hoisted(() => ({
  userId: `skills_user_${Date.now()}`,
  organizationId: `skills_org_${Date.now()}`,
  role: "owner",
}));
vi.mock("@/lib/auth", () => ({ currentIdentity: async () => identity }));
describe.runIf(process.env.NIMBUS_TASK_DATABASE_TEST === "true")(
  "chat skills persistence and authorization",
  () => {
    const taskId = `skills_task_${randomUUID()}`;
    let skillId: string;
    const request = (
      method: string,
      body: unknown,
      origin = "http://localhost:3000",
    ) =>
      new Request("http://localhost:3000/api/skills", {
        method,
        headers: {
          host: "localhost:3000",
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    beforeAll(async () => {
      await db()
        .insert(users)
        .values({
          id: identity.userId,
          email: `${identity.userId}@example.invalid`,
          name: "Skills test",
        });
      await db().insert(organizations).values({
        id: identity.organizationId,
        name: "Skills tests",
        slug: identity.organizationId,
      });
      await db().insert(tasks).values({
        id: taskId,
        organizationId: identity.organizationId,
        createdByUserId: identity.userId,
        title: "Skill fixture",
        objective: "Test",
        status: "running",
        baseRef: "",
      });
    });
    afterAll(async () => {
      identity.role = "owner";
      await db().delete(outbox).where(eq(outbox.aggregateId, taskId));
      await db().delete(tasks).where(eq(tasks.id, taskId));
      await db()
        .delete(auditLogs)
        .where(eq(auditLogs.organizationId, identity.organizationId));
      await db()
        .delete(skills)
        .where(eq(skills.organizationId, identity.organizationId));
      await db()
        .delete(organizations)
        .where(eq(organizations.id, identity.organizationId));
      await db().delete(users).where(eq(users.id, identity.userId));
      await closeDatabase();
    });
    it("creates and reads only owned skills; rejects invalid inputs, origins and viewers", async () => {
      const api = await import("../app/api/skills/route.js");
      expect(
        (await api.POST(request("POST", { name: "A", description: "B" })))
          .status,
      ).toBe(400);
      const content = {
        name: "Brief",
        description: "Brief output",
        summary: "Use three sentences.",
      };
      expect(
        (await api.POST(request("POST", content, "https://evil.invalid")))
          .status,
      ).toBe(403);
      identity.role = "viewer";
      expect((await api.POST(request("POST", content))).status).toBe(403);
      identity.role = "owner";
      const created = await api.POST(request("POST", content));
      expect(created.status).toBe(201);
      skillId = (await created.json()).id;
      expect(
        (await listChatSkills(identity.organizationId, identity.userId))[0]
          ?.summary,
      ).toBe(content.summary);
      expect(await listChatSkills("foreign-org", identity.userId)).toEqual([]);
      expect(
        await listChatSkills(identity.organizationId, "foreign-user"),
      ).toEqual([]);
      expect(
        (await db().select().from(tasks).where(eq(tasks.id, taskId)))[0]
          ?.selectedSkillIds,
      ).toEqual([]);
      expect(
        (await api.PUT(request("PUT", { id: "foreign", ...content }))).status,
      ).toBe(404);
    });
    it("snapshots selected content, persists selection, and preserves queued snapshots across editing/deletion", async () => {
      const { POST } = await import(
        "../app/api/tasks/[taskId]/messages/route.js"
      );
      const submit = (body: unknown) =>
        POST(request("POST", body), { params: Promise.resolve({ taskId }) });
      const key = randomUUID(),
        content = "Follow this skill";
      const response = await submit({
        content,
        skillIds: [skillId],
        idempotencyKey: key,
      });
      expect(response.status).toBe(202);
      const messageId = (await response.json()).messageId;
      const [saved] = await db()
        .select()
        .from(taskMessages)
        .where(eq(taskMessages.id, messageId));
      expect(saved?.selectedSkills[0]?.summary).toBe("Use three sentences.");
      expect(
        (await submit({ content, skillIds: [], idempotencyKey: key })).status,
      ).toBe(409);
      const api = await import("../app/api/skills/route.js");
      expect(
        (
          await api.PUT(
            request("PUT", {
              id: skillId,
              name: "Brief",
              description: "Brief output",
              summary: "Use two sentences.",
            }),
          )
        ).status,
      ).toBe(200);
      const next = await submit({
        content: "Again",
        idempotencyKey: randomUUID(),
      });
      expect(next.status).toBe(202);
      const [nextSaved] = await db()
        .select()
        .from(taskMessages)
        .where(eq(taskMessages.id, (await next.json()).messageId));
      expect(nextSaved?.selectedSkills[0]?.summary).toBe("Use two sentences.");
      expect(
        (await api.DELETE(request("DELETE", { id: skillId }))).status,
      ).toBe(200);
      expect((await db().select().from(tasks).where(eq(tasks.id, taskId)))[0]?.selectedSkillIds).toEqual([]);
      expect(
        await listChatSkills(identity.organizationId, identity.userId),
      ).toEqual([]);
      expect(
        (
          await db()
            .select()
            .from(taskMessages)
            .where(eq(taskMessages.id, messageId))
        )[0]?.selectedSkills[0]?.summary,
      ).toBe("Use three sentences.");
      expect(
        (
          await submit({
            content: "Deleted skill",
            skillIds: [skillId],
            idempotencyKey: randomUUID(),
          })
        ).status,
      ).toBe(400);
      const cleared = await submit({
        content: "No skill",
        skillIds: [],
        idempotencyKey: randomUUID(),
      });
      expect(cleared.status).toBe(202);
      expect(
        (await db().select().from(tasks).where(eq(tasks.id, taskId)))[0]
          ?.selectedSkillIds,
      ).toEqual([]);
    });
  },
);
