import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
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
import { runGit } from "./local-repository";
import { filePath, taskFileRoot } from "./workspace-files";
import { isPrivateArtifactPath } from "./artifact-policy";
import { requestsPullRequest } from "./pr-policy";
import { sessionPrBranch } from "./pr-branches";

export async function validatePublishingChanges(root: string, paths: string[]) {
  if (paths.length > 500)
    throw new Error("PR exceeds the 500-file publishing limit");
  let total = 0;
  for (const path of paths) {
    filePath(path);
    if (isPrivateArtifactPath(path))
      throw new Error(`Private credential file cannot be published: ${path}`);
    let target = root;
    for (const segment of path.split("/")) {
      target = join(target, segment);
      const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!info) break; // A tracked deletion is allowed.
      if (info.isSymbolicLink())
        throw new Error(`Linked files cannot be published: ${path}`);
      if (!info.isDirectory() && !info.isFile())
        throw new Error("Unsupported repository file");
      if (info.isFile()) {
        total += info.size;
        if (info.size > 20_000_000 || total > 50_000_000)
          throw new Error("PR exceeds the publishing size limit");
        const content = await readFile(target);
        if (
          /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bAKIA[A-Z0-9]{16}\b/.test(
            content.toString("utf8"),
          )
        )
          throw new Error(
            `Potential credential detected in ${path}; publishing stopped`,
          );
      }
    }
  }
}

// The database advisory lock serializes retries across processes. GitHub is also
// queried by the deterministic branch, recovering after a lost API/DB response.
export async function publishTaskPullRequest(
  repositoryRoot: string,
  task: typeof tasks.$inferSelect,
  message: string,
  title = task.title,
  body = "",
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!task.repositoryId)
    throw new Error("General chat cannot publish repository changes");
  const repositoryId = task.repositoryId;
  if (!requestsPullRequest(message))
    throw new Error(
      "PR publishing requires an explicit user request in this turn",
    );
  if (!title.trim() || title.length > 200 || body.length > 20_000)
    throw new Error("Invalid PR title or description");
  return db().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`publish:${task.id}`}))`,
    );
    const [repository] = await tx
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.id, repositoryId),
          eq(repositories.organizationId, task.organizationId),
        ),
      );
    if (
      !repository ||
      repository.archived ||
      !repository.githubInstallationId ||
      !repository.githubRepositoryId
    )
      throw new Error(
        "Repository is not connected to an active GitHub installation",
      );
    if (
      ![repository.owner, repository.name].every((part) =>
        /^[a-zA-Z0-9_.-]+$/.test(part),
      )
    )
      throw new Error("Invalid repository name");
    const [installation] = await tx
      .select()
      .from(githubInstallations)
      .where(
        and(
          eq(githubInstallations.id, repository.githubInstallationId),
          eq(githubInstallations.organizationId, task.organizationId),
        ),
      );
    if (!installation || installation.status !== "active")
      throw new Error("GitHub installation is unavailable");
    const root = await taskFileRoot(repositoryRoot, task.id);
    if (!(await lstat(join(root, ".git"))).isDirectory())
      throw new Error("Publishing requires isolated Git metadata");
    if ((await realpath(join(root, ".git"))) !== join(root, ".git"))
      throw new Error("Linked Git metadata cannot be published");
    if (
      (await realpath(
        (await runGit(root, ["rev-parse", "--show-toplevel"])).trim(),
      )) !== root
    )
      throw new Error("Git working tree is outside the task workspace");
    await runGit(root, ["check-ref-format", "--branch", task.baseRef]);
    const url = `https://github.com/${repository.owner}/${repository.name}.git`;
    if ((await runGit(root, ["remote", "get-url", "origin"])).trim() !== url)
      throw new Error(
        "Workspace repository does not match the assigned repository",
      );
    const [latest] = await tx
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.taskId, task.id))
      .orderBy(desc(pullRequests.generation))
      .limit(1);
    if (
      latest &&
      (latest.branchName !== sessionPrBranch(task.id, latest.generation) ||
        latest.githubRepositoryId !== repository.githubRepositoryId)
    )
      throw new Error("Previous PR does not belong to this session");
    const client = new GitHubAppClient(loadGitHubAppConfig());
    const { token } = await client.createInstallationToken(
      installation.installationId,
      [repository.githubRepositoryId],
    );
    let previousState = latest?.state;
    if (latest?.number) {
      const remote = await client.sessionPullRequestState(
        token,
        repository.owner,
        repository.name,
        latest.number,
        latest.branchName,
        task.baseRef,
      );
      previousState = remote.state;
      await tx
        .update(pullRequests)
        .set({ state: remote.state, updatedAt: new Date().toISOString() })
        .where(eq(pullRequests.id, latest.id));
    }
    const rollover = Boolean(
      latest && (previousState === "closed" || previousState === "merged"),
    );
    const generation = latest ? latest.generation + (rollover ? 1 : 0) : 1;
    const branch = sessionPrBranch(task.id, generation);
    const currentBranch = (
      await runGit(root, ["branch", "--show-current"])
    ).trim();
    if (
      (currentBranch !== branch &&
        !(rollover && currentBranch === latest?.branchName)) ||
      task.baseRef === branch ||
      repository.defaultBranch === branch
    )
      throw new Error(
        "Publishing is only allowed from this task's isolated branch",
      );
    const paths = [
      ...new Set(
        [
          ...(
            await runGit(root, ["diff", "--name-only", "-z", "HEAD", "--"])
          ).split("\0"),
          ...(
            await runGit(root, [
              "ls-files",
              "--others",
              "--exclude-standard",
              "-z",
            ])
          ).split("\0"),
          ...(
            await runGit(root, [
              "diff",
              "--name-only",
              "-z",
              `refs/remotes/origin/${task.baseRef}...HEAD`,
              "--",
            ])
          ).split("\0"),
        ].filter(Boolean),
      ),
    ];
    await validatePublishingChanges(root, paths);
    signal?.throwIfAborted();
    await client.findSessionPullRequest(
      token,
      repository.owner,
      repository.name,
      branch,
      task.baseRef,
    );
    const auth = {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
      GIT_CONFIG_KEY_1: "credential.helper",
      GIT_CONFIG_VALUE_1: "",
    };
    await runGit(root, ["add", "--all", "--", "."]);
    if ((await runGit(root, ["diff", "--cached", "--name-only"])).trim()) {
      await runGit(root, [
        "-c",
        "user.name=Nimbus",
        "-c",
        "user.email=nimbus@users.noreply.github.com",
        "-c",
        "commit.gpgSign=false",
        "commit",
        "-m",
        title,
      ]);
    }
    if (rollover && currentBranch !== branch) {
      if (!latest?.headSha || !/^[a-f0-9]{40}$/.test(latest.headSha))
        throw new Error(
          "Previous PR commit is unavailable; changes are preserved",
        );
      await runGit(root, [
        "merge-base",
        "--is-ancestor",
        latest.headSha,
        "HEAD",
      ]);
      await runGit(
        root,
        [
          "fetch",
          "origin",
          `refs/heads/${task.baseRef}:refs/remotes/origin/${task.baseRef}`,
        ],
        auth,
      );
      const base = (
        await runGit(root, ["rev-parse", `refs/remotes/origin/${task.baseRef}`])
      ).trim();
      // Object-only three-way merge: applies only the post-PR delta, handles
      // squash merges, and never overwrites a worktree on conflict.
      let tree: string;
      try {
        tree = (
          await runGit(root, [
            "merge-tree",
            "--write-tree",
            `--merge-base=${latest.headSha}`,
            base,
            "HEAD",
          ])
        )
          .trim()
          .split("\n")[0]!;
      } catch {
        throw new Error(
          "New PR changes conflict with the latest base branch. Your changes remain on the previous task branch; resolve the conflict before retrying.",
        );
      }
      if (!/^[a-f0-9]{40}$/.test(tree))
        throw new Error("New PR tree was not confirmed");
      if (tree === (await runGit(root, ["rev-parse", `${base}^{tree}`])).trim())
        throw new Error("There are no new changes since the previous PR");
      const commit = (
        await runGit(root, [
          "-c",
          "user.name=Nimbus",
          "-c",
          "user.email=nimbus@users.noreply.github.com",
          "commit-tree",
          tree,
          "-p",
          base,
          "-m",
          title,
        ])
      ).trim();
      if (!/^[a-f0-9]{40}$/.test(commit))
        throw new Error("New PR commit was not confirmed");
      await runGit(root, [
        "update-ref",
        `refs/nimbus/pr-bases/pr-${generation}`,
        base,
      ]);
      await runGit(root, ["checkout", "-b", branch, commit, "--"]);
    }
    if (
      !(
        await runGit(root, [
          "rev-list",
          "--count",
          `refs/remotes/origin/${task.baseRef}..HEAD`,
        ])
      )
        .trim()
        .match(/^[1-9]\d*$/)
    )
      throw new Error(
        "There are no changes to publish against the base branch",
      );
    // Explicit refspec, never --force, never the default branch.
    signal?.throwIfAborted();
    await runGit(root, ["push", "origin", `HEAD:refs/heads/${branch}`], auth);
    const headSha = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    signal?.throwIfAborted();
    const pr = await client.ensurePullRequest(
      token,
      repository.owner,
      repository.name,
      {
        head: branch,
        base: task.baseRef,
        title,
        body:
          body ||
          `## Summary\n${title}\n\nCreated by Nimbus for this session.\n\n## Verification\nSee the session's recorded checks. PR creation does not certify that tests passed.`,
      },
    );
    if (pr.headSha && pr.headSha !== headSha)
      await client.confirmPullRequestHead(
        token,
        repository.owner,
        repository.name,
        pr.number,
        branch,
        task.baseRef,
        headSha,
        signal,
      );
    await tx
      .insert(pullRequests)
      .values({
        id: `pr_${randomUUID().replaceAll("-", "")}`,
        taskId: task.id,
        generation,
        githubRepositoryId: repository.githubRepositoryId,
        number: pr.number,
        branchName: branch,
        title,
        state: pr.state,
        url: pr.url,
        headSha,
        idempotencyKey: `publish_${task.id}_${generation}`,
      })
      .onConflictDoUpdate({
        target: [pullRequests.taskId, pullRequests.generation],
        set: {
          number: pr.number,
          state: pr.state,
          url: pr.url,
          headSha,
          updatedAt: new Date().toISOString(),
        },
      });
    await tx
      .update(tasks)
      .set({ branchName: branch })
      .where(eq(tasks.id, task.id));
    // Missing metadata must not turn an already confirmed publication into a
    // failure or invent zero changes. The card explicitly handles unavailable stats.
    const summary = await client
      .pullRequestSummary(
        token,
        repository.owner,
        repository.name,
        pr.number,
        branch,
        task.baseRef,
        headSha,
      )
      .catch(() => null);
    await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .for("update");
    const eventId = `evt_publish_${task.id}_${generation}_${headSha}`;
    const [recorded] = await tx
      .select({ id: taskEvents.id })
      .from(taskEvents)
      .where(eq(taskEvents.id, eventId));
    if (!recorded) {
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
        category: "agent_message",
        phase: "creating_pr",
        status: "succeeded",
        title: "Pull request ready",
        whatWasDone: `Pull request #${pr.number}: ${pr.url}`,
        whyItWasDone: "",
        evidence: [
          pr.url,
          `commit:${headSha}`,
          `pr-card:${JSON.stringify(summary ?? { title, repository: `${repository.owner}/${repository.name}`, number: pr.number, url: pr.url })}`,
        ],
        correlationId: `publish_${task.id}`,
      });
    }
    return { ...pr, headSha, branch };
  });
}
