import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Sandbox } from "e2b";
import {
  db,
  tasks,
  taskMessages,
  taskEvents,
  workspaces,
  pullRequests,
  codexThreads,
  eq,
} from "@nimbus/database";
if (process.env.NIMBUS_E2B_LIVE_TEST !== "true")
  throw new Error("Explicit live test authorization required");
const taskId = process.env.NIMBUS_E2B_TEST_SESSION;
if (!taskId || !/^task_[a-f0-9]{32}$/.test(taskId))
  throw new Error("Provide the verification session id");
const [before] = await db().select().from(tasks).where(eq(tasks.id, taskId));
const [oldWorkspace] = await db()
  .select()
  .from(workspaces)
  .where(eq(workspaces.taskId, taskId));
const [oldThread] = await db()
  .select()
  .from(codexThreads)
  .where(eq(codexThreads.taskId, taskId));
const oldPrs = await db()
  .select()
  .from(pullRequests)
  .where(eq(pullRequests.taskId, taskId));
if (
  before?.objective !==
    "Verify remote execution and create an unmerged test PR" ||
  before.status !== "completed" ||
  oldWorkspace?.provider !== "e2b" ||
  oldWorkspace.status !== "paused"
)
  throw new Error("Only the idle test-owned session may be fault-injected");
if (!process.env.E2B_API_KEY)
  throw new Error("E2B provisioning key is required");
await Sandbox.kill(oldWorkspace.providerWorkspaceId, {
  apiKey: process.env.E2B_API_KEY,
});
console.log(
  "Test-owned paused sandbox deliberately destroyed to simulate expiry",
);
const messageId = `msg_${randomUUID().replaceAll("-", "")}`;
await db().transaction(async (tx) => {
  await tx.insert(taskMessages).values({
    id: messageId,
    taskId,
    userId: before.createdByUserId,
    idempotencyKey: messageId,
    content:
      "Continue our E2B verification session. First assert Python sys.platform == 'linux' and os.getcwd() == '/workspace/repo'. Read the two e2b-verification files we created earlier and run check.py again. Confirm the previous context and saved files are available. This is read-only: do not edit, create/update/merge/close any PR, or commit/push anything.",
  });
  await tx
    .update(tasks)
    .set({ status: "queued", completedAt: null })
    .where(eq(tasks.id, taskId));
});
let complete = false;
for (let n = 0; n < 240; n++) {
  const [task] = await db().select().from(tasks).where(eq(tasks.id, taskId));
  if (task!.status === "failed")
    throw new Error(`Same-chat recovery failed: ${task!.failureCode}`);
  if (task!.status === "completed") {
    complete = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
assert.equal(complete, true);
const [after] = await db().select().from(tasks).where(eq(tasks.id, taskId));
const [workspace] = await db()
  .select()
  .from(workspaces)
  .where(eq(workspaces.taskId, taskId));
const [thread] = await db()
  .select()
  .from(codexThreads)
  .where(eq(codexThreads.taskId, taskId));
const prs = await db()
  .select()
  .from(pullRequests)
  .where(eq(pullRequests.taskId, taskId));
const events = await db()
  .select()
  .from(taskEvents)
  .where(eq(taskEvents.taskId, taskId));
assert.notEqual(
  workspace!.providerWorkspaceId,
  oldWorkspace.providerWorkspaceId,
);
assert.equal(workspace!.status, "paused");
assert.equal(after!.title, before.title);
assert.equal(thread!.providerThreadId, oldThread!.providerThreadId);
assert.deepEqual(
  prs.map((p) => [p.id, p.state, p.headSha]),
  oldPrs.map((p) => [p.id, p.state, p.headSha]),
);
assert.ok(events.some((e) => e.title === "Session restored"));
console.log(
  "PASS: same chat/thread/title/PR history continued on a new E2B VM; saved files and checks reused; returned to idle pause",
);
process.exit(0);
