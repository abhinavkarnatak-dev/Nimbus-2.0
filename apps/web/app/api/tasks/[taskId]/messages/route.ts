import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  auditLogs,
  db,
  eq,
  outbox,
  repositories,
  sql,
  taskEvents,
  taskMessages,
  tasks,
  resolveChatSkills,
  listChatSkills,
} from "@nimbus/database";
import { currentIdentity } from "@/lib/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTaskTransition, TaskStatusSchema } from "@nimbus/shared";
import { skillIdsSchema } from "@nimbus/shared";

const inputSchema = z.object({
  content: z.string().trim().min(1).max(8000),
  idempotencyKey: z.string().uuid(),
  skillIds: skillIdsSchema.optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (identity.role === "viewer")
    return NextResponse.json(
      { error: "Task write permission required" },
      { status: 403 },
    );
  let origin: URL;
  try {
    origin = new URL(request.headers.get("origin") ?? "");
  } catch {
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  }
  if (
    origin.host !== request.headers.get("host") ||
    !["http:", "https:"].includes(origin.protocol)
  )
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Enter a follow-up of up to 8000 characters" },
      { status: 400 },
    );
  const { taskId } = await context.params;
  const input = parsed.data;
  const result = await db().transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.organizationId, identity.organizationId),
        ),
      )
      .for("update");
    if (!task) return { status: 404, error: "Session not found" };
    if (task.archivedAt || task.status === "cancelling")
      return {
        status: 409,
        error: "This session cannot accept a follow-up right now",
      };
    const [repository] = task.repositoryId
      ? await tx
          .select({ archived: repositories.archived })
          .from(repositories)
          .where(
            and(
              eq(repositories.id, task.repositoryId),
              eq(repositories.organizationId, identity.organizationId),
            ),
          )
      : [];
    if (task.repositoryId && (!repository || repository.archived))
      return { status: 403, error: "Repository access is unavailable" };
    const [existing] = await tx
      .select()
      .from(taskMessages)
      .where(
        and(
          eq(taskMessages.taskId, taskId),
          eq(taskMessages.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing)
      return existing.content === input.content &&
        (input.skillIds === undefined ||
          JSON.stringify(existing.selectedSkills.map((skill) => skill.id)) ===
            JSON.stringify(input.skillIds))
        ? { status: 202, messageId: existing.id, duplicate: true }
        : {
            status: 409,
            error: "Request key was already used for another message",
          };
    const pending = await tx
      .select({ id: taskMessages.id })
      .from(taskMessages)
      .where(
        and(eq(taskMessages.taskId, taskId), eq(taskMessages.status, "queued")),
      )
      .limit(20);
    if (pending.length >= 20)
      return {
        status: 429,
        error: "This session already has 20 queued messages",
      };
    const messageId = `msg_${randomUUID().replaceAll("-", "")}`;
    const available =
      input.skillIds === undefined
        ? await listChatSkills(identity.organizationId, identity.userId)
        : [];
    const ids =
      input.skillIds ??
      task.selectedSkillIds.filter((id) =>
        available.some((skill) => skill.id === id),
      );
    const selectedSkills = await resolveChatSkills(
      identity.organizationId,
      identity.userId,
      ids,
    );
    if (!selectedSkills)
      return {
        status: 400,
        error: "One or more selected skills are unavailable",
      };
    await tx
      .update(tasks)
      .set({ selectedSkillIds: ids })
      .where(eq(tasks.id, taskId));
    await tx.insert(taskMessages).values({
      id: messageId,
      taskId,
      userId: identity.userId,
      content: input.content,
      selectedSkills,
      idempotencyKey: input.idempotencyKey,
    });
    const idle = [
      "completed",
      "failed",
      "cancelled",
      "paused",
      "pr_open",
      "awaiting_user",
    ].includes(task.status);
    if (idle)
      assertTaskTransition({
        from: TaskStatusSchema.parse(task.status),
        to: "queued",
        actor: "user",
        reason: "User sent a follow-up in the existing session",
        at: new Date().toISOString(),
        idempotencyKey: input.idempotencyKey,
        correlationId: input.idempotencyKey,
      });
    if (idle)
      await tx
        .update(tasks)
        .set({
          status: "queued",
          completedAt: null,
          failureCode: null,
          version: sql`${tasks.version} + 1`,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, taskId));
    const events = await tx
      .select({ sequence: taskEvents.sequence })
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskId))
      .orderBy(asc(taskEvents.sequence));
    const correlationId = randomUUID();
    await tx.insert(outbox).values({
      id: `out_${randomUUID()}`,
      aggregateType: "task",
      aggregateId: taskId,
      eventType: "task.followup",
      payload: { taskId, messageId, correlationId },
    });
    await tx.insert(taskEvents).values({
      id: `evt_${randomUUID()}`,
      taskId,
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      category: "conversation",
      phase: idle ? "queued" : task.status,
      status: "succeeded",
      title: "Follow-up received",
      whatWasDone: input.content,
      whyItWasDone: idle
        ? "The session will resume its existing workspace and Codex thread."
        : "This message is queued for the next turn without interrupting the current work.",
      correlationId,
    });
    await tx.insert(auditLogs).values({
      id: `aud_${randomUUID()}`,
      organizationId: identity.organizationId,
      actorType: "user",
      actorId: identity.userId,
      action: "task.followup",
      targetType: "task",
      targetId: taskId,
      correlationId,
      metadata: { messageId },
    });
    return { status: 202, messageId, duplicate: false };
  });
  return NextResponse.json(result, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
