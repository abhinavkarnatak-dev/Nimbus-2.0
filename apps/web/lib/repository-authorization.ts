import {
  and,
  db,
  eq,
  tasks,
  repositories,
  githubInstallations,
} from "@nimbus/database";
import {
  GitHubAppClient,
  GitHubApiError,
  loadGitHubAppConfig,
} from "@nimbus/github";

export async function authorizeTaskRepository(taskId: string) {
  const [task] = await db().select().from(tasks).where(eq(tasks.id, taskId));
  if (
    !task ||
    !["provisioning", "running"].includes(task.status) ||
    !task.repositoryId
  )
    throw new Error("Repository validation requires a claimed repository task");
  const [repo] = await db()
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.id, task.repositoryId),
        eq(repositories.organizationId, task.organizationId),
      ),
    );
  if (
    !repo ||
    repo.archived ||
    !repo.githubInstallationId ||
    !repo.githubRepositoryId
  )
    throw new Error("Repository is unavailable or archived");
  const [installation] = await db()
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.id, repo.githubInstallationId),
        eq(githubInstallations.organizationId, task.organizationId),
      ),
    );
  if (!installation || installation.status !== "active")
    throw new Error("GitHub installation is disconnected or suspended");
  const client = new GitHubAppClient(loadGitHubAppConfig());
  try {
    const { token } = await client.createInstallationToken(
      installation.installationId,
      [repo.githubRepositoryId],
    );
    await client.verifyPublicRepository(
      token,
      repo.owner,
      repo.name,
      repo.githubRepositoryId,
    );
  } catch (error) {
    if (error instanceof GitHubApiError)
      console.warn("GitHub repository validation failed", {
        status: error.status,
        remaining: error.rateLimitRemaining,
        reset: error.rateLimitReset,
      });
    throw error;
  }
  // Only verified metadata crosses the internal bridge, never GitHub credentials.
  return {
    owner: repo.owner,
    name: repo.name,
    baseRef: task.baseRef,
    public: true as const,
  };
}
