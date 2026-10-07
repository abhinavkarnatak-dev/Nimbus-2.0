import {
  and,
  db,
  eq,
  githubInstallations,
  repositories,
  taskCheckpoints,
} from "@nimbus/database";
import { GitHubAppClient, loadGitHubAppConfig } from "@nimbus/github";
import { z } from "zod";
import { filePath } from "./workspace-files";

export const repositoryContextSchema = z.object({
  repositoryId: z.string(),
  fullName: z.string(),
  ref: z.string(),
  sha: z.string().regex(/^[a-f0-9]{40}$/),
});
const contents = new Map<
  string,
  {
    value: {
      entries?: Array<{ name: string; path: string; kind: string }>;
      content?: string;
    };
    size: number;
  }
>();
const refs = new Map<string, { sha: string; expires: number }>();
let cacheBytes = 0;

export async function accessibleRepository(
  organizationId: string,
  repositoryId: string,
) {
  const [repo] = await db()
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.id, repositoryId),
        eq(repositories.organizationId, organizationId),
      ),
    );
  if (
    !repo ||
    repo.archived ||
    !repo.githubInstallationId ||
    !repo.githubRepositoryId
  )
    throw new Error("Repository is not connected to this workspace");
  if (repo.private)
    throw new Error("Private repository support is not enabled");
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
  return { repo, installation };
}

export async function readConnectedRepository(
  organizationId: string,
  repositoryId: string,
  path = "",
  revision?: string,
) {
  filePath(path);
  const { repo, installation } = await accessibleRepository(
    organizationId,
    repositoryId,
  );
  const client = new GitHubAppClient(loadGitHubAppConfig());
  // Credentials stay on the server and this token has no write/PR permissions.
  const { token } = await client.createInstallationToken(
    installation.installationId,
    [repo.githubRepositoryId!],
    "read",
  );
  await client.verifyPublicRepository(
    token,
    repo.owner,
    repo.name,
    repo.githubRepositoryId!,
  );
  const refKey = `${organizationId}:${repo.id}:${repo.defaultBranch}`;
  const cachedRef = refs.get(refKey);
  const sha =
    revision ??
    (cachedRef && cachedRef.expires > Date.now()
      ? cachedRef.sha
      : await client.readRepositoryRef(
          token,
          repo.owner,
          repo.name,
          repo.defaultBranch,
        ));
  if (!revision) {
    refs.delete(refKey);
    refs.set(refKey, {
      sha,
      expires:
        cachedRef?.sha === sha && cachedRef.expires > Date.now()
          ? cachedRef.expires
          : Date.now() + 30_000,
    });
    while (refs.size > 64) refs.delete(refs.keys().next().value!);
  }
  const key = `${organizationId}:${repo.id}:${sha}:${path}`;
  const cached = contents.get(key);
  let value = cached?.value;
  if (cached) {
    contents.delete(key);
    contents.set(key, cached);
  }
  if (!value) {
    value = await client.readRepositoryContents(
      token,
      repo.owner,
      repo.name,
      sha,
      path,
    );
    const size = Buffer.byteLength(JSON.stringify(value));
    if (size <= 256_000) {
      // Concurrent reads can finish for the same key. Account for replacement
      // rather than double-counting bytes that are no longer in the cache.
      const previous = contents.get(key);
      if (previous) cacheBytes -= previous.size;
      contents.delete(key);
      contents.set(key, { value, size });
      cacheBytes += size;
      while (contents.size > 64 || cacheBytes > 4_000_000) {
        const oldest = contents.keys().next().value!;
        cacheBytes -= contents.get(oldest)!.size;
        contents.delete(oldest);
      }
    }
  }
  return {
    repositoryId: repo.id,
    fullName: repo.fullName,
    ref: repo.defaultBranch,
    sha,
    path,
    ...value,
  };
}

export async function repositoryContext(taskId: string) {
  const [record] = await db()
    .select()
    .from(taskCheckpoints)
    .where(
      and(
        eq(taskCheckpoints.taskId, taskId),
        eq(taskCheckpoints.kind, "repository_context"),
      ),
    );
  const parsed = repositoryContextSchema.safeParse(record?.payload);
  return parsed.success ? parsed.data : null;
}
export async function rememberRepositoryContext(
  taskId: string,
  context: z.infer<typeof repositoryContextSchema>,
) {
  const id = `checkpoint_repository_context_${taskId}`;
  await db()
    .insert(taskCheckpoints)
    .values({
      id,
      taskId,
      kind: "repository_context",
      payload: context,
      eventSequence: 0,
    })
    .onConflictDoUpdate({
      target: taskCheckpoints.id,
      set: { payload: context },
    });
}
