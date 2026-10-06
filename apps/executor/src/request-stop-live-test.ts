import { randomUUID } from "node:crypto";
import { E2BWorkspaceProvider } from "./e2b-workspace-provider.js";
import {
  and,
  asc,
  closeDatabase,
  codexThreads,
  codexTurns,
  db,
  eq,
  stopRequest,
  taskEvents,
  taskMessages,
  tasks,
  workspaces,
} from "@nimbus/database";

// Read-only opt-in test: interrupts a model reply and an E2B sleep command,
// then verifies the same conversations accept new requests. No GitHub writes.
const sourceId = process.env.NIMBUS_LIVE_SOURCE_TASK;
if (!sourceId)
  throw new Error(
    "Set NIMBUS_LIVE_SOURCE_TASK to an authorized public repository session",
  );
const [source] = await db().select().from(tasks).where(eq(tasks.id, sourceId));
if (
  !source?.repositoryId ||
  !source.requestedModel ||
  source.requestedModel === "fake-codex-test-provider"
)
  throw new Error("A live public repository session is required");
async function until<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  seconds = 180,
): Promise<T> {
  for (let i = 0; i < seconds; i++) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Live stop verification timed out");
}
try {
  for (const repositoryMode of [false, true]) {
    const id = `task_${randomUUID().replaceAll("-", "")}`,
      messageId = `msg_${randomUUID().replaceAll("-", "")}`;
    const content = repositoryMode
      ? "Read-only cancellation verification. Run python3 -u -c 'import time; print(\"nimbus-stop-sleep\", flush=True); time.sleep(120)'. Do not edit files, install dependencies, commit, push or create/manage PRs."
      : "Remember the word nebula-stop. Write a very long numbered list of 300 distinct harmless brainstorming ideas. Do not use tools.";
    await db().transaction(async (tx) => {
      await tx.insert(tasks).values({
        id,
        organizationId: source.organizationId,
        createdByUserId: source.createdByUserId,
        repositoryId: repositoryMode ? source.repositoryId : null,
        title: repositoryMode
          ? "Sandbox stop verification"
          : "Chat stop verification",
        objective: content,
        requestedModel: source.requestedModel,
        requestedReasoningEffort: source.requestedReasoningEffort,
        baseRef: repositoryMode ? source.baseRef : "",
        status: "queued",
      });
      await tx.insert(taskMessages).values({
        id: messageId,
        taskId: id,
        userId: source.createdByUserId,
        content,
        idempotencyKey: randomUUID(),
      });
    });
    console.log(JSON.stringify({ id, repositoryMode, phase: "created" }));
    await until(
      () => db().select().from(taskEvents).where(eq(taskEvents.taskId, id)),
      (events) =>
        events.some((e) =>
          repositoryMode
            ? e.title === "Running command"
            : e.whatWasDone === "Codex reported turn/started.",
        ),
    );
    const stopped = await stopRequest(id, source.organizationId, messageId);
    if (stopped.status !== 202)
      throw new Error(stopped.error ?? "Stop rejected");
    await until(
      () => db().select().from(tasks).where(eq(tasks.id, id)),
      (rows) => ["cancelled", "failed"].includes(rows[0]?.status ?? ""),
      90,
    );
    const [message] = await db()
      .select()
      .from(taskMessages)
      .where(eq(taskMessages.id, messageId));
    if (message?.status !== "cancelled")
      throw new Error("Request did not stop");
    if (repositoryMode) {
      const [savedWorkspace] = await db()
        .select()
        .from(workspaces)
        .where(eq(workspaces.taskId, id));
      if (!savedWorkspace) throw new Error("Sandbox was not saved");
      const verifier = new E2BWorkspaceProvider();
      const handle = await verifier.resume(
        savedWorkspace.providerWorkspaceId,
        id,
        source.organizationId,
      );
      const check = await verifier.checked(handle, [
        "python3",
        "-c",
        `import os,json
matches=[]
for name in os.listdir('/proc'):
 if not name.isdigit() or int(name)==os.getpid(): continue
 try:
  parts=open('/proc/'+name+'/cmdline','rb').read().split(b'\\0')
  if parts and b'python' in parts[0] and b'nimbus-stop-sleep' in b' '.join(parts) and b'time.sleep(120)' in b' '.join(parts): matches.append(int(name))
 except (FileNotFoundError,PermissionError,ProcessLookupError): pass
print(json.dumps(matches))`,
      ]);
      if (check.exitCode !== 0 || JSON.parse(check.stdout).length !== 0)
        throw new Error("Sandbox command survived the stop acknowledgement");
    }
    const [thread] = await db()
      .select()
      .from(codexThreads)
      .where(eq(codexThreads.taskId, id));
    const [turn] = await db()
      .select()
      .from(codexTurns)
      .where(eq(codexTurns.taskMessageId, messageId));
    if (turn?.status !== "interrupted")
      throw new Error("Provider interruption was not saved");
    if (
      !repositoryMode &&
      (await db().select().from(workspaces).where(eq(workspaces.taskId, id)))
        .length
    )
      throw new Error("General chat acquired a sandbox");
    const followupId = `msg_${randomUUID().replaceAll("-", "")}`;
    await db().transaction(async (tx) => {
      await tx.select().from(tasks).where(eq(tasks.id, id)).for("update");
      await tx.insert(taskMessages).values({
        id: followupId,
        taskId: id,
        userId: source.createdByUserId,
        content: repositoryMode
          ? "Run uname -s and git status --short. Also verify no python process with nimbus-stop-sleep in its command line remains. Read-only checks only, no PR actions."
          : "What verification word did I ask you to remember? Answer in one sentence. Do not use tools.",
        idempotencyKey: randomUUID(),
      });
      await tx
        .update(tasks)
        .set({ status: "queued", completedAt: null })
        .where(eq(tasks.id, id));
    });
    await until(
      () => db().select().from(tasks).where(eq(tasks.id, id)),
      (rows) => rows[0]?.status === "completed",
      180,
    );
    const [sameThread] = await db()
      .select()
      .from(codexThreads)
      .where(eq(codexThreads.taskId, id));
    if (sameThread?.providerThreadId !== thread?.providerThreadId)
      throw new Error("Conversation thread was replaced");
    const events = await db()
      .select()
      .from(taskEvents)
      .where(
        and(
          eq(taskEvents.taskId, id),
          eq(taskEvents.category, "agent_message"),
        ),
      )
      .orderBy(asc(taskEvents.sequence));
    const response = events.map((e) => e.whatWasDone).join("");
    if (!response.includes(repositoryMode ? "Linux" : "nebula-stop"))
      throw new Error("Follow-up result was not verified");
    if (
      repositoryMode &&
      /(?:process still remains|matching Python process still|process is still running)/i.test(
        response,
      )
    )
      throw new Error("Interrupted sandbox command survived cancellation");
    console.log(
      JSON.stringify({
        id,
        repositoryMode,
        phase: "passed",
        interrupted: turn.status,
        sameThread: true,
        response: response.slice(-1500),
      }),
    );
  }
} finally {
  await closeDatabase();
}
