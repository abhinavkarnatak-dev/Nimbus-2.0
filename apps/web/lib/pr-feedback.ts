import {
  and,
  db,
  desc,
  eq,
  githubInstallations,
  repositories,
  tasks,
  pullRequests,
} from "@nimbus/database";
import { GitHubAppClient, loadGitHubAppConfig } from "@nimbus/github";
import { assertRequestedPrTarget } from "./pr-policy";
import { sessionPrBranch } from "./pr-branches";

export async function readTaskPullRequestFeedback(
  organizationId: string,
  taskId: string,
  message: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const [task] = await db()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)));
  if (!task || task.archivedAt) throw new Error("Session is unavailable");
  if (!task.repositoryId) throw new Error("General chat has no pull request");
  const history = await db()
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.taskId, task.id))
    .orderBy(desc(pullRequests.generation));
  const requestedNumber =
    message.match(/\b(?:pr|pull[ -]?request)\s*#?\s*(\d+)\b/i)?.[1] ??
    message.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/i)?.[1];
  const pr = requestedNumber
    ? history.find((candidate) => candidate.number === Number(requestedNumber))
    : history[0];
  const [repo] = await db()
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
    !pr.url ||
    pr.branchName !== sessionPrBranch(task.id, pr.generation) ||
    !repo ||
    repo.archived ||
    !repo.githubInstallationId ||
    !repo.githubRepositoryId ||
    pr.githubRepositoryId !== repo.githubRepositoryId
  )
    throw new Error("This session has no accessible pull request");
  assertRequestedPrTarget(message, pr.number, pr.url);
  const [installation] = await db()
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.id, repo.githubInstallationId),
        eq(githubInstallations.organizationId, organizationId),
      ),
    );
  if (!installation || installation.status !== "active")
    throw new Error("GitHub installation is unavailable");
  const client = new GitHubAppClient(loadGitHubAppConfig());
  const { token } = await client.createInstallationToken(
    installation.installationId,
    [repo.githubRepositoryId],
  );
  signal?.throwIfAborted();
  return client.readPullRequestFeedback(
    token,
    repo.owner,
    repo.name,
    pr.number,
    pr.branchName,
    task.baseRef,
  );
}
