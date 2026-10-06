import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  codexThreads,
  codexTurns,
  db,
  eq,
  inArray,
  sql,
  taskEvents,
  taskMessages,
  tasks,
} from "./index.js";

export async function activeRequestId(taskId: string): Promise<string | null> {
  const messages = await db()
    .select({ id: taskMessages.id, status: taskMessages.status })
    .from(taskMessages)
    .where(
      and(
        eq(taskMessages.taskId, taskId),
        inArray(taskMessages.status, ["running", "cancelling", "queued"]),
      ),
    )
    .orderBy(asc(taskMessages.createdAt), asc(taskMessages.id));
  return (
    (messages.find((m) => m.status !== "queued") ?? messages[0])?.id ?? null
  );
}

// The task lock serializes stop, worker claim/completion, and follow-up enqueue.
export async function stopRequest(
  taskId: string,
  organizationId: string,
  messageId: string,
) {
  return db().transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)),
      )
      .for("update");
    if (!task) return { status: 404, error: "Session not found" };
    const [message] = await tx
      .select()
      .from(taskMessages)
      .where(
        and(eq(taskMessages.id, messageId), eq(taskMessages.taskId, taskId)),
      );
    if (!message) return { status: 404, error: "Request not found" };
    if (["cancelled", "cancelling"].includes(message.status))
      return { status: 202, messageId };
    if (
      task.archivedAt ||
      ![
        "queued",
        "provisioning",
        "running",
        "preparing_pr",
        "pushing",
        "creating_pr",
      ].includes(task.status)
    )
      return { status: 409, error: "This request is no longer running" };
    const pending = await tx
      .select()
      .from(taskMessages)
      .where(
        and(
          eq(taskMessages.taskId, taskId),
          inArray(taskMessages.status, ["running", "queued"]),
        ),
      )
      .orderBy(asc(taskMessages.createdAt), asc(taskMessages.id));
    const current = pending.find((m) => m.status === "running") ?? pending[0];
    if (current?.id !== messageId)
      return {
        status: 409,
        error: "The active request has changed. Try again.",
      };
    const immediate = task.status === "queued";
    const now = new Date().toISOString();
    await tx
      .update(taskMessages)
      .set({
        status: immediate ? "cancelled" : "cancelling",
        completedAt: immediate ? now : null,
        updatedAt: now,
      })
      .where(eq(taskMessages.id, messageId));
    await tx
      .update(tasks)
      .set({
        status: immediate
          ? pending.length > 1
            ? "queued"
            : "cancelled"
          : "cancelling",
        completedAt: immediate && pending.length === 1 ? now : null,
        failureCode: null,
        updatedAt: now,
        version: sql`${tasks.version}+1`,
      })
      .where(eq(tasks.id, taskId));
    const events = await tx
      .select({ sequence: taskEvents.sequence })
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskId))
      .orderBy(asc(taskEvents.sequence));
    await tx.insert(taskEvents).values({
      id: `evt_${randomUUID()}`,
      taskId,
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      category: "lifecycle",
      phase: immediate ? "cancelled" : "cancelling",
      status: immediate ? "cancelled" : "running",
      title: immediate ? "Request stopped" : "Stopping request",
      whatWasDone: immediate
        ? "This request was stopped before execution."
        : "Nimbus is interrupting this request. Completed actions are not undone.",
      whyItWasDone:
        "The user stopped this request; the session remains open for follow-ups.",
      evidence: [`task-message:${messageId}`],
      correlationId: randomUUID(),
    });
    return { status: 202, messageId };
  });
}

export async function requestWasStopped(messageId: string): Promise<boolean> {
  const [message] = await db()
    .select({ status: taskMessages.status })
    .from(taskMessages)
    .where(eq(taskMessages.id, messageId));
  return message?.status === "cancelling" || message?.status === "cancelled";
}

export async function finishStoppedRequest(
  taskId: string,
  messageId: string,
  turnId?: string,
): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .for("update");
    if (!task) return false;
    const [message] = await tx
      .select()
      .from(taskMessages)
      .where(
        and(eq(taskMessages.id, messageId), eq(taskMessages.taskId, taskId)),
      );
    if (!message || message.status !== "cancelling") return false;
    const now = new Date().toISOString();
    await tx
      .update(taskMessages)
      .set({ status: "cancelled", completedAt: now, updatedAt: now })
      .where(eq(taskMessages.id, messageId));
    if (turnId)
      await tx
        .update(codexTurns)
        .set({ status: "interrupted", completedAt: now })
        .where(eq(codexTurns.id, turnId));
    await tx
      .update(codexThreads)
      .set({ lastConfirmedCompletionStatus: "interrupted" })
      .where(eq(codexThreads.taskId, taskId));
    const [pending] = await tx
      .select({ id: taskMessages.id })
      .from(taskMessages)
      .where(
        and(eq(taskMessages.taskId, taskId), eq(taskMessages.status, "queued")),
      )
      .limit(1);
    await tx
      .update(tasks)
      .set({
        status: pending ? "queued" : "cancelled",
        completedAt: pending ? null : now,
        failureCode: null,
        updatedAt: now,
        version: sql`${tasks.version}+1`,
      })
      .where(eq(tasks.id, taskId));
    const events = await tx
      .select({ sequence: taskEvents.sequence })
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskId))
      .orderBy(asc(taskEvents.sequence));
    await tx.insert(taskEvents).values({
      id: `evt_${randomUUID()}`,
      taskId,
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      category: "lifecycle",
      phase: "cancelled",
      status: "cancelled",
      title: "Request stopped",
      whatWasDone:
        "This request was interrupted. The conversation and existing changes are preserved.",
      whyItWasDone:
        "Only this request was stopped; other queued messages and future follow-ups remain available.",
      evidence: [`task-message:${messageId}`],
      correlationId: randomUUID(),
    });
    return true;
  });
}
