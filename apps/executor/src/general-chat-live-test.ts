import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  codexThreads,
  commandRuns,
  db,
  eq,
  taskEvents,
  taskMessages,
  tasks,
  workspaces,
  closeDatabase,
} from "@nimbus/database";

// Opt-in read-only model verification. No GitHub mutation or sandbox creation.
const sourceId = process.env.NIMBUS_LIVE_SOURCE_TASK;
if (!sourceId)
  throw new Error(
    "Set NIMBUS_LIVE_SOURCE_TASK to an authorized connected session",
  );
const [source] = await db().select().from(tasks).where(eq(tasks.id, sourceId));
if (
  !source?.requestedModel ||
  source.requestedModel === "fake-codex-test-provider"
)
  throw new Error("A real connected model is required");
const taskId = `task_${randomUUID().replaceAll("-", "")}`;
await db().insert(tasks).values({
  id: taskId,
  organizationId: source.organizationId,
  createdByUserId: source.createdByUserId,
  repositoryId: null,
  title: "General chat verification",
  objective:
    "Who are you and what can you do? Answer briefly. Also remember the verification word nebula. Do not use tools.",
  requestedModel: source.requestedModel,
  requestedReasoningEffort: source.requestedReasoningEffort,
  baseRef: "",
  status: "queued",
});
await db()
  .insert(taskMessages)
  .values({
    id: `msg_${randomUUID().replaceAll("-", "")}`,
    taskId,
    userId: source.createdByUserId,
    content:
      "Who are you and what can you do? Answer briefly. Also remember the verification word nebula. Do not use tools.",
    idempotencyKey: randomUUID(),
  });
console.log(JSON.stringify({ taskId, phase: "created" }));
async function finish() {
  for (let i = 0; i < 90; i++) {
    const [task] = await db().select().from(tasks).where(eq(tasks.id, taskId));
    if (task?.status === "failed") {
      const events = await db()
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.taskId, taskId))
        .orderBy(asc(taskEvents.sequence));
      throw new Error(events.at(-1)?.whatWasDone ?? "General chat failed");
    }
    if (task?.status === "completed") return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("General chat timed out");
}
try {
  await finish();
  const [thread] = await db()
    .select()
    .from(codexThreads)
    .where(eq(codexThreads.taskId, taskId));
  if (!thread || thread.workspaceId)
    throw new Error("General thread acquired a workspace");
  const [initialTask] = await db()
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (
    !initialTask?.titleGeneratedAt ||
    [
      "Repository overview",
      "General conversation",
      "General chat verification",
    ].includes(initialTask.title)
  )
    throw new Error("A meaningful general-chat title was not persisted");
  await db().transaction(async (tx) => {
    await tx.insert(taskMessages).values({
      id: `msg_${randomUUID().replaceAll("-", "")}`,
      taskId,
      userId: source.createdByUserId,
      content:
        "What was the verification word? Also, can you execute a shell command here? Do not run anything; just explain whether this chat has execution tools.",
      idempotencyKey: randomUUID(),
    });
    await tx
      .update(tasks)
      .set({ status: "queued", completedAt: null })
      .where(and(eq(tasks.id, taskId), eq(tasks.status, "completed")));
  });
  await finish();
  const events = await db()
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(asc(taskEvents.sequence));
  const response = events
    .filter((e) => e.category === "agent_message")
    .map((e) => e.whatWasDone)
    .join("");
  if (!response.toLowerCase().includes("nebula"))
    throw new Error("Follow-up lost conversation context");
  if (
    /^\s*#{1,6}\s/m.test(response) ||
    response.includes("nimbus_session_title")
  )
    throw new Error(
      "Response headings or internal metadata leaked into the chat",
    );
  const [finalTask] = await db()
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (finalTask?.title !== initialTask.title)
    throw new Error("Follow-up changed the generated title");
  if (
    (await db().select().from(workspaces).where(eq(workspaces.taskId, taskId)))
      .length ||
    (
      await db()
        .select()
        .from(commandRuns)
        .where(eq(commandRuns.taskId, taskId))
    ).length
  )
    throw new Error("General chat unexpectedly acquired execution state");
  console.log(
    JSON.stringify({
      taskId,
      phase: "passed",
      response,
      title: finalTask.title,
      workspaceCount: 0,
      commandCount: 0,
      threadId: thread.providerThreadId,
    }),
  );
} finally {
  await closeDatabase();
}
