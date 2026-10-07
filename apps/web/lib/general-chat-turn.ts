import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  and,
  codexThreads,
  db,
  eq,
  persistGeneratedTaskTitle,
  readAgentInstructions,
  taskMessages,
  tasks,
} from "@nimbus/database";
import {
  sessionTitlePrompt,
  presentSessionTurn,
  withAgentInstructions,
  withSelectedSkills,
} from "@nimbus/shared";
import { connectedDeviceProvider } from "./codex-device";
import type { CodexAppServerProvider } from "@nimbus/codex";
import { requestStopSignal } from "./request-stop-signal";

// Called only after the private executor key and claimed task have been verified.
export async function generalChatOperation(
  request: Request,
  task: typeof tasks.$inferSelect,
  input: { operation?: string; threadId?: string; turnId?: string },
  active: Set<string>,
  leasedProvider?: CodexAppServerProvider,
) {
  if (task.repositoryId)
    throw new Error("General chat cannot use a repository session");
  const accountKey = `${task.organizationId}:${task.createdByUserId}`;
  const provider =
    leasedProvider ?? (await connectedDeviceProvider(accountKey));
  if (typeof provider.startChatThread !== "function")
    throw new Error(
      "Reconnect Codex in Connections once to load general chat support",
    );
  const [thread] = await db()
    .select()
    .from(codexThreads)
    .where(eq(codexThreads.taskId, task.id));
  if (input.operation === "thread/start") {
    if (thread) return NextResponse.json({ threadId: thread.providerThreadId });
    if (!task.requestedModel) throw new Error("Chat has no selected model");
    const threadId = await provider.startChatThread(task.requestedModel);
    await db()
      .insert(codexThreads)
      .values({
        id: `ctx_${randomUUID().replaceAll("-", "")}`,
        taskId: task.id,
        workspaceId: null,
        providerThreadId: threadId,
        model: task.requestedModel,
        providerConfigVersion: 3,
      });
    return NextResponse.json({ threadId });
  }
  if (
    !thread ||
    thread.providerThreadId !== input.threadId ||
    thread.workspaceId
  )
    return NextResponse.json(
      { error: "Thread does not belong to this general chat" },
      { status: 403 },
    );
  if (input.operation === "thread/resume") {
    await provider.resumeChatThread(thread.providerThreadId);
    return NextResponse.json({ resumed: true });
  }
  if (input.operation === "turn/interrupt" && input.turnId) {
    await provider.interruptTurn(thread.providerThreadId, input.turnId);
    return NextResponse.json({ interrupted: true });
  }
  if (input.operation !== "turn/start")
    return NextResponse.json(
      { error: "Unsupported general chat operation" },
      { status: 400 },
    );
  if (active.has(accountKey))
    return NextResponse.json(
      { error: "This account already has an active Codex turn" },
      { status: 409 },
    );
  const [message] = await db()
    .select()
    .from(taskMessages)
    .where(
      and(eq(taskMessages.taskId, task.id), eq(taskMessages.status, "running")),
    );
  if (!message) throw new Error("Chat has no claimed user message");
  const instructions = await readAgentInstructions(
    task.organizationId,
    message.userId,
  );
  active.add(accountKey);
  const stop = requestStopSignal(message.id, request.signal);
  const iterator = presentSessionTurn(
    provider.runTurn({
      threadId: thread.providerThreadId,
      prompt: withAgentInstructions(
        withSelectedSkills(
          [
            "For downloadable file requests in this chat, do not require a sandbox. Return the complete content in a fenced code block whose language identifies the requested file: csv for Excel-compatible spreadsheets, pdf for PDFs, doc for Word-compatible documents, md or txt for text documents, and the actual language for source files. Nimbus will provide a download button for these blocks.",
            sessionTitlePrompt(
              message.content,
              task.title,
              Boolean(task.titleGeneratedAt),
              "chat",
            ),
          ].join("\n\n"),
          message.selectedSkills,
        ),
        instructions,
      ),
      ...(task.requestedReasoningEffort
        ? { reasoningEffort: task.requestedReasoningEffort }
        : {}),
      signal: stop.signal,
    }),
    !task.titleGeneratedAt,
    (title) =>
      persistGeneratedTaskTitle(task.id, task.organizationId, title).catch(() =>
        console.warn("Chat title persistence failed"),
      ),
    "chat",
  )[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) {
            stop.dispose();
            active.delete(accountKey);
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(JSON.stringify(next.value) + "\n"));
        } catch (error) {
          stop.dispose();
          active.delete(accountKey);
          controller.error(error);
        }
      },
      async cancel() {
        stop.dispose();
        try {
          await iterator.return?.(undefined);
        } finally {
          active.delete(accountKey);
        }
      },
    }),
    {
      headers: {
        "content-type": "application/x-ndjson",
        "cache-control": "no-store",
      },
    },
  );
}
