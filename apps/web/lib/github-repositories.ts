import { randomUUID } from "node:crypto";
import {
  and,
  db,
  eq,
  githubInstallations,
  repositories,
  sql,
} from "@nimbus/database";
import { GitHubAppClient, loadGitHubAppConfig } from "@nimbus/github";

export async function reconcileGitHubRepositories(
  organizationId: string,
  installationId?: number,
  suppliedClient?: Pick<
    GitHubAppClient,
    "getInstallation" | "listInstallationRepositories"
  >,
) {
  const installations = await db()
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.organizationId, organizationId),
        eq(githubInstallations.status, "active"),
        ...(installationId
          ? [eq(githubInstallations.installationId, installationId)]
          : []),
      ),
    );
  if (!installations.length) return { installations: 0, repositories: 0 };
  const client = suppliedClient ?? new GitHubAppClient(loadGitHubAppConfig());
  let count = 0;
  for (const installation of installations) {
    const verified = await client.getInstallation(installation.installationId);
    if (verified.id !== installation.installationId || verified.suspendedAt)
      throw new Error("GitHub installation is unavailable");
    const snapshot = await client.listInstallationRepositories(
      installation.installationId,
    );
    await db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${installation.installationId}::bigint)`,
      );
      const [current] = await tx
        .select()
        .from(githubInstallations)
        .where(
          and(
            eq(githubInstallations.id, installation.id),
            eq(githubInstallations.organizationId, organizationId),
            eq(githubInstallations.status, "active"),
          ),
        );
      if (!current)
        throw new Error(
          "GitHub installation access changed during synchronization",
        );
      const now = new Date().toISOString();
      await tx
        .update(repositories)
        .set({ archived: true, updatedAt: now })
        .where(
          and(
            eq(repositories.organizationId, organizationId),
            eq(repositories.githubInstallationId, installation.id),
          ),
        );
      for (const repo of snapshot)
        await tx
          .insert(repositories)
          .values({
            id: `repo_${randomUUID().replaceAll("-", "")}`,
            organizationId,
            githubInstallationId: installation.id,
            githubRepositoryId: repo.id,
            owner: repo.owner,
            name: repo.name,
            fullName: repo.fullName,
            defaultBranch: repo.defaultBranch,
            private: repo.private,
            archived: repo.archived,
          })
          .onConflictDoUpdate({
            target: [repositories.organizationId, repositories.fullName],
            set: {
              githubInstallationId: installation.id,
              githubRepositoryId: repo.id,
              owner: repo.owner,
              name: repo.name,
              defaultBranch: repo.defaultBranch,
              private: repo.private,
              archived: repo.archived,
              updatedAt: now,
            },
          });
    });
    count += snapshot.length;
  }
  return { installations: installations.length, repositories: count };
}
