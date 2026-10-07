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
  taskMessages,
  tasks,
  resolveChatSkills,
} from "@nimbus/database";
import { currentIdentity } from "@/lib/auth";
import {
  getSelectableCodexModels,
  isSelectableModel,
  isSelectableEffort,
} from "@/lib/codex-models";
import { deriveTaskTitle } from "@/lib/task-title";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  reserveCodexModel,
  preferredCodexEffort,
} from "@nimbus/codex/model-policy";
import {
  connectedDeviceProvider,
  deviceConnection,
  isLocalDeviceRequest,
} from "@/lib/codex-device";
import { skillIdsSchema } from "@nimbus/shared";

const CreateTaskSchema = z.object({
  repositoryId: z.union([z.literal(""), z.string().min(12)]).optional(),
  objective: z.string().trim().min(1).max(8000),
  model: z.string().trim().min(1).max(200),
  reasoningEffort: z.string().trim().max(30).optional(),
  idempotencyKey: z.string().min(12).max(200),
  skillIds: z.preprocess((value) => {
    if (typeof value !== "string") return value ?? [];
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }, skillIdsSchema),
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
  if (identity.role === "viewer")
    return NextResponse.json(
      { error: "Task write permission required" },
      { status: 403 },
    );
  const selectedSkills = await resolveChatSkills(
    identity.organizationId,
    identity.userId,
    input.skillIds,
  );
  if (!selectedSkills)
    return NextResponse.json(
      { error: "One or more selected skills are unavailable" },
      { status: 400 },
    );
  const title = deriveTaskTitle(
    input.objective,
    input.repositoryId ? "repository" : "chat",
  );
  const models = await getSelectableCodexModels(
    identity.userId,
    identity.organizationId,
  );
  if (!isSelectableModel(models, input.model))
    return NextResponse.json(
      { error: "Selected Codex model is not in the current account catalog" },
      { status: 400 },
    );
  const selected = models.find((model) => model.id === input.model)!;
  let reasoningEffort =
    input.reasoningEffort || preferredCodexEffort(selected) || undefined;
  if (reasoningEffort && !isSelectableEffort(selected, reasoningEffort))
    return NextResponse.json(
      { error: "Thinking effort is not supported by the selected model" },
      { status: 400 },
    );
  let executionModel = selected;
  if (
    input.model !== "fake-codex-test-provider" &&
    isLocalDeviceRequest(request)
  ) {
    try {
      const provider = await connectedDeviceProvider(
        `${identity.organizationId}:${identity.userId}`,
      );
      executionModel = reserveCodexModel(
        models,
        selected,
        await provider.readRateLimits(),
      );
      if (
        executionModel.id !== selected.id &&
        (!reasoningEffort ||
          !isSelectableEffort(executionModel, reasoningEffort))
      )
        reasoningEffort = preferredCodexEffort(executionModel);
    } catch {
      // A missing quota snapshot does not prove exhaustion; Codex remains authoritative.
    }
  }
  if (
    ["fake", "connected"].includes(process.env.NIMBUS_CODING_PROVIDER ?? "") &&
    input.model !== "fake-codex-test-provider"
  )
    try {
      if (!isLocalDeviceRequest(request))
        throw new Error(
          "Codex device execution is not enabled for this origin",
        );
      const connection = await deviceConnection(
        `${identity.organizationId}:${identity.userId}`,
      );
      if (connection.status !== "connected")
        throw new Error("Codex is disconnected");
    } catch {
      return NextResponse.json(
        {
          error:
            "Reconnect Codex in Settings > Connections before running a real task. Nimbus will not simulate this model.",
        },
        { status: 503 },
      );
    }
  const [repository] = input.repositoryId
    ? await db()
        .select()
        .from(repositories)
        .where(
          and(
            eq(repositories.id, input.repositoryId),
            eq(repositories.organizationId, identity.organizationId),
          ),
        )
        .limit(1)
    : [];
  if (input.repositoryId && !repository)
    return NextResponse.json(
      { error: "Repository not available" },
      { status: 404 },
    );
  if (repository?.archived)
    return NextResponse.json(
      {
        error: "Repository access is unavailable or the repository is archived",
      },
      { status: 403 },
    );

  const taskId = `task_${randomUUID().replaceAll("-", "")}`;
  if (
    input.model !== "fake-codex-test-provider" &&
    repository &&
    !repository.githubInstallationId
  )
    return NextResponse.json(
      {
        error:
          "Choose a repository connected through your GitHub App, not the sample repository.",
      },
      { status: 400 },
    );
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
        repositoryId: repository?.id ?? null,
        title,
        objective: input.objective,
        selectedSkillIds: input.skillIds,
        requestedModel: executionModel.id,
        requestedReasoningEffort: reasoningEffort ?? null,
        status: "queued",
        baseRef: repository?.defaultBranch ?? "",
      });
      await tx.insert(taskMessages).values({
        id: `msg_${randomUUID().replaceAll("-", "")}`,
        taskId,
        userId: identity.userId,
        content: input.objective,
        selectedSkills,
        idempotencyKey: input.idempotencyKey,
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
          executionModel.id !== selected.id
            ? `Nimbus stored the task and automatically switched from ${selected.id} to ${executionModel.id} because the Codex limit is exhausted and reserve capacity is available.`
            : repository
              ? "Nimbus stored the task, repository authorization, and delivery intent."
              : "Nimbus stored your general chat. No repository or sandbox is selected.",
        whyItWasDone:
          "The task must exist durably before an executor may claim it.",
        evidence: [],
        filesAffected: [],
        risks: [],
        visibility: "user",
        correlationId,
        nextStep: repository
          ? "An executor will provision an isolated workspace."
          : "Nimbus will start a chat-only Codex turn.",
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
        metadata: { repositoryId: repository?.id ?? null },
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
      if (request.headers.get("accept")?.includes("application/json"))
        return NextResponse.json({ taskId: existingTaskId });
      else
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
  if (request.headers.get("accept")?.includes("application/json"))
    return NextResponse.json({ taskId }, { status: 201 });
  return new NextResponse(null, {
    status: 303,
    headers: { location: `/tasks/${taskId}` },
  });
}
