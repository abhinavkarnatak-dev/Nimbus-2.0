// User-approved public test PR. Never merge/close or modify the default branch.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  db,
  tasks,
  taskMessages,
  taskEvents,
  repositories,
  workspaces,
  pullRequests,
  commandRuns,
  artifacts,
  eq,
  and,
  desc,
} from "@nimbus/database";
if (process.env.NIMBUS_E2B_LIVE_PR_TEST !== "true")
  throw new Error("Explicit live PR authorization required");
const [source] = await db()
  .select({ task: tasks })
  .from(tasks)
  .innerJoin(repositories, eq(repositories.id, tasks.repositoryId))
  .where(
    and(
      eq(repositories.owner, "abhinavkarnatak-dev"),
      eq(repositories.name, "Testing-Nimbus-PRs"),
    ),
  )
  .orderBy(desc(tasks.createdAt))
  .limit(1);
if (
  !source?.task.requestedModel ||
  source.task.requestedModel === "fake-codex-test-provider"
)
  throw new Error("Real connected session/model is required");
const taskId = `task_${randomUUID().replaceAll("-", "")}`;
const messageId = `msg_${randomUUID().replaceAll("-", "")}`;
await db().transaction(async (tx) => {
  await tx.insert(tasks).values({
    id: taskId,
    organizationId: source.task.organizationId,
    createdByUserId: source.task.createdByUserId,
    repositoryId: source.task.repositoryId,
    title: "E2B flow verification",
    objective: "Verify remote execution and create an unmerged test PR",
    requestedModel: source.task.requestedModel,
    requestedReasoningEffort: source.task.requestedReasoningEffort,
    baseRef: "main",
    status: "queued",
  });
  await tx.insert(taskMessages).values({
    id: messageId,
    taskId,
    userId: source.task.createdByUserId,
    idempotencyKey: messageId,
    content:
      "This is an authorized E2B integration test on Testing-Nimbus-PRs. First run Python to assert sys.platform == 'linux' and os.getcwd() == '/workspace/repo'; stop if either assertion fails. Then create e2b-verification/check.py containing a small add(a,b) function and assertions for positive and negative numbers, and run it. Create e2b-verification/report.md describing the checks you actually ran. Only modify those two files. Create a pull request titled 'Verify Nimbus E2B execution flow' using the provided publishing tool, with an honest test summary. Do not merge or close it. Do not modify the default branch. Do not use shell git commit/push or gh for publishing.",
  });
});
console.log(`Test session ${taskId} queued through normal worker`);
let lastSequence = 0;
let finished = false;
for (let n = 0; n < 360; n++) {
  const events = await db()
    .select({ sequence: taskEvents.sequence, title: taskEvents.title })
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId));
  for (const event of events.sort((a, b) => a.sequence - b.sequence))
    if (event.sequence > lastSequence) {
      console.log(`EVENT: ${event.title}`);
      lastSequence = event.sequence;
    }
  const [task] = await db().select().from(tasks).where(eq(tasks.id, taskId));
  if (task!.status === "failed")
    throw new Error(
      `Live flow failed (${task!.failureCode}); inspect the test session`,
    );
  if (task!.status === "completed") {
    finished = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
assert.equal(
  finished,
  true,
  "Normal worker did not reach idle within test budget",
);
const [workspace] = await db()
  .select()
  .from(workspaces)
  .where(eq(workspaces.taskId, taskId));
assert.equal(workspace!.provider, "e2b");
assert.equal(workspace!.status, "paused");
const [pr] = await db()
  .select()
  .from(pullRequests)
  .where(eq(pullRequests.taskId, taskId));
assert.equal(pr!.state, "open");
const checks = await db()
  .select()
  .from(commandRuns)
  .where(eq(commandRuns.taskId, taskId));
assert.ok(checks.some((c) => c.exitCode === 0));
const outputs = await db()
  .select()
  .from(artifacts)
  .where(eq(artifacts.taskId, taskId));
assert.ok(outputs.some((a) => a.name === "e2b-verification/report.md"));
assert.match(
  await readFile(
    resolve(
      process.cwd(),
      "../../.nimbus/workspaces",
      taskId,
      "e2b-verification/check.py",
    ),
    "utf8",
  ),
  /assert/,
);
console.log(
  `PASS: normal chat → E2B clone → remote commands/edits → recorded checks → artifacts → open PR → idle pause (${pr!.url})`,
);
console.log(`Retained test session: ${taskId}; PR left unmerged`);
process.exit(0);
