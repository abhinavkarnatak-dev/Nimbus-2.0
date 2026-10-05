import { createHash, randomUUID } from "node:crypto";

import {
  and,
  auditLogs,
  db,
  eq,
  idempotencyKeys,
  outbox,
  repositories,
  taskEvents,
  tasks,
} from "@nimbus/database";
import { currentIdentity } from "@/lib/auth";
import {
  getSelectableCodexModels,
  isSelectableModel,
} from "@/lib/codex-models";
import { deriveTaskTitle } from "@/lib/task-title";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateTaskSchema = z.object({
  repositoryId: z.string().min(12),
  objective: z.string().trim().min(10).max(8000),
  model: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().min(12).max(200),
});

export async function POST(request: Request) {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const raw = Object.fromEntries((await request.formData()).entries());
  const parsed = CreateTaskSchema.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid task", issues: parsed.error.issues },
      { status: 400 },
    );
  const input = parsed.data;
  const title = deriveTaskTitle(input.objective);
  const models = await getSelectableCodexModels(identity.userId);
  if (!isSelectableModel(models, input.model))
    return NextResponse.json(
      { error: "Selected Codex model is not in the current account catalog" },
      { status: 400 },
    );
  const [repository] = await db()
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.id, input.repositoryId),
        eq(repositories.organizationId, identity.organizationId),
      ),
    )
    .limit(1);
  if (!repository)
    return NextResponse.json(
      { error: "Repository not available" },
      { status: 404 },
    );

  const taskId = `task_${randomUUID().replaceAll("-", "")}`;
  const correlationId = `corr_${randomUUID().replaceAll("-", "")}`;
  const requestHash = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  try {
    await db().transaction(async (tx) => {
      await tx.insert(idempotencyKeys).values({
        id: `idem_${randomUUID().replaceAll("-", "")}`,
        organizationId: identity.organizationId,
        scope: "task.create",
        key: input.idempotencyKey,
        requestHash,
        response: { taskId },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      await tx.insert(tasks).values({
        id: taskId,
        organizationId: identity.organizationId,
        createdByUserId: identity.userId,
        repositoryId: repository.id,
        title,
        objective: input.objective,
        requestedModel: input.model,
        status: "queued",
        baseRef: repository.defaultBranch,
      });
      await tx.insert(taskEvents).values({
        id: `evt_${randomUUID().replaceAll("-", "")}`,
        taskId,
        sequence: 1,
        category: "lifecycle",
        phase: "queued",
        status: "succeeded",
        title: "Task accepted",
        whatWasDone:
          "Nimbus stored the task, repository authorization, and delivery intent.",
        whyItWasDone:
          "The task must exist durably before an executor may claim it.",
        evidence: [],
        filesAffected: [],
        risks: [],
        visibility: "user",
        correlationId,
        nextStep: "An executor will provision an isolated workspace.",
      });
      await tx.insert(outbox).values({
        id: `out_${randomUUID().replaceAll("-", "")}`,
        aggregateType: "task",
        aggregateId: taskId,
        eventType: "task.queued",
        payload: {
          taskId,
          organizationId: identity.organizationId,
          correlationId,
        },
      });
      await tx.insert(auditLogs).values({
        id: `aud_${randomUUID().replaceAll("-", "")}`,
        organizationId: identity.organizationId,
        actorType: "user",
        actorId: identity.userId,
        action: "task.create",
        targetType: "task",
        targetId: taskId,
        metadata: { repositoryId: repository.id },
        correlationId,
      });
    });
  } catch (error) {
    const [existing] = await db()
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.organizationId, identity.organizationId),
          eq(idempotencyKeys.scope, "task.create"),
          eq(idempotencyKeys.key, input.idempotencyKey),
        ),
      )
      .limit(1);
    const existingTaskId =
      existing &&
      typeof existing.response === "object" &&
      existing.response &&
      "taskId" in existing.response
        ? String(existing.response.taskId)
        : null;
    if (existing && existingTaskId && existing.requestHash === requestHash)
      return new NextResponse(null, {
        status: 303,
        headers: { location: `/tasks/${existingTaskId}` },
      });
    return NextResponse.json(
      {
        error: "Task could not be created",
        classification: error instanceof Error ? "conflict" : "unknown",
      },
      { status: 409 },
    );
  }
  return new NextResponse(null, {
    status: 303,
    headers: { location: `/tasks/${taskId}` },
  });
}
