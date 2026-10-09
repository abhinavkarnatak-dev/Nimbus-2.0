import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  and,
  closeDatabase,
  db,
  eq,
  messageAttachments,
  organizations,
  taskMessages,
  tasks,
  users,
  outbox,
  auditLogs,
} from "@nimbus/database";
const identity = vi.hoisted(() => ({
  userId: `attachment_user_${Date.now()}`,
  organizationId: `attachment_org_${Date.now()}`,
  role: "owner",
}));
const storage = vi.hoisted(() => ({
  finalize: vi.fn().mockResolvedValue(undefined),
  uploads: vi.fn().mockResolvedValue("https://example.invalid/upload"),
  remove: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  download: vi.fn().mockResolvedValue("https://example.invalid/download"),
}));
vi.mock("@/lib/auth", () => ({ currentIdentity: async () => identity }));
vi.mock("./attachment-storage", () => ({ attachmentStorage: () => storage }));
import {
  POST as upload,
  DELETE as remove,
  GET as list,
} from "../app/api/attachments/route";
import { POST as followup } from "../app/api/tasks/[taskId]/messages/route";
describe.runIf(process.env.NIMBUS_ATTACHMENT_DATABASE_TEST === "true")(
  "attachment routes against disposable PostgreSQL",
  () => {
    const taskId = `task_${randomUUID().replaceAll("-", "")}`,
      otherUser = identity.userId + "_other";
    beforeAll(async () => {
      if (
        !/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):/.test(
          process.env.DATABASE_URL ?? "",
        )
      )
        throw new Error(
          "Attachment tests require a disposable localhost database.",
        );
      await db()
        .insert(users)
        .values([
          {
            id: identity.userId,
            name: "Attachment test",
            email: identity.userId + "@example.invalid",
          },
          {
            id: otherUser,
            name: "Other",
            email: otherUser + "@example.invalid",
          },
        ]);
      await db().insert(organizations).values({
        id: identity.organizationId,
        slug: identity.organizationId,
        name: "Attachment tests",
      });
      await db().insert(tasks).values({
        id: taskId,
        organizationId: identity.organizationId,
        createdByUserId: identity.userId,
        title: "Attachment task",
        objective: "Original",
        baseRef: "main",
        status: "completed",
      });
    });
    afterAll(async () => {
      await db().delete(outbox).where(eq(outbox.aggregateId, taskId));
      await db()
        .delete(auditLogs)
        .where(eq(auditLogs.organizationId, identity.organizationId));
      await db()
        .delete(organizations)
        .where(eq(organizations.id, identity.organizationId));
      await db().delete(users).where(eq(users.id, identity.userId));
      await db().delete(users).where(eq(users.id, otherUser));
      await closeDatabase();
    });
    function request(
      body: unknown,
      method = "POST",
      path = "/api/attachments",
    ) {
      return new Request("http://localhost:3000" + path, {
        method,
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      });
    }
    async function ready(count: number, owner = identity.userId) {
      const ids = Array.from(
        { length: count },
        () => `att_${randomUUID().replaceAll("-", "")}`,
      );
      await db()
        .insert(messageAttachments)
        .values(
          ids.map((id) => ({
            id,
            organizationId: identity.organizationId,
            userId: owner,
            name: "notes.txt",
            size: 4,
            contentType: "text/plain",
            objectKey: "files/" + id,
            textKey: "text/" + id,
            status: "ready",
          })),
        );
      return ids;
    }
    async function send(ids: string[], key: string = randomUUID()) {
      return followup(
        request(
          {
            content: "Use these files",
            idempotencyKey: key,
            attachmentIds: ids,
          },
          "POST",
          `/api/tasks/${taskId}/messages`,
        ),
        { params: Promise.resolve({ taskId }) },
      );
    }
    it("accepts mixed sign metadata but rejects seven and media", async () => {
      const files = ["a.txt", "b.csv", "c.pdf", "d.docx", "e.xlsx", "f.ts"].map(
        (name) => ({ name, size: 4, type: "", textSize: 4 }),
      );
      expect((await upload(request({ action: "sign", files }))).status).toBe(
        200,
      );
      expect(
        (await upload(request({ action: "sign", files: [...files, files[0]] })))
          .status,
      ).toBe(400);
      expect(
        (
          await upload(
            request({
              action: "sign",
              files: [{ ...files[0], name: "a.mp3" }],
            }),
          )
        ).status,
      ).toBe(400);
    });
    it("binds six files per message, retains retry ids and accepts another six", async () => {
      const first = await ready(6),
        key = randomUUID();
      const one = await send(first, key);
      expect(one.status).toBe(202);
      const result = await one.json();
      const retry = await send(first, key);
      expect(await retry.json()).toMatchObject({
        duplicate: true,
        messageId: result.messageId,
      });
      expect((await send(await ready(6))).status).toBe(202);
      const rows = await db()
        .select()
        .from(taskMessages)
        .where(eq(taskMessages.taskId, taskId));
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.attachmentIds.length === 6)).toBe(true);
      expect((await send(first, key + "different")).status).toBe(400);
    });
    it("rejects foreign/missing ids atomically and rejects seven on the message endpoint", async () => {
      const before = await db()
        .select()
        .from(taskMessages)
        .where(eq(taskMessages.taskId, taskId));
      expect((await send(await ready(1, otherUser))).status).toBe(400);
      expect((await send([`att_${"f".repeat(32)}`])).status).toBe(400);
      expect((await send(await ready(7))).status).toBe(400);
      expect(
        await db()
          .select()
          .from(taskMessages)
          .where(eq(taskMessages.taskId, taskId)),
      ).toHaveLength(before.length);
    });
    it("serializes duplicate finalization and never recopies already-ready files", async () => {
      const [id] = await ready(1);
      await db()
        .update(messageAttachments)
        .set({ status: "uploading" })
        .where(eq(messageAttachments.id, id!));
      storage.finalize.mockClear();
      const responses = await Promise.all([
        upload(request({ action: "finish", id })),
        upload(request({ action: "finish", id })),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(storage.finalize).toHaveBeenCalledTimes(1);
    });
    it("shows bound downloads in history but prevents deleting sent files", async () => {
      const response = await list(
        request(undefined, "GET", `/api/attachments?taskId=${taskId}`),
      );
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.files).toHaveLength(12);
      expect(result.initialMessageId).toBeTruthy();
      const id = result.files[0].id;
      const preview = await list(
        request(undefined, "GET", `/api/attachments?id=${id}&preview=1`),
      );
      expect(preview.status).toBe(302);
      expect(storage.download).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(String),
        true,
      );
      const organizationId = identity.organizationId;
      identity.organizationId = "foreign_attachment_org";
      try {
        const denied = await list(
          request(undefined, "GET", `/api/attachments?id=${id}&preview=1`),
        );
        expect(denied.status).toBe(404);
      } finally {
        identity.organizationId = organizationId;
      }
      storage.remove.mockClear();
      expect(
        (
          await remove(
            request(undefined, "DELETE", `/api/attachments?id=${id}`),
          )
        ).status,
      ).toBe(200);
      expect(storage.remove).not.toHaveBeenCalled();
      const [file] = await db()
        .select()
        .from(messageAttachments)
        .where(
          and(
            eq(messageAttachments.id, id),
            eq(messageAttachments.taskId, taskId),
          ),
        );
      expect(file).toBeTruthy();
    });
    it("enforces six in the database, not just the browser", async () => {
      await expect(
        db()
          .insert(taskMessages)
          .values({
            id: "msg_" + randomUUID(),
            taskId,
            userId: identity.userId,
            content: "bad",
            idempotencyKey: randomUUID(),
            attachmentIds: Array(7).fill("att_" + "0".repeat(32)),
          }),
      ).rejects.toMatchObject({
        cause: {
          code: "23514",
          constraint_name: "task_messages_attachment_limit",
        },
      });
    });
  },
);
