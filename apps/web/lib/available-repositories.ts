import { asc, db, eq, repositories } from "@nimbus/database";

export async function listAvailableRepositories(organizationId: string) {
  const rows = await db()
    .select()
    .from(repositories)
    .where(eq(repositories.organizationId, organizationId))
    .orderBy(asc(repositories.fullName));
  // Keep historical records, but never offer removed access or a demo fallback
  // after a workspace has connected real GitHub repositories.
  const hasGitHubRepositories = rows.some((repo) => repo.githubInstallationId);
  return rows.filter(
    (repo) =>
      !repo.archived && (!hasGitHubRepositories || repo.githubInstallationId),
  );
}
