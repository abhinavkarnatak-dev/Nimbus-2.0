import { randomUUID } from "node:crypto";

import { type CodingAgentProvider } from "@nimbus/codex";
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
  tasks,
  workspaces,
} from "@nimbus/database";
import { createObservability } from "@nimbus/observability";
import { assertTaskTransition } from "@nimbus/shared";

import { LocalWorkspaceProvider } from "./local-workspace-provider.js";
import { createProviderConfiguration } from "./provider-factory.js";

export class TaskWorker {
  readonly #provider: CodingAgentProvider;
  readonly #fallbackModel: string | undefined;
  readonly #workspace: LocalWorkspaceProvider;
  #timer: NodeJS.Timeout | undefined;
  #busy = false;
  readonly #observability = createObservability();

  constructor(repositoryRoot: string) {
    const configuration = createProviderConfiguration();
    this.#provider = configuration.provider;
    this.#fallbackModel = configuration.fallbackModel;
    this.#workspace = new LocalWorkspaceProvider(repositoryRoot);
  }

  async start(): Promise<void> {
    await this.#provider.start();
    this.#timer = setInterval(() => void this.tick(), 2_000);
    await this.tick();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    await this.#provider.stop();
    await this.#observability.shutdown();
  }

  async tick(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const [task] = await db()
        .select()
        .from(tasks)
        .where(inArray(tasks.status, ["queued"]))
        .orderBy(asc(tasks.createdAt))
        .limit(1);
      if (task) await this.#run(task);
    } finally {
      this.#busy = false;
    }
  }

  async #run(task: typeof tasks.$inferSelect): Promise<void> {
    const correlationId = `corr_${randomUUID().replaceAll("-", "")}`;
    assertTaskTransition({
      from: "queued",
      to: "provisioning",
      actor: "executor",
      reason: "Executor claimed queued task",
      at: new Date().toISOString(),
      idempotencyKey: `claim_${task.id}`,
      correlationId,
    });
    const claimed = await db()
      .update(tasks)
      .set({
        status: "provisioning",
        version: sql`${tasks.version} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(tasks.id, task.id), eq(tasks.status, "queued")))
      .returning({ id: tasks.id });
    if (!claimed.length) return;
    const nextSequence = async () => {
      const rows = await db()
        .select({ sequence: taskEvents.sequence })
        .from(taskEvents)
        .where(eq(taskEvents.taskId, task.id))
        .orderBy(asc(taskEvents.sequence));
      return (rows.at(-1)?.sequence ?? 0) + 1;
    };
    const event = async (
      phase: string,
      title: string,
      what: string,
      why: string,
      status = "succeeded",
    ) =>
      db()
        .insert(taskEvents)
        .values({
          id: `evt_${randomUUID().replaceAll("-", "")}`,
          taskId: task.id,
          sequence: await nextSequence(),
          category: "lifecycle",
          phase,
          status,
          title,
          whatWasDone: what,
          whyItWasDone: why,
          evidence: [],
          filesAffected: [],
          risks: [],
          visibility: "user",
          correlationId,
        });
    try {
      await event(
        "provisioning",
        "Workspace provisioning started",
        "The executor began creating a task-scoped workspace.",
        "Repository commands and files must remain isolated per task.",
      );
      const workspace = await this.#workspace.provision(task.id);
      const workspaceId = `ws_${randomUUID().replaceAll("-", "")}`;
      await db()
        .insert(workspaces)
        .values({
          id: workspaceId,
          taskId: task.id,
          provider: this.#workspace.kind,
          providerWorkspaceId: workspace.id,
          status: "ready",
          resourceLimits: {
            cpu: 2,
            memoryMb: 4096,
            diskMb: 10240,
            maxSeconds: 3600,
          },
          lastHeartbeatAt: new Date().toISOString(),
        });
      await db()
        .update(tasks)
        .set({
          status: "running",
          version: sql`${tasks.version} + 1`,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, task.id));
      await event(
        "running",
        "Workspace ready",
        "The isolated workspace is ready and linked to the task.",
        "Codex needs a repository-scoped environment before starting a thread.",
      );
      const model = task.requestedModel ?? this.#fallbackModel;
      if (!model)
        throw new Error("Task has no validated Codex model selection");
      const threadId = await this.#provider.startThread({
        workspacePath: workspace.root,
        model,
      });
      const threadRowId = `ctx_${randomUUID().replaceAll("-", "")}`;
      await db().insert(codexThreads).values({
        id: threadRowId,
        taskId: task.id,
        workspaceId,
        providerThreadId: threadId,
        model,
        providerConfigVersion: 1,
      });
      const turnRowId = `turn_${randomUUID().replaceAll("-", "")}`;
      await db().insert(codexTurns).values({
        id: turnRowId,
        codexThreadId: threadRowId,
        status: "running",
      });
      let terminal:
        | "completed"
        | "failed"
        | "interrupted"
        | "cancelled"
        | undefined;
      for await (const update of this.#provider.runTurn({
        threadId,
        prompt: task.objective,
      })) {
        if (update.type === "activity")
          await event(
            "running",
            "Codex activity",
            `Codex reported ${update.method}.`,
            "The process is recorded as evidence without exposing private reasoning.",
          );
        if (update.type === "turn_completed") terminal = update.status;
      }
      if (terminal !== "completed")
        throw new Error(
          `Codex turn ended with ${terminal ?? "no terminal status"}`,
        );
      await db()
        .update(codexTurns)
        .set({ status: "completed", completedAt: new Date().toISOString() })
        .where(eq(codexTurns.id, turnRowId));
      await db()
        .update(codexThreads)
        .set({
          lastConfirmedCompletionStatus: "completed",
          lastProcessedEventSequence: await nextSequence(),
        })
        .where(eq(codexThreads.id, threadRowId));
      await db()
        .update(tasks)
        .set({
          status: "completed",
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, task.id));
      await event(
        "completed",
        "Task completed",
        this.#provider.kind === "fake"
          ? "The deterministic local test provider reported completed status."
          : "Codex app-server reported an official completed terminal status.",
        this.#provider.kind === "fake"
          ? "Local simulation exercises durability and replay without claiming a live integration."
          : "Nimbus records completion only after the official Codex terminal event.",
      );
      this.#observability.capture(task.organizationId, "task_completed", {
        category: "task",
        status: "completed",
        provider: this.#provider.kind,
        taskState: "completed",
      });
    } catch (error) {
      await db()
        .update(tasks)
        .set({
          status: "failed",
          failureCode: "executor_error",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, task.id));
      await event(
        "failed",
        "Task failed",
        "The executor stopped after a bounded failure.",
        "Failures remain visible and retryable instead of being reported as success.",
        "failed",
      );
      this.#observability.capture(task.organizationId, "task_failed", {
        category: "task",
        status: "failed",
        errorClass: error instanceof Error ? error.name : "unknown",
        provider: this.#provider.kind,
        taskState: "failed",
      });
      console.error("executor task failure", {
        taskId: task.id,
        classification: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}
