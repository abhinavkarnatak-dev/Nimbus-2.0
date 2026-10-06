import {
  and,
  db,
  desc,
  eq,
  githubInstallations,
  repositories,
  tasks,
  pullRequests,
  taskEvents,
  sql,
} from "@nimbus/database";
import { GitHubAppClient, loadGitHubAppConfig } from "@nimbus/github";
import { sessionPrBranch } from "./pr-branches";

export async function manageTaskPullRequest(
  organizationId: string,
  taskId: string,
  input: {
    action: "close" | "merge";
    expectedHeadSha: string;
    number?: number | undefined;
    mergeMethod?: "merge" | "squash" | "rebase" | undefined;
  },
  authorizedAgentTurn = false,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  return db().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`publish:${taskId}`}))`,
    );
    const [task] = await tx
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)),
      );
    if (!task || task.archivedAt) throw new Error("Session is unavailable");
    if (!task.repositoryId) throw new Error("General chat has no pull request");
    if (
      ![
        "completed",
        "pr_open",
        "failed",
        "cancelled",
        ...(authorizedAgentTurn ? ["running"] : []),
      ].includes(task.status)
    )
      throw new Error(
        "Wait for the current agent request to finish before managing the PR",
      );
    const [pr] = await tx
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.taskId, task.id))
      .orderBy(desc(pullRequests.generation))
      .limit(1);
    if (input.number !== undefined && input.number !== pr?.number)
      throw new Error(
        "The current PR changed; refresh before confirming this action",
      );
    const [repository] = await tx
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.id, task.repositoryId),
          eq(repositories.organizationId, organizationId),
        ),
      );
    if (
      !pr?.number ||
      pr.branchName !== sessionPrBranch(task.id, pr.generation) ||
      !repository ||
      repository.archived ||
      !repository.githubInstallationId ||
      !repository.githubRepositoryId ||
      pr.githubRepositoryId !== repository.githubRepositoryId
    )
      throw new Error("Pull request access is unavailable");
    const [installation] = await tx
      .select()
      .from(githubInstallations)
      .where(
        and(
          eq(githubInstallations.id, repository.githubInstallationId),
          eq(githubInstallations.organizationId, organizationId),
        ),
      );
    if (!installation || installation.status !== "active")
      throw new Error("GitHub installation is unavailable");
    const client = new GitHubAppClient(loadGitHubAppConfig());
    const { token } = await client.createInstallationToken(
      installation.installationId,
      [repository.githubRepositoryId],
    );
    signal?.throwIfAborted();
    const result = await client.managePullRequest(
      token,
      repository.owner,
      repository.name,
      pr.number,
      { ...input, branch: pr.branchName, base: task.baseRef },
    );
    await tx
      .update(pullRequests)
      .set({ state: result.state, updatedAt: new Date().toISOString() })
      .where(eq(pullRequests.id, pr.id));
    await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .for("update");
    const eventId = `evt_pr_${task.id}_${pr.generation}_${result.state}`;
    const [existing] = await tx
      .select({ id: taskEvents.id })
      .from(taskEvents)
      .where(eq(taskEvents.id, eventId));
    if (!existing) {
      const [last] = await tx
        .select({ sequence: taskEvents.sequence })
        .from(taskEvents)
        .where(eq(taskEvents.taskId, task.id))
        .orderBy(desc(taskEvents.sequence))
        .limit(1);
      await tx.insert(taskEvents).values({
        id: eventId,
        taskId: task.id,
        sequence: (last?.sequence ?? 0) + 1,
        category: "tool",
        phase: "pr_open",
        status: "succeeded",
        title: `Pull request ${result.state}`,
        whatWasDone: `GitHub confirmed pull request #${pr.number} is ${result.state}. ${pr.url}`,
        whyItWasDone: "Explicit user action in Nimbus.",
        evidence: [pr.url ?? ""],
        correlationId: `pr_action_${task.id}`,
      });
    }
    return result;
  });
}
