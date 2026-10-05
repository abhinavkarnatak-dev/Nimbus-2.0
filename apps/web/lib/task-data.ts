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
} from "@nimbus/database";

export async function listTasks(organizationId: string) {
  return db()
    .select({
      id: tasks.id,
      title: tasks.title,
      objective: tasks.objective,
      status: tasks.status,
      updatedAt: tasks.updatedAt,
      repository: repositories.fullName,
      branchName: tasks.branchName,
    })
    .from(tasks)
    .innerJoin(repositories, eq(tasks.repositoryId, repositories.id))
    .where(eq(tasks.organizationId, organizationId))
    .orderBy(desc(tasks.updatedAt));
}

export async function getTaskDetail(organizationId: string, taskId: string) {
  const [task] = await db()
    .select({
      id: tasks.id,
      title: tasks.title,
      objective: tasks.objective,
      status: tasks.status,
      branchName: tasks.branchName,
      baseRef: tasks.baseRef,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      repository: repositories.fullName,
      repositoryPrivate: repositories.private,
    })
    .from(tasks)
    .innerJoin(repositories, eq(tasks.repositoryId, repositories.id))
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
      .limit(1),
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
  ]);

  return {
    task,
    events,
    plan: plans[0] ?? null,
    files,
    commands,
    pullRequest: prs[0] ?? null,
    artifacts: taskArtifacts,
    workspace: workspace[0] ?? null,
    thread: thread[0] ?? null,
  };
}
