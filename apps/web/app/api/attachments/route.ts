import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  db,
  eq,
  gt,
  isNull,
  messageAttachments,
  taskMessages,
  tasks,
  users,
} from "@nimbus/database";
import { currentIdentity } from "@/lib/auth";
import type { attachmentStorage } from "@/lib/attachment-storage";
import {
  attachmentProblem,
  MAX_ATTACHMENTS,
  MAX_EXTRACTED_BYTES,
} from "@/lib/attachment-policy";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const signSchema = z
  .object({
    action: z.literal("sign"),
    files: z
      .array(
        z
          .object({
            name: z.string().max(200),
            size: z.number().int().positive(),
            type: z.string().max(150),
            textSize: z.number().int().min(1).max(MAX_EXTRACTED_BYTES),
            warning: z.string().max(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_ATTACHMENTS),
  })
  .strict();
const finishSchema = z
  .object({
    action: z.literal("finish"),
    id: z.string().regex(/^att_[a-f0-9]{32}$/),
  })
  .strict();
const headers = { "cache-control": "no-store" };
let storageModule:
  | Promise<typeof import("../../../lib/attachment-storage.js")>
  | undefined;
async function openStorage() {
  const { attachmentStorage } = await (storageModule ??= import(
    "../../../lib/attachment-storage.js"
  ).catch((error) => {
    storageModule = undefined;
    throw error;
  }));
  return attachmentStorage();
}
function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers });
}
export async function POST(request: Request) {
  const identity = await currentIdentity();
  if (!identity) return fail("Sign in first.", 401);
  if (identity.role === "viewer")
    return fail("Upload permission required.", 403);
  try {
    if (
      new URL(request.headers.get("origin") ?? "").host !==
      request.headers.get("host")
    )
      return fail("Invalid request origin.", 403);
  } catch {
    return fail("Invalid request origin.", 403);
  }
  const reader = request.body?.getReader();
  if (!reader) return fail("Missing request.");
  let body = "";
  const decoder = new TextDecoder();
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 16_384) return fail("Upload request is too large.", 413);
      body += decoder.decode(part.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return fail("Invalid upload request.");
  }
  const signing = signSchema.safeParse(input);
  const finishing = finishSchema.safeParse(input);
  if (!signing.success && !finishing.success)
    return fail("Choose between one and six files per message.");
  let storage: ReturnType<typeof attachmentStorage>;
  try {
    storage = await openStorage();
  } catch {
    return fail(
      "Attachment storage is not configured. Contact the workspace owner.",
      503,
    );
  }
  try {
    if (signing.success) {
      for (const file of signing.data.files) {
        const problem = attachmentProblem(file.name, file.size, file.type);
        if (problem) return fail(problem);
      }
      const rows = await db().transaction(async (tx) => {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, identity.userId))
          .for("update");
        const pending = await tx
          .select({ id: messageAttachments.id })
          .from(messageAttachments)
          .where(
            and(
              eq(messageAttachments.organizationId, identity.organizationId),
              eq(messageAttachments.userId, identity.userId),
              isNull(messageAttachments.messageId),
              gt(
                messageAttachments.createdAt,
                new Date(Date.now() - 86_400_000).toISOString(),
              ),
            ),
          )
          .limit(31);
        if (pending.length + signing.data.files.length > 30)
          throw new Error(
            "Too many unfinished uploads. Remove unused attachments first.",
          );
        const items = signing.data.files.map((file) => {
          const id = `att_${randomUUID().replaceAll("-", "")}`;
          return {
            id,
            organizationId: identity.organizationId,
            userId: identity.userId,
            name: file.name,
            size: file.size,
            contentType: file.type || "application/octet-stream",
            objectKey: `staging/${identity.organizationId}/${identity.userId}/${id}/original`,
            textKey: `staging/${identity.organizationId}/${identity.userId}/${id}/text`,
            extractionWarning: file.warning ?? null,
          };
        });
        await tx.insert(messageAttachments).values(items);
        return items;
      });
      const uploads = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        uploads.push({
          id: row.id,
          url: await storage.uploads(row.objectKey, row.size),
          textUrl: await storage.uploads(
            row.textKey,
            signing.data.files[i]!.textSize,
          ),
        });
      }
      return Response.json({ uploads }, { headers });
    }
    const id = finishing.data!.id;
    return await db().transaction(async (tx) => {
      // Serialize finalization with binding/removal. A duplicate finish must never
      // overwrite a bound file from a still-valid staging PUT.
      const [row] = await tx
        .select()
        .from(messageAttachments)
        .where(
          and(
            eq(messageAttachments.id, id),
            eq(messageAttachments.organizationId, identity.organizationId),
            eq(messageAttachments.userId, identity.userId),
          ),
        )
        .for("update");
      if (!row || row.messageId) return fail("Upload is unavailable.", 404);
      if (row.status === "ready") return Response.json({ id }, { headers });
      const key = `files/${identity.organizationId}/${identity.userId}/${id}/original`;
      const textKey = `files/${identity.organizationId}/${identity.userId}/${id}/text`;
      await storage.finalize(
        row.objectKey,
        row.textKey,
        row.size,
        key,
        textKey,
      );
      await tx
        .update(messageAttachments)
        .set({
          status: "ready",
          objectKey: key,
          textKey,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(messageAttachments.id, id),
            eq(messageAttachments.status, "uploading"),
          ),
        );
      return Response.json({ id }, { headers });
    });
  } catch (error) {
    return fail(
      error instanceof Error &&
        /unfinished|size|Audio|video/.test(error.message)
        ? error.message
        : "Upload could not be verified. Check R2 configuration and retry.",
      400,
    );
  } finally {
    storage.close();
  }
}
export async function GET(request: Request) {
  const identity = await currentIdentity();
  if (!identity) return fail("Sign in first.", 401);
  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId");
  const id = url.searchParams.get("id");
  if (taskId && /^task_[a-f0-9]{32}$/.test(taskId)) {
    const [task] = await db()
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.organizationId, identity.organizationId),
        ),
      );
    if (!task) return fail("Task unavailable.", 404);
    const files = await db()
      .select({
        id: messageAttachments.id,
        name: messageAttachments.name,
        size: messageAttachments.size,
        messageId: messageAttachments.messageId,
        extractionWarning: messageAttachments.extractionWarning,
      })
      .from(messageAttachments)
      .where(
        and(
          eq(messageAttachments.taskId, taskId),
          eq(messageAttachments.organizationId, identity.organizationId),
        ),
      )
      .limit(600);
    const [first] = await db()
      .select({ id: taskMessages.id })
      .from(taskMessages)
      .where(eq(taskMessages.taskId, taskId))
      .orderBy(asc(taskMessages.createdAt))
      .limit(1);
    return Response.json(
      { files, initialMessageId: first?.id ?? null },
      { headers },
    );
  }
  if (!id || !/^att_[a-f0-9]{32}$/.test(id)) return fail("Invalid attachment.");
  const [file] = await db()
    .select()
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.id, id),
        eq(messageAttachments.organizationId, identity.organizationId),
      ),
    );
  if (
    !file ||
    (!file.taskId && file.userId !== identity.userId) ||
    file.status === "uploading"
  )
    return fail("File unavailable.", 404);
  let storage: ReturnType<typeof attachmentStorage>;
  try {
    storage = await openStorage();
  } catch {
    return fail("Attachment storage is unavailable.", 503);
  }
  try {
    return new Response(null, {
      status: 302,
      headers: {
        ...headers,
        location: await storage.download(
          file.objectKey,
          file.name,
          url.searchParams.get("preview") === "1",
        ),
      },
    });
  } catch {
    return fail("File download is temporarily unavailable.", 503);
  } finally {
    storage.close();
  }
}
export async function DELETE(request: Request) {
  const identity = await currentIdentity();
  if (!identity || identity.role === "viewer")
    return fail("Upload permission required.", 403);
  try {
    if (
      new URL(request.headers.get("origin") ?? "").host !==
      request.headers.get("host")
    )
      return fail("Invalid request origin.", 403);
  } catch {
    return fail("Invalid request origin.", 403);
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^att_[a-f0-9]{32}$/.test(id)) return fail("Invalid attachment.");
  let storage: ReturnType<typeof attachmentStorage>;
  try {
    storage = await openStorage();
  } catch {
    return fail("Attachment storage is unavailable.", 503);
  }
  try {
    await db().transaction(async (tx) => {
      const [file] = await tx
        .select()
        .from(messageAttachments)
        .where(
          and(
            eq(messageAttachments.id, id),
            eq(messageAttachments.organizationId, identity.organizationId),
            eq(messageAttachments.userId, identity.userId),
            isNull(messageAttachments.messageId),
          ),
        )
        .for("update");
      if (!file) return;
      await storage.remove(file.objectKey);
      await storage.remove(file.textKey);
      await tx.delete(messageAttachments).where(eq(messageAttachments.id, id));
    });
    return Response.json({ removed: true }, { headers });
  } catch {
    return fail("Could not remove the upload. Retry shortly.", 503);
  } finally {
    storage.close();
  }
}
