import { randomUUID } from "node:crypto";
import {
  asc,
  closeDatabase,
  commandRuns,
  db,
  eq,
  pullRequests,
  repositories,
  taskEvents,
  taskMessages,
  tasks,
  workspaces,
} from "@nimbus/database";

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
  throw new Error("A real repository session is required");
const [repo] = await db()
  .select()
  .from(repositories)
  .where(eq(repositories.id, source.repositoryId));
if (!repo || repo.private || repo.archived)
  throw new Error("A public repository is required");
const taskId = `task_${randomUUID().replaceAll("-", "")}`;
const objective =
  "Read-only execution verification. Run uname -s and git status --short, then briefly report the operating system and repository status. Do not edit files, install dependencies, commit, push, create or manage any pull request.";
await db().insert(tasks).values({
  id: taskId,
  organizationId: source.organizationId,
  createdByUserId: source.createdByUserId,
  repositoryId: source.repositoryId,
  title: "Repository execution verification",
  objective,
  baseRef: repo.defaultBranch,
  requestedModel: source.requestedModel,
  requestedReasoningEffort: source.requestedReasoningEffort,
  status: "queued",
});
await db()
  .insert(taskMessages)
  .values({
    id: `msg_${randomUUID().replaceAll("-", "")}`,
    taskId,
    userId: source.createdByUserId,
    content: objective,
    idempotencyKey: randomUUID(),
  });
console.log(
  JSON.stringify({ taskId, phase: "created", repository: repo.fullName }),
);
try {
  for (let i = 0; i < 180; i++) {
    const [task] = await db().select().from(tasks).where(eq(tasks.id, taskId));
    if (task?.status === "failed") {
      const events = await db()
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.taskId, taskId))
        .orderBy(asc(taskEvents.sequence));
      throw new Error(
        events.at(-1)?.whatWasDone ?? "Repository smoke test failed",
      );
    }
    if (task?.status === "completed") {
      if (
        !task.titleGeneratedAt ||
        task.title === "Repository execution verification"
      )
        throw new Error("Repository title metadata was not persisted");
      const [workspace] = await db()
        .select()
        .from(workspaces)
        .where(eq(workspaces.taskId, taskId));
      const commands = await db()
        .select()
        .from(commandRuns)
        .where(eq(commandRuns.taskId, taskId));
      const events = await db()
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.taskId, taskId))
        .orderBy(asc(taskEvents.sequence));
      if (
        workspace?.provider !== "e2b" ||
        !commands.length ||
        commands.some(
          (c) =>
            c.exitCode !== 0 || !c.workingDirectory.startsWith("/workspace"),
        )
      )
        throw new Error(
          "Repository commands were not successful remote commands",
        );
      if (!events.some((e) => e.whatWasDone.includes("Linux")))
        throw new Error("Linux execution was not confirmed");
      const response = events
        .filter((e) => e.category === "agent_message")
        .map((e) => e.whatWasDone)
        .join("");
      if (
        /^\s*#{1,6}\s/m.test(response) ||
        response.includes("nimbus_session_title")
      )
        throw new Error(
          "Repository response headings or metadata leaked into chat",
        );
      if (
        (
          await db()
            .select()
            .from(pullRequests)
            .where(eq(pullRequests.taskId, taskId))
        ).length
      )
        throw new Error("Read-only run unexpectedly published a PR");
      console.log(
        JSON.stringify({
          taskId,
          phase: "passed",
          provider: workspace.provider,
          commandCount: commands.length,
          prCount: 0,
          title: task.title,
          response,
        }),
      );
      break;
    }
    if (i === 179) throw new Error("Repository smoke test timed out");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} finally {
  await closeDatabase();
}
