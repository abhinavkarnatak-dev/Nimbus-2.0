import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { GitHubAppClient, loadGitHubAppConfig } from "@nimbus/github";
import {
  and,
  db,
  eq,
  githubInstallations,
  repositories,
  tasks,
} from "@nimbus/database";

export async function checkoutTaskRepository(
  task: typeof tasks.$inferSelect,
  root: string,
) {
  if (!task.repositoryId)
    throw new Error("General chat has no repository to check out");
  const [repository] = await db()
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.id, task.repositoryId),
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
      "Select a repository connected through your GitHub App, not the sample repository",
    );
  const [installation] = await db()
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
  if (
    !/^[a-zA-Z0-9_.-]+$/.test(repository.owner) ||
    !/^[a-zA-Z0-9_.-]+$/.test(repository.name)
  )
    throw new Error("Invalid repository name");
  const url = `https://github.com/${repository.owner}/${repository.name}.git`;
  if (
    await stat(join(root, ".git")).then(
      () => true,
      () => false,
    )
  ) {
    if ((await runGit(root, ["remote", "get-url", "origin"])).trim() !== url)
      throw new Error(
        "Workspace repository does not match the assigned repository",
      );
    return;
  }
  const { token } = await new GitHubAppClient(
    loadGitHubAppConfig(),
  ).createInstallationToken(installation.installationId, [
    repository.githubRepositoryId,
  ]);
  const authorization = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  await runGit(root, ["clone", "--no-checkout", "--", url, "."], {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: authorization,
  });
  await runGit(root, ["check-ref-format", "--branch", task.baseRef]);
  const branch = `nimbus/${task.id}`;
  await runGit(root, [
    "checkout",
    "-b",
    branch,
    `refs/remotes/origin/${task.baseRef}`,
    "--",
  ]);
  await db()
    .update(tasks)
    .set({ branchName: branch })
    .where(eq(tasks.id, task.id));
}

export async function runGit(
  root: string,
  args: string[],
  additions: Record<string, string> = {},
): Promise<string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      [
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "APPDATA",
        "LOCALAPPDATA",
      ].includes(key.toUpperCase()),
    ),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      /*turbopackIgnore: true*/ "git",
      [
        "-c",
        `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
        "-c",
        "core.fsmonitor=false",
        ...args,
      ],
      {
        cwd: root,
        windowsHide: true,
        env: {
          ...env,
          NODE_ENV: process.env.NODE_ENV ?? "development",
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
          ...additions,
        },
      },
    );
    let output = "";
    let overflow = false;
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 2_000_000) {
        overflow = true;
        output = "";
        child.kill();
      }
    });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Git could not start. Check that Git is installed."));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (overflow)
        reject(
          new Error("Repository operation exceeded the output safety limit"),
        );
      else if (code === 0) resolve(output);
      else
        reject(
          new Error(
            `Repository operation failed (${String(code)}): ${args[0]}. Check GitHub App contents permission and repository access.`,
          ),
        );
    });
  });
}
