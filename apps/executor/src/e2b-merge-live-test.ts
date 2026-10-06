import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  db,
  tasks,
  taskMessages,
  pullRequests,
  workspaces,
  eq,
} from "@nimbus/database";
if (process.env.NIMBUS_E2B_LIVE_MERGE_TEST !== "true")
  throw new Error("Explicit user-authorized merge required");
const taskId = "task_2e44f8bc2dac4557ae5a54279cd03208";
const [task] = await db().select().from(tasks).where(eq(tasks.id, taskId));
const [pr] = await db()
  .select()
  .from(pullRequests)
  .where(eq(pullRequests.taskId, taskId));
if (
  task?.objective !==
    "Verify remote execution and create an unmerged test PR" ||
  task.status !== "completed" ||
  pr?.number !== 18 ||
  pr.state !== "open"
)
  throw new Error("Only the explicitly authorized idle PR #18 may be tested");
const messageId = `msg_${randomUUID().replaceAll("-", "")}`;
await db().transaction(async (tx) => {
  await tx.insert(taskMessages).values({
    id: messageId,
    taskId,
    userId: task.createdByUserId,
    idempotencyKey: messageId,
    content:
      "Pull request looks sorted so we can proceed with the merging part.",
  });
  await tx
    .update(tasks)
    .set({ status: "queued", completedAt: null })
    .where(eq(tasks.id, taskId));
});
console.log(
  "Replaying the exact user-authorized merge wording through normal chat",
);
let finished = false;
for (let n = 0; n < 240; n++) {
  const [record] = await db().select().from(tasks).where(eq(tasks.id, taskId));
  if (record!.status === "failed")
    throw new Error(`Chat merge failed: ${record!.failureCode}`);
  if (record!.status === "completed") {
    finished = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
assert.equal(finished, true);
const [merged] = await db()
  .select()
  .from(pullRequests)
  .where(eq(pullRequests.taskId, taskId));
const [workspace] = await db()
  .select()
  .from(workspaces)
  .where(eq(workspaces.taskId, taskId));
assert.equal(merged!.state, "merged");
assert.equal(workspace!.status, "paused");
console.log(
  "PASS: exact conversational request merges PR #18 through normal chat and returns session to idle/paused",
);
process.exit(0);
