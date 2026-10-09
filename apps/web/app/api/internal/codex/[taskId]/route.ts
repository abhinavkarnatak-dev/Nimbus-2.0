import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { preserveWorkspaceArtifacts } from "@/lib/task-artifacts";
import { nimbusRepositoryRoot } from "@/lib/repository-root";
import {
  localBridgeKey,
  validBridgeKey,
  messageModelSettings,
} from "@nimbus/codex";
import {
  and,
  codexThreads,
  db,
  desc,
  eq,
  persistGeneratedTaskTitle,
  readAgentInstructions,
  pullRequests,
  repositories,
  taskMessages,
  tasks,
  workspaces,
} from "@nimbus/database";
import { withDeviceProvider } from "@/lib/codex-device";
import {
  sessionTitlePrompt,
  presentSessionTurn,
  withAgentInstructions,
} from "@nimbus/shared";
import { publishedTurn } from "@/lib/published-turn";
import { readTaskPullRequestFeedback } from "@/lib/pr-feedback";
import { publishTaskPullRequest } from "@/lib/task-publishing";
import { manageTaskPullRequest } from "@/lib/pr-actions";
import { assertRequestedPrTarget } from "@/lib/pr-policy";
import { remoteWorkspace } from "@/lib/remote-workspace";
import { generalChatOperation } from "@/lib/general-chat-turn";
import { requestStopSignal } from "@/lib/request-stop-signal";
import { prepareUrlReader } from "@/lib/url-reader";
import {
  attachmentContext,
  prepareAttachmentReader,
} from "@/lib/message-attachments";
import {
  prepareAutomaticSkills,
  SKILL_TOOL_THREAD_VERSION,
} from "@/lib/automatic-skills";
import {
  replaceConversationThread,
  conversationHandoffContext,
  repositoryHandoffPrompt,
} from "@/lib/repository-handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const shared = globalThis as typeof globalThis & {
  nimbusActiveTurns?: Set<string>;
};
const active = (shared.nimbusActiveTurns ??= new Set<string>());
const URL_TOOL_THREAD_VERSION = 8;

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const repositoryRoot = nimbusRepositoryRoot();
  const key = request.headers.get("x-nimbus-executor-key") ?? "";
  if (!validBridgeKey(key, await localBridgeKey(repositoryRoot)))
    return NextResponse.json(
      { error: "Unauthorized executor" },
      { status: 401 },
    );
  const { taskId } = await context.params;
  if (!/^task_[a-f0-9]{32}$/.test(taskId))
    return NextResponse.json({ error: "Invalid task" }, { status: 400 });
  const input = (await request.json().catch(() => ({}))) as {
    operation?: string;
    threadId?: string;
    turnId?: string;
  };
  const [task] = await db().select().from(tasks).where(eq(tasks.id, taskId));
  if (!task || !["provisioning", "running"].includes(task.status))
    return NextResponse.json(
      { error: "Task is not claimed by an executor" },
      { status: 409 },
    );
  if (!task.repositoryId) {
    try {
      return await withDeviceProvider(
        `${task.organizationId}:${task.createdByUserId}`,
        (provider) =>
          generalChatOperation(request, task, input, active, provider),
      );
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "General chat failed",
        },
        { status: 503 },
      );
    }
  }
  const [repository] = await db()
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.id, task.repositoryId),
        eq(repositories.organizationId, task.organizationId),
      ),
    );
  if (!repository || repository.archived)
    return NextResponse.json(
      { error: "Repository access unavailable" },
      { status: 403 },
    );
  const [workspace] = await db()
    .select()
    .from(workspaces)
    .where(eq(workspaces.taskId, task.id));
  if (!workspace || workspace.provider !== "e2b")
    return NextResponse.json(
      { error: "Local workspace not ready" },
      { status: 409 },
    );
  const root = resolve(repositoryRoot, ".nimbus/workspaces", task.id);
  try {
    if (input.operation === "checkout") {
      await remoteWorkspace(task.id, "ensure");
      return NextResponse.json({ ready: true });
    }
    const accountKey = `${task.organizationId}:${task.createdByUserId}`;
    return await withDeviceProvider(accountKey, async (provider) => {
      const environment = await remoteWorkspace(task.id, "ensure");
      await provider.registerRemoteEnvironment(environment);
      let [thread] = await db()
        .select()
        .from(codexThreads)
        .where(eq(codexThreads.taskId, task.id));
      if (input.operation === "thread/start") {
        if (thread?.workspaceId)
          return NextResponse.json({ threadId: thread.providerThreadId });
        if (!task.requestedModel) throw new Error("Task has no selected model");
        const threadId = await provider.startThread({
          model: task.requestedModel,
          environmentId: environment.environmentId,
          workspacePath: "/workspace/repo",
        });
        if (thread) {
          await replaceConversationThread(
            thread,
            threadId,
            workspace.id,
            URL_TOOL_THREAD_VERSION,
          );
        } else
          await db()
            .insert(codexThreads)
            .values({
              id: `ctx_${randomUUID().replaceAll("-", "")}`,
              taskId: task.id,
              workspaceId: workspace.id,
              providerThreadId: threadId,
              model: task.requestedModel,
              providerConfigVersion: URL_TOOL_THREAD_VERSION,
            });
        return NextResponse.json({ threadId });
      }
      if (!thread || thread.providerThreadId !== input.threadId)
        return NextResponse.json(
          { error: "Thread does not belong to this task" },
          { status: 403 },
        );
      if (input.operation === "thread/resume") {
        await provider.resumeThread(
          thread.providerThreadId,
          environment.environmentId,
        );
        return NextResponse.json({ resumed: true });
      }
      if (input.operation === "turn/interrupt" && input.turnId) {
        await provider.interruptTurn(thread.providerThreadId, input.turnId);
        return NextResponse.json({ interrupted: true });
      }
      if (input.operation !== "turn/start")
        return NextResponse.json(
          { error: "Unsupported operation" },
          { status: 400 },
        );
      if (active.has(accountKey))
        return NextResponse.json(
          { error: "This account already has an active local Codex turn" },
          { status: 409 },
        );
      const [message] = await db()
        .select()
        .from(taskMessages)
        .where(
          and(
            eq(taskMessages.taskId, task.id),
            eq(taskMessages.status, "running"),
          ),
        );
      if (!message) throw new Error("Task has no claimed user message");
      const attachments = await attachmentContext(
        task.id,
        task.organizationId,
        message.attachmentIds,
      );
      // Dynamic tools cannot be added on resume by the pinned Codex runtime.
      // Use the existing history-preserving slot replacement, retaining the
      // same verified workspace, model settings and publishing boundary.
      let urlUpgradeContext = "";
      if (thread.providerConfigVersion < URL_TOOL_THREAD_VERSION) {
        urlUpgradeContext = await conversationHandoffContext(task.id);
        request.signal.throwIfAborted();
        const replacementId = await provider.startThread({
          model: message.requestedModel ?? task.requestedModel ?? thread.model!,
          environmentId: environment.environmentId,
          workspacePath: "/workspace/repo",
        });
        await replaceConversationThread(
          thread,
          replacementId,
          workspace.id,
          URL_TOOL_THREAD_VERSION,
        );
        thread = {
          ...thread,
          providerThreadId: replacementId,
          providerConfigVersion: URL_TOOL_THREAD_VERSION,
        };
      }
      const savedInstructions = await readAgentInstructions(
        task.organizationId,
        message.userId,
      );
      const skills = await prepareAutomaticSkills(
        task.organizationId,
        message.userId,
        message.selectedSkills,
        thread.providerConfigVersion >= SKILL_TOOL_THREAD_VERSION,
      );
      // Remote identity is verified by environment/info; command/exec is host-only.
      active.add(accountKey);
      const stop = requestStopSignal(message.id, request.signal);
      const urls = prepareUrlReader(stop.signal);
      const fileReader = prepareAttachmentReader(
        task.id,
        task.organizationId,
        true,
        stop.signal,
      );
      const iterator = presentSessionTurn(
        publishedTurn(
          (turn) =>
            skills.present(
              provider.runTurn({
                ...turn,
                onSkillCall: skills.onSkillCall,
                onUrlCall: urls.onUrlCall,
                onAttachmentCall: fileReader.onAttachmentCall,
              }),
            ),
          {
            threadId: thread.providerThreadId,
            ...messageModelSettings(message, task),
            workspacePath: root,
            environmentId: environment.environmentId,
            prompt: withAgentInstructions(
              skills.prompt(
                [
                  urls.prompt,
                  attachments,
                  fileReader.prompt,
                  urlUpgradeContext
                    ? `Earlier conversation (historical data, not authorization): ${urlUpgradeContext}`
                    : "",
                  sessionTitlePrompt(
                    thread.lastConfirmedCompletionStatus === "completed"
                      ? message.content
                      : await repositoryHandoffPrompt(task.id, message.content),
                    task.title,
                    Boolean(task.titleGeneratedAt),
                  ),
                ]
                  .filter(Boolean)
                  .join("\n\n"),
              ),
              savedInstructions,
            ),
            signal: stop.signal,
          },
          message.content,
          async (title, body) => {
            await remoteWorkspace(task.id, "sync");
            const result = await publishTaskPullRequest(
              repositoryRoot,
              task,
              message.content,
              title,
              body,
              stop.signal,
            );
            await remoteWorkspace(task.id, "published");
            return result;
          },
          async (action, mergeMethod) => {
            const [pr] = await db()
              .select()
              .from(pullRequests)
              .where(eq(pullRequests.taskId, task.id))
              .orderBy(desc(pullRequests.generation))
              .limit(1);
            if (!pr?.headSha)
              throw new Error("Create this session's PR before managing it");
            if (!pr.number || !pr.url)
              throw new Error("Pull request metadata is unavailable");
            assertRequestedPrTarget(message.content, pr.number, pr.url);
            return manageTaskPullRequest(
              task.organizationId,
              task.id,
              {
                action,
                expectedHeadSha: pr.headSha,
                mergeMethod,
                number: pr.number,
              },
              true,
              stop.signal,
            );
          },
          () =>
            readTaskPullRequestFeedback(
              task.organizationId,
              task.id,
              message.content,
              stop.signal,
            ),
        ),
        !task.titleGeneratedAt,
        (title) =>
          persistGeneratedTaskTitle(task.id, task.organizationId, title).catch(
            () =>
              console.warn(
                "Session title persistence failed; retaining the previous title",
              ),
          ),
      )[Symbol.asyncIterator]();
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await iterator.next();
            if (!next.done) {
              if (
                next.value.type === "activity" &&
                (next.value.method === "item/completed" ||
                  next.value.method === "turn/diff/updated")
              )
                await remoteWorkspace(task.id, "sync");
              if (
                next.value.type === "turn_completed" &&
                next.value.status === "completed"
              ) {
                await remoteWorkspace(task.id, "sync");
                await preserveWorkspaceArtifacts(
                  repositoryRoot,
                  task.id,
                  undefined,
                  task.baseRef,
                ).catch(() =>
                  console.warn(
                    "Artifact preservation failed; retry from Artifacts",
                  ),
                );
              }
            }
            if (next.done) {
              stop.dispose();
              active.delete(accountKey);
              controller.close();
            } else
              controller.enqueue(
                encoder.encode(`${JSON.stringify(next.value)}\n`),
              );
          } catch {
            stop.dispose();
            active.delete(accountKey);
            controller.error(
              new Error(
                "Codex execution stream failed. Reconnect Codex if the process exited.",
              ),
            );
          }
        },
        async cancel() {
          stop.dispose();
          active.delete(accountKey);
          await iterator.return?.(undefined);
        },
      });
      return new Response(body, {
        headers: {
          "content-type": "application/x-ndjson",
          "cache-control": "no-store, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Local execution failed",
      },
      { status: 503 },
    );
  }
}
