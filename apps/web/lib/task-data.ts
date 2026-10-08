import {
  artifacts,
  codexThreads,
  commandRuns,
  db,
  fileChanges,
  pullRequests,
  repositories,
  taskEvents,
  taskPlans,
  tasks,
  workspaces,
  and,
  asc,
  desc,
  eq,
  activeRequestId,
} from "@nimbus/database";
import { repositoryContext } from "./repository-browser";

export async function listTasks(organizationId: string) {
  return db()
    .select({
      id: tasks.id,
      title: tasks.title,
      objective: tasks.objective,
      requestedModel: tasks.requestedModel,
      status: tasks.status,
      archivedAt: tasks.archivedAt,
      updatedAt: tasks.updatedAt,
      repository: repositories.fullName,
      branchName: tasks.branchName,
      workspaceStatus: workspaces.status,
    })
    .from(tasks)
    .leftJoin(repositories, eq(tasks.repositoryId, repositories.id))
    .leftJoin(workspaces, eq(workspaces.taskId, tasks.id))
    .where(eq(tasks.organizationId, organizationId))
    .orderBy(desc(tasks.updatedAt));
}

export async function getTaskDetail(organizationId: string, taskId: string) {
  const [task] = await db()
    .select({
      id: tasks.id,
      title: tasks.title,
      objective: tasks.objective,
      requestedModel: tasks.requestedModel,
      requestedReasoningEffort: tasks.requestedReasoningEffort,
      status: tasks.status,
      archivedAt: tasks.archivedAt,
      branchName: tasks.branchName,
      baseRef: tasks.baseRef,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      updatedAt: tasks.updatedAt,
      repository: repositories.fullName,
      repositoryPrivate: repositories.private,
      selectedSkillIds: tasks.selectedSkillIds,
    })
    .from(tasks)
    .leftJoin(repositories, eq(tasks.repositoryId, repositories.id))
    .where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, taskId)))
    .limit(1);
  if (!task) return null;

  const [
    events,
    plans,
    files,
    commands,
    prs,
    taskArtifacts,
    workspace,
    thread,
    inspectedRepository,
  ] = await Promise.all([
    db()
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskId))
      .orderBy(asc(taskEvents.sequence)),
    db()
      .select()
      .from(taskPlans)
      .where(eq(taskPlans.taskId, taskId))
      .orderBy(desc(taskPlans.revision)),
    db()
      .select()
      .from(fileChanges)
      .where(eq(fileChanges.taskId, taskId))
      .orderBy(asc(fileChanges.path)),
    db()
      .select()
      .from(commandRuns)
      .where(eq(commandRuns.taskId, taskId))
      .orderBy(asc(commandRuns.startedAt)),
    db()
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.taskId, taskId))
      .orderBy(desc(pullRequests.generation)),
    db()
      .select()
      .from(artifacts)
      .where(eq(artifacts.taskId, taskId))
      .orderBy(asc(artifacts.name)),
    db()
      .select()
      .from(workspaces)
      .where(eq(workspaces.taskId, taskId))
      .limit(1),
    db()
      .select()
      .from(codexThreads)
      .where(eq(codexThreads.taskId, taskId))
      .limit(1),
    repositoryContext(taskId),
  ]);

  return {
    task,
    activeRequestId: await activeRequestId(taskId),
    events,
    plan: plans[0] ?? null,
    files,
    commands,
    pullRequest: prs[0] ?? null,
    pullRequestHistory: prs,
    artifacts: taskArtifacts,
    workspace: workspace[0] ?? null,
    thread: thread[0] ?? null,
    inspectedRepository,
  };
}
