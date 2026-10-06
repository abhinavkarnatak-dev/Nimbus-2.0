import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  db,
  tasks,
  repositories,
  workspaces,
  eq,
  and,
  desc,
} from "@nimbus/database";
import { E2BSessionManager, supervisorGit } from "./e2b-session-manager.js";
if (process.env.NIMBUS_E2B_LIVE_TEST !== "true")
  throw new Error("Explicit live opt-in required");
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
if (!source) throw new Error("Public test repository is not connected");
const taskId = `task_${randomUUID().replaceAll("-", "")}`;
const manager = new E2BSessionManager(resolve(process.cwd(), "../.."));
let current: Awaited<ReturnType<typeof manager.ensure>> | undefined;
let stage = "initial public clone and session provisioning";
await db().insert(tasks).values({
  id: taskId,
  organizationId: source.task.organizationId,
  createdByUserId: source.task.createdByUserId,
  repositoryId: source.task.repositoryId,
  title: "E2B isolated lifecycle test",
  objective: "Bounded lifecycle test; no PR or model invocation",
  baseRef: "main",
  status: "provisioning",
});
try {
  current = await manager.ensure(taskId);
  console.log(
    "PASS: normal session manager provisions public repository in E2B",
  );
  stage = "edit/checkpoint/workbench mirror";
  await manager.provider.writeFile(
    current.workspace,
    "e2b-verification/check.py",
    Buffer.from("print('E2B persisted changes')\n"),
  );
  await manager.provider.writeFile(
    current.workspace,
    "e2b-verification/output.bin",
    new Uint8Array([0, 255, 123]),
  );
  await manager.sync(taskId);
  assert.equal(
    await readFile(
      resolve(manager.root(taskId), "e2b-verification/check.py"),
      "utf8",
    ),
    "print('E2B persisted changes')\n",
  );
  assert.deepEqual(
    await readFile(
      resolve(manager.root(taskId), "e2b-verification/output.bin"),
    ),
    Buffer.from([0, 255, 123]),
  );
  console.log(
    "PASS: remote edits and exact binary bytes reflected in durable workbench mirror",
  );
  stage = "trusted commit and remote Git state synchronization";
  await supervisorGit(manager.root(taskId), ["add", "--", "e2b-verification"]);
  await supervisorGit(manager.root(taskId), [
    "-c",
    "user.name=Nimbus Test",
    "-c",
    "user.email=nimbus-test@example.invalid",
    "commit",
    "-m",
    "Verify E2B restoration (not published)",
  ]);
  await manager.published(taskId);
  const head = (
    await supervisorGit(manager.root(taskId), ["rev-parse", "HEAD"])
  ).trim();
  const remoteHead = await manager.provider.execute(current.workspace, {
    argv: ["git", "rev-parse", "HEAD"],
    timeoutMs: 10000,
  });
  assert.equal(remoteHead.stdout.trim(), head);
  console.log(
    "PASS: trusted commit metadata and repository state synchronized back into E2B",
  );
  stage = "idle pause and follow-up resume";
  const originalId = current.workspace.id;
  await manager.idle(taskId);
  const [paused] = await db()
    .select()
    .from(workspaces)
    .where(eq(workspaces.taskId, taskId));
  assert.equal(paused!.status, "paused");
  current = await manager.ensure(taskId);
  assert.equal(current.workspace.id, originalId);
  console.log("PASS: idle pauses sandbox; follow-up resumes the same machine");
  stage = "destroyed sandbox recovery with committed and uncommitted state";
  await manager.provider.writeFile(
    current.workspace,
    "e2b-verification/pending.txt",
    Buffer.from("uncommitted change survives machine deletion"),
  );
  await manager.idle(taskId);
  await manager.provider.destroy(current.workspace);
  current = undefined;
  current = await manager.ensure(taskId);
  assert.notEqual(current.workspace.id, originalId);
  assert.equal(current.restored, true);
  assert.equal(
    Buffer.from(
      await manager.provider.readFile(
        current.workspace,
        "e2b-verification/pending.txt",
      ),
    ).toString(),
    "uncommitted change survives machine deletion",
  );
  const recoveredHead = await manager.provider.execute(current.workspace, {
    argv: ["git", "rev-parse", "HEAD"],
    timeoutMs: 10000,
  });
  assert.equal(recoveredHead.stdout.trim(), head);
  const check = await manager.provider.execute(current.workspace, {
    argv: ["python3", "e2b-verification/check.py"],
    timeoutMs: 10000,
  });
  assert.equal(check.exitCode, 0);
  console.log(
    "PASS: replacement VM restores commits, uncommitted changes, binary outputs and executable repository",
  );
} catch (error) {
  console.error(
    `FAIL: ${stage}: ${error instanceof Error ? error.message.slice(0, 1000) : "unknown failure"}`,
  );
  process.exitCode = 1;
} finally {
  await manager.close().catch(() => {});
  if (current)
    await manager.provider.destroy(current.workspace).catch(() => {});
  await db().delete(tasks).where(eq(tasks.id, taskId));
  console.log(
    "Temporary test session removed; no GitHub writes or model turns performed",
  );
  process.exit(process.exitCode ?? 0);
}
