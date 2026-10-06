import { randomUUID } from "node:crypto";

import {
  LocalConnectedCodexProvider,
  type CodingAgentProvider,
} from "@nimbus/codex";
import {
  and,
  asc,
  codexThreads,
  codexTurns,
  commandRuns,
  db,
  eq,
  inArray,
  persistGeneratedTaskTitle,
  readAgentInstructions,
  requestWasStopped,
  finishStoppedRequest,
  sql,
  taskEvents,
  taskMessages,
  tasks,
  workspaces,
} from "@nimbus/database";
import {
  createObservabilityId,
  createObservability,
  type AiGeneration,
} from "@nimbus/observability";
import {
  assertTaskTransition,
  sessionTitlePrompt,
  presentSessionTurn,
  withAgentInstructions,
} from "@nimbus/shared";

import { LocalWorkspaceProvider } from "./local-workspace-provider.js";
import { createProviderConfiguration } from "./provider-factory.js";
import { streamResponseBatches } from "./response-stream.js";
import type { E2BSessionManager } from "./e2b-session-manager.js";

export class TaskWorker {
  readonly #provider: CodingAgentProvider;
  readonly #fallbackModel: string | undefined;
  readonly #workspace: LocalWorkspaceProvider | undefined;
  readonly #repositoryRoot: string;
  #timer: NodeJS.Timeout | undefined;
  #busy = false;
  #turnAbort: AbortController | undefined;
  #inflight: Promise<void> | undefined;
  readonly #observability = createObservability();

  constructor(
    repositoryRoot: string,
    readonly sessions?: E2BSessionManager,
  ) {
    this.#repositoryRoot = repositoryRoot;
    const configuration = createProviderConfiguration();
    this.#provider = configuration.provider;
    this.#fallbackModel = configuration.fallbackModel;
    this.#workspace =
      configuration.provider.kind === "fake"
        ? new LocalWorkspaceProvider(repositoryRoot)
        : undefined;
  }

  async start(): Promise<void> {
    await this.#provider.start();
    this.#timer = setInterval(
      () =>
        void this.tick().catch(() =>
          console.error("Executor polling failed; retrying on next tick"),
        ),
      2_000,
    );
    await this.tick();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#turnAbort?.abort();
    if (this.#inflight)
      await Promise.race([
        this.#inflight,
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
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
      if (task) {
        this.#inflight = this.#run(task);
        await this.#inflight;
      }
    } finally {
      this.#busy = false;
      this.#inflight = undefined;
    }
  }

  async #run(task: typeof tasks.$inferSelect): Promise<void> {
    const provider =
      task.requestedModel &&
      task.requestedModel !== "fake-codex-test-provider" &&
      (process.env.NODE_ENV !== "production" ||
        process.env.NIMBUS_CODING_PROVIDER === "connected")
        ? new LocalConnectedCodexProvider(task.id, this.#repositoryRoot)
        : this.#provider;
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
    const observabilitySessionId = createObservabilityId("session", task.id);
    const runStartedAt = Date.now();
    const runSpan = this.#observability.startSpan("nimbus.agent.request", {
      distinctId: task.createdByUserId,
      sessionId: observabilitySessionId,
      metadata: {
        category: "agent",
        provider: provider.kind,
        taskState: "running",
      },
    });
    let runObserved = false;
    const finishRunObservability = (
      outcome: AiGeneration["status"],
      error?: unknown,
    ) => {
      if (runObserved) return;
      const durationMs = Date.now() - runStartedAt;
      this.#observability.recordAgentRun(outcome, durationMs);
      this.#observability.log(
        outcome === "failed" ? "error" : "info",
        `Nimbus agent request ${outcome}`,
        {
          category: "agent",
          status: outcome,
          durationMs,
          provider: provider.kind,
          taskState: outcome,
          ...(error instanceof Error ? { errorClass: error.name } : {}),
        },
      );
      if (outcome === "failed")
        this.#observability.captureException(
          error ?? new Error("Nimbus agent request failed"),
          task.createdByUserId,
          {
            category: "agent",
            status: outcome,
            provider: provider.kind,
            taskState: outcome,
            ...(error instanceof Error ? { errorClass: error.name } : {}),
          },
        );
      runSpan.finish(outcome, error);
      runObserved = true;
    };
    this.#observability.log("info", "Nimbus agent request started", {
      category: "agent",
      status: "running",
      provider: provider.kind,
      taskState: "running",
    });
    this.sessions?.cancelIdle(task.id);
    const event = async (
      phase: string,
      title: string,
      what: string,
      why: string,
      status = "succeeded",
      category = "lifecycle",
      evidence: string[] = [],
    ) =>
      db().transaction(async (tx) => {
        await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.id, task.id))
          .for("update");
        const rows = await tx
          .select({ sequence: taskEvents.sequence })
          .from(taskEvents)
          .where(eq(taskEvents.taskId, task.id))
          .orderBy(asc(taskEvents.sequence));
        const sequence = (rows.at(-1)?.sequence ?? 0) + 1;
        await tx.insert(taskEvents).values({
          id: `evt_${randomUUID().replaceAll("-", "")}`,
          taskId: task.id,
          sequence,
          category,
          phase,
          status,
          title,
          whatWasDone: what,
          whyItWasDone: why,
          evidence,
          filesAffected: [],
          risks: [],
          visibility: "user",
          correlationId,
        });
        return sequence;
      });
    let messageId: string | undefined;
    let turnRowId: string | undefined;
    let terminalError: string | undefined;
    let terminalClassification: string | undefined;
    let terminal:
      | "completed"
      | "failed"
      | "interrupted"
      | "cancelled"
      | undefined;
    let aiGeneration:
      | (Omit<AiGeneration, "durationMs" | "status" | "errorClass"> & {
          startedAt: number;
        })
      | undefined;
    let aiGenerationCaptured = false;
    const captureAiGeneration = (
      status: AiGeneration["status"],
      errorClass?: string,
    ) => {
      if (!aiGeneration || aiGenerationCaptured) return;
      const { startedAt, ...generation } = aiGeneration;
      this.#observability.captureAiGeneration({
        ...generation,
        durationMs: Date.now() - startedAt,
        status,
        ...(errorClass ? { errorClass } : {}),
      });
      aiGenerationCaptured = true;
    };
    try {
      const message = await db().transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(tasks)
          .where(eq(tasks.id, task.id))
          .for("update");
        if (
          !current ||
          !["provisioning", "cancelling"].includes(current.status)
        )
          return undefined;
        const [next] = await tx
          .select()
          .from(taskMessages)
          .where(
            and(
              eq(taskMessages.taskId, task.id),
              eq(
                taskMessages.status,
                current.status === "cancelling" ? "cancelling" : "queued",
              ),
            ),
          )
          .orderBy(asc(taskMessages.createdAt), asc(taskMessages.id))
          .limit(1);
        if (next && current.status === "provisioning")
          await tx
            .update(taskMessages)
            .set({ status: "running", updatedAt: new Date().toISOString() })
            .where(eq(taskMessages.id, next.id));
        return next;
      });
      if (!message) throw new Error("Queued session has no pending message");
      messageId = message.id;
      const checkStopped = async () => {
        if (await requestWasStopped(message.id))
          throw new Error("Request stopped by user");
      };
      await checkStopped();
      const repositoryMode = Boolean(task.repositoryId);
      const [existingWorkspace] = repositoryMode
        ? await db()
            .select()
            .from(workspaces)
            .where(eq(workspaces.taskId, task.id))
        : [];
      if (repositoryMode)
        await event(
          "provisioning",
          existingWorkspace
            ? "Workspace resume started"
            : "Workspace provisioning started",
          existingWorkspace
            ? "The executor is reopening this session's saved workspace."
            : "The executor began creating a task-scoped workspace.",
          "Follow-ups keep repository state isolated in the same task workspace.",
        );
      const remote = provider.kind !== "fake";
      if (remote && !(provider instanceof LocalConnectedCodexProvider))
        throw new Error(
          "Real execution requires the connected remote Codex bridge; direct local providers are forbidden",
        );
      if (remote && repositoryMode && !this.sessions)
        throw new Error(
          "E2B is required for real sessions; local execution fallback is forbidden",
        );
      if (
        !remote &&
        existingWorkspace &&
        existingWorkspace.provider !== this.#workspace!.kind
      )
        throw new Error("Workspace provider mismatch");
      const remoteSession =
        remote && repositoryMode
          ? await this.sessions!.ensure(task.id)
          : undefined;
      if (remoteSession) await this.sessions!.sync(task.id);
      await checkStopped();
      const workspace = !repositoryMode
        ? { root: "", id: "" }
        : remoteSession
          ? remoteSession.workspace
          : existingWorkspace
            ? await this.#workspace!.resume(
                existingWorkspace.providerWorkspaceId,
              )
            : await this.#workspace!.provision(task.id);
      const workspaceId = repositoryMode
        ? (existingWorkspace?.id ?? `ws_${randomUUID().replaceAll("-", "")}`)
        : null;
      if (repositoryMode && !existingWorkspace && !remote)
        await db()
          .insert(workspaces)
          .values({
            id: workspaceId!,
            taskId: task.id,
            provider: this.#workspace!.kind,
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
      const running = await db()
        .update(tasks)
        .set({
          status: "running",
          version: sql`${tasks.version} + 1`,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(tasks.id, task.id), eq(tasks.status, "provisioning")))
        .returning({ id: tasks.id });
      if (!running.length) {
        await checkStopped();
        throw new Error("Request is no longer claimed");
      }
      if (repositoryMode)
        await event(
          "running",
          "Workspace ready",
          "The isolated workspace is ready and linked to the task.",
          "Codex needs a repository-scoped environment before starting a thread.",
        );
      if (remoteSession?.restored)
        await event(
          "running",
          "Session restored",
          "The previous sandbox expired. Saved files and branch state were restored into a new E2B sandbox.",
          "The same conversation and pull request history are retained.",
        );
      const model = task.requestedModel ?? this.#fallbackModel;
      if (repositoryMode && provider instanceof LocalConnectedCodexProvider) {
        await event(
          "running",
          "Repository checkout started",
          "Fetching the assigned GitHub repository into this task workspace.",
          "Codex must inspect real repository files, not an empty workspace.",
        );
        await provider.prepareRepository();
        await event(
          "running",
          "Repository ready",
          "The assigned repository and isolated task branch are ready.",
          "GitHub credentials are used only by trusted checkout and are not stored in the workspace.",
        );
      }
      if (!model)
        throw new Error("Task has no validated Codex model selection");
      if (provider.kind === "fake" && model !== "fake-codex-test-provider")
        throw new Error(
          "A real Codex model cannot run through the simulation provider",
        );
      await checkStopped();
      const [existingThread] = await db()
        .select()
        .from(codexThreads)
        .where(eq(codexThreads.taskId, task.id));
      if (existingThread && existingThread.model !== model)
        throw new Error("Thread model mismatch");
      const threadId =
        existingThread?.providerThreadId ??
        (await provider.startThread({
          workspacePath: workspace.root,
          model,
        }));
      if (existingThread) await provider.resumeThread(threadId);
      await checkStopped();
      const [createdThread] = existingThread
        ? []
        : await db()
            .select()
            .from(codexThreads)
            .where(eq(codexThreads.taskId, task.id));
      const threadRowId =
        existingThread?.id ??
        createdThread?.id ??
        `ctx_${randomUUID().replaceAll("-", "")}`;
      if (!existingThread && !createdThread)
        await db().insert(codexThreads).values({
          id: threadRowId,
          taskId: task.id,
          workspaceId,
          providerThreadId: threadId,
          model,
          providerConfigVersion: 1,
        });
      turnRowId = `turn_${randomUUID().replaceAll("-", "")}`;
      await db().insert(codexTurns).values({
        id: turnRowId,
        codexThreadId: threadRowId,
        taskMessageId: message.id,
        status: "running",
      });
      this.#turnAbort = new AbortController();
      let responseText = "";
      let aiOutputText = "";
      let responseItemId: string | undefined;
      let generatedTitle: string | null = null;
      const savedInstructions = await readAgentInstructions(
        task.organizationId,
        message.userId,
      );
      const turnPrompt = withAgentInstructions(
        sessionTitlePrompt(
          message.content,
          task.title,
          Boolean(task.titleGeneratedAt),
          task.repositoryId ? "repository" : "chat",
        ),
        savedInstructions,
      );
      aiGeneration = {
        distinctId: message.userId,
        traceId: runSpan.traceId ?? createObservabilityId("trace", message.id),
        spanId: runSpan.spanId ?? createObservabilityId("span", turnRowId),
        sessionId: observabilitySessionId,
        model,
        provider: provider.kind,
        input: turnPrompt.slice(0, 100_000),
        output: "",
        ...(task.requestedReasoningEffort
          ? { reasoningEffort: task.requestedReasoningEffort }
          : {}),
        startedAt: Date.now(),
      };
      const flushResponse = async () => {
        if (!responseText) return;
        await event(
          "running",
          "Agent response",
          responseText,
          "",
          "running",
          "agent_message",
          responseItemId ? [`codex-item:${responseItemId}`] : [],
        );
        responseText = "";
      };
      if (repositoryMode && provider.kind !== "fake")
        this.sessions!.beginRequest(task.id, message.id);
      for await (const update of streamResponseBatches(
        presentSessionTurn(
          provider.runTurn({
            threadId,
            workspacePath: workspace.root,
            prompt: turnPrompt,
            signal: this.#turnAbort.signal,
            ...(task.requestedReasoningEffort
              ? { reasoningEffort: task.requestedReasoningEffort }
              : {}),
          }),
          !task.titleGeneratedAt,
          (title) => {
            generatedTitle = title;
          },
        ),
      )) {
        if (update.type === "agent_message_delta") {
          if (responseItemId !== update.itemId) {
            await flushResponse();
          }
          responseItemId = update.itemId;
          responseText += update.text;
          if (aiOutputText.length < 100_000) {
            aiOutputText += update.text.slice(0, 100_000 - aiOutputText.length);
            aiGeneration.output = aiOutputText;
          }
          await flushResponse();
        } else await flushResponse();
        if (update.type === "warning") {
          await event(
            "running",
            "Execution warning",
            update.message,
            "Nimbus cannot silently authorize unsupported operations.",
            "failed",
            "security",
          );
          if (update.classification === "input_required")
            throw new Error(update.message);
        }
        if (update.type === "activity") {
          const payload = update.payload as {
            item?: {
              id?: string;
              type?: string;
              command?: string;
              cwd?: string;
              exitCode?: number | null;
              durationMs?: number;
              aggregatedOutput?: string;
              text?: string;
            };
            plan?: Array<{ step: string; status: string }>;
            explanation?: string;
            status?: string;
            text?: string;
          };
          const item = payload.item;
          if (update.method === "nimbus/publishing")
            await event(
              "running",
              payload.status === "succeeded"
                ? "Pull request ready"
                : "Publishing pull request",
              payload.text ?? "",
              "",
              payload.status === "succeeded" ? "succeeded" : "running",
              "tool",
              [`codex-item:publish-${message.id}`],
            );
          if (update.method === "nimbus/thinking")
            await event(
              "running",
              "Thinking",
              "Nimbus is deciding its next action.",
              "",
              "running",
              "agent_state",
            );
          if (
            update.method === "item/started" &&
            item?.type === "commandExecution" &&
            item.command
          )
            await event(
              "running",
              "Running command",
              item.command,
              "",
              "running",
              "tool",
              item.id ? [`codex-item:${item.id}`] : [],
            );
          if (
            update.method === "turn/plan/updated" &&
            Array.isArray(payload.plan)
          )
            await event(
              "running",
              "Plan updated",
              payload.plan
                .map((step) => `${step.status}: ${step.step}`)
                .join("\n"),
              payload.explanation ?? "",
              "running",
              "plan",
            );
          if (
            update.method === "item/completed" &&
            item?.type === "commandExecution" &&
            item.command
          ) {
            if (aiGeneration)
              this.#observability.captureAiSpan({
                distinctId: message.userId,
                traceId: aiGeneration.traceId,
                spanId: createObservabilityId(
                  "tool",
                  `${message.id}:${item.id ?? randomUUID()}`,
                ),
                parentId: aiGeneration.spanId,
                sessionId: observabilitySessionId,
                name: "command_execution",
                input: item.command.slice(0, 100_000),
                output: (item.aggregatedOutput ?? "").slice(0, 100_000),
                durationMs: item.durationMs ?? 0,
                isError: item.exitCode !== 0,
              });
            await db()
              .insert(commandRuns)
              .values({
                id: `cmd_${task.id}_${item.id ?? randomUUID()}`,
                taskId: task.id,
                command: item.command,
                workingDirectory: item.cwd ?? workspace.root,
                status: item.exitCode === 0 ? "completed" : "failed",
                exitCode: item.exitCode ?? null,
                durationMs: item.durationMs ?? null,
                completedAt: new Date().toISOString(),
              })
              .onConflictDoNothing();
            await event(
              "running",
              item.exitCode === 0 ? "Command passed" : "Command failed",
              `${item.command}\nExit code: ${item.exitCode ?? "unknown"}\n${(item.aggregatedOutput ?? "").slice(0, 5000)}`,
              "Nimbus ran this command to investigate or verify the requested outcome.",
              item.exitCode === 0 ? "succeeded" : "failed",
              "tool",
              item.id ? [`codex-item:${item.id}`] : [],
            );
          }
          await event(
            "running",
            "Codex activity",
            `Codex reported ${update.method}.`,
            "",
            update.method === "error" ? "failed" : "running",
            "protocol",
          );
        }
        if (update.type === "turn_completed") {
          terminal = update.status;
          terminalError = update.error;
          terminalClassification = update.errorClassification;
          await db()
            .update(codexTurns)
            .set({ providerTurnId: update.turnId })
            .where(eq(codexTurns.id, turnRowId));
        }
      }
      await flushResponse();
      await checkStopped();
      if (terminal !== "completed")
        throw new Error(
          terminalError ??
            `Codex turn ended with ${terminal ?? "no terminal status"}`,
        );
      captureAiGeneration("completed");
      if (repositoryMode && provider.kind !== "fake") {
        await this.sessions!.sync(task.id);
      }
      if (
        generatedTitle &&
        provider.kind !== "fake" &&
        !(provider instanceof LocalConnectedCodexProvider)
      )
        await persistGeneratedTaskTitle(
          task.id,
          task.organizationId,
          generatedTitle,
        ).catch(() =>
          console.warn(
            "Session title persistence failed; retaining the previous title",
          ),
        );
      await db()
        .update(codexTurns)
        .set({ status: "completed", completedAt: new Date().toISOString() })
        .where(eq(codexTurns.id, turnRowId));
      await db()
        .update(codexThreads)
        .set({
          lastConfirmedCompletionStatus: "completed",
        })
        .where(eq(codexThreads.id, threadRowId));
      const completedSequence = await event(
        "completed",
        "Response finished",
        provider.kind === "fake"
          ? "The deterministic local test provider reported completed status."
          : "Codex finished this response. You can continue in the same session.",
        provider.kind === "fake"
          ? "Local simulation exercises durability and replay without claiming a live integration."
          : "A finished response does not certify that tests passed or repository changes were verified. Check the recorded command results.",
      );
      await db()
        .update(codexThreads)
        .set({ lastProcessedEventSequence: completedSequence })
        .where(eq(codexThreads.id, threadRowId));
      await db().transaction(async (tx) => {
        await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.id, task.id))
          .for("update");
        const [currentMessage] = await tx
          .select({ status: taskMessages.status })
          .from(taskMessages)
          .where(eq(taskMessages.id, message.id));
        if (currentMessage?.status === "cancelling")
          throw new Error("Request stopped by user");
        await tx
          .update(taskMessages)
          .set({ status: "completed", completedAt: new Date().toISOString() })
          .where(eq(taskMessages.id, message.id));
        const [pending] = await tx
          .select({ id: taskMessages.id })
          .from(taskMessages)
          .where(
            and(
              eq(taskMessages.taskId, task.id),
              eq(taskMessages.status, "queued"),
            ),
          )
          .limit(1);
        assertTaskTransition({
          from: "running",
          to: pending ? "queued" : "completed",
          actor: "executor",
          reason: pending
            ? "Continue with the next queued message"
            : "Current turn finished; session remains open",
          at: new Date().toISOString(),
          idempotencyKey: `finish_${message.id}`,
          correlationId,
        });
        await tx
          .update(tasks)
          .set({
            status: pending ? "queued" : "completed",
            completedAt: pending ? null : new Date().toISOString(),
            version: sql`${tasks.version} + 1`,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(tasks.id, task.id));
      });
      this.#observability.capture(task.organizationId, "task_completed", {
        category: "task",
        status: "completed",
        provider: provider.kind,
        taskState: "completed",
      });
      if (repositoryMode && provider.kind !== "fake")
        await this.sessions!.scheduleIdle(task.id, () =>
          event(
            "idle",
            "Sandbox paused",
            "Repository changes are saved and the E2B sandbox paused after two minutes without a follow-up.",
            "Follow-ups resume this sandbox or restore a replacement without changing the conversation.",
          ),
        );
      finishRunObservability("completed");
    } catch (error) {
      if (messageId && (await requestWasStopped(messageId))) {
        captureAiGeneration("interrupted");
        finishRunObservability("interrupted");
        if (task.repositoryId && provider.kind !== "fake") {
          try {
            await this.sessions?.stopRequest(task.id, messageId);
          } catch {
            await db()
              .update(taskMessages)
              .set({ status: "failed", completedAt: new Date().toISOString() })
              .where(eq(taskMessages.id, messageId));
            if (turnRowId)
              await db()
                .update(codexTurns)
                .set({
                  status: "interrupted",
                  completedAt: new Date().toISOString(),
                })
                .where(eq(codexTurns.id, turnRowId));
            await db()
              .update(tasks)
              .set({
                status: "failed",
                failureCode: "command_stop_unconfirmed",
                updatedAt: new Date().toISOString(),
              })
              .where(eq(tasks.id, task.id));
            await event(
              "failed",
              "Command stop could not be confirmed",
              "The agent turn was interrupted, but the sandbox command did not confirm termination.",
              "Nimbus does not report a command as stopped without executor acknowledgement.",
              "failed",
            );
            return;
          }
        }
        if (task.repositoryId && provider.kind !== "fake")
          await this.sessions
            ?.sync(task.id)
            .catch(() =>
              console.warn("Stopped request checkpoint will be retried"),
            );
        await finishStoppedRequest(task.id, messageId, turnRowId);
        if (task.repositoryId && provider.kind !== "fake")
          await this.sessions
            ?.scheduleIdle(task.id, () =>
              event(
                "idle",
                "Sandbox paused",
                "The stopped request workspace was preserved and paused.",
                "Future follow-ups can resume this session.",
              ),
            )
            .catch(() => {});
        return;
      }
      if (task.repositoryId && provider.kind !== "fake")
        await this.sessions
          ?.idle(task.id)
          .catch(() =>
            console.warn(
              "Remote recovery checkpoint failed; retaining sandbox until its pause timeout",
            ),
          );
      captureAiGeneration(
        terminal === "cancelled" ? "cancelled" : "failed",
        error instanceof Error ? error.name : "unknown",
      );
      finishRunObservability(
        terminal === "cancelled" ? "cancelled" : "failed",
        error,
      );
      if (turnRowId)
        await db()
          .update(codexTurns)
          .set({ status: "failed", completedAt: new Date().toISOString() })
          .where(eq(codexTurns.id, turnRowId));
      if (messageId)
        await db()
          .update(taskMessages)
          .set({ status: "failed", completedAt: new Date().toISOString() })
          .where(eq(taskMessages.id, messageId));
      await db()
        .update(tasks)
        .set({
          status: "failed",
          failureCode: terminalClassification ?? "executor_error",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, task.id));
      await event(
        "failed",
        "Task failed",
        error instanceof Error
          ? error.message
          : "The executor stopped after a bounded failure.",
        "Failures remain visible and retryable instead of being reported as success.",
        "failed",
      );
      this.#observability.capture(task.organizationId, "task_failed", {
        category: "task",
        status: "failed",
        errorClass: error instanceof Error ? error.name : "unknown",
        provider: provider.kind,
        taskState: "failed",
      });
      console.error("executor task failure", {
        taskId: task.id,
        classification: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}
