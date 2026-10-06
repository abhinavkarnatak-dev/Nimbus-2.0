import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile, rm, unlink } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import {
  db,
  closeDatabase,
  eq,
  organizations,
  users,
  repositories,
  githubInstallations,
  tasks,
  pullRequests,
  taskEvents,
} from "@nimbus/database";

const state = vi.hoisted(() => ({
  failPush: false,
  pushes: [] as string[][],
  tokenRequests: [] as number[][],
  prState: "open",
  prStateTarget: 14,
}));
vi.mock("@nimbus/github", () => ({
  loadGitHubAppConfig: () => ({}),
  GitHubAppClient: class {
    async sessionPullRequestState(
      _token: string,
      _owner: string,
      _repository: string,
      number: number,
    ) {
      return { state: number === state.prStateTarget ? state.prState : "open" };
    }
    async pullRequestSummary(
      _token: string,
      owner: string,
      repository: string,
      number: number,
    ) {
      return {
        title: "Test PR",
        repository: `${owner}/${repository}`,
        number,
        url: `https://github.com/${owner}/${repository}/pull/${number}`,
        changedFiles: 1,
        additions: 1,
        deletions: 0,
        files: [{ path: "hello.py", additions: 1, deletions: 0 }],
      };
    }
    async findSessionPullRequest() {
      return null;
    }
    async createInstallationToken(_id: number, ids: number[]) {
      state.tokenRequests.push(ids);
      return { token: "test-token" };
    }
    async ensurePullRequest(
      _token: string,
      owner: string,
      repository: string,
      input: { head: string },
    ) {
      const generation = Number(input.head.match(/-pr-(\d+)$/)?.[1] ?? 1);
      return {
        number: 13 + generation,
        url: `https://github.com/${owner}/${repository}/pull/${13 + generation}`,
        state: "open",
      };
    }
  },
}));
vi.mock("./local-repository", async (original) => {
  const actual = await original<typeof import("./local-repository")>();
  return {
    ...actual,
    runGit: async (
      root: string,
      args: string[],
      additions?: Record<string, string>,
    ) => {
      if (args[0] === "remote")
        return "https://github.com/test/publishing.git\n";
      if (args[0] === "push") {
        state.pushes.push(args);
        if (state.failPush) throw new Error("Simulated push failure");
      }
      return actual.runGit(root, args, additions);
    },
  };
});
import { publishTaskPullRequest } from "./task-publishing";

const base = resolve(__dirname, "../../..");
const taskId = `task_${randomUUID().replaceAll("-", "")}`;
const root = join(base, ".nimbus/workspaces", taskId);
const remote = join(base, ".nimbus/publishing-fixtures", taskId);
const orgId = `publish_org_${taskId}`;
const userId = `publish_user_${taskId}`;
const repoId = `publish_repo_${taskId}`;
const installationId = `publish_install_${taskId}`;
let task: typeof tasks.$inferSelect;
let baseline: string;
const git = (args: string[], cwd = root) =>
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
describe.runIf(process.env.NIMBUS_PUBLISH_DATABASE_TEST === "true")(
  "publishing with PostgreSQL and real Git against an owned local remote",
  () => {
    beforeAll(async () => {
      await db()
        .insert(users)
        .values({
          id: userId,
          email: `${randomUUID()}@example.invalid`,
          name: "Publishing test",
        });
      await db()
        .insert(organizations)
        .values({ id: orgId, slug: orgId, name: "Publishing test" });
      await db().insert(githubInstallations).values({
        id: installationId,
        organizationId: orgId,
        installationId: Date.now(),
        accountLogin: "test",
      });
      await db().insert(repositories).values({
        id: repoId,
        organizationId: orgId,
        githubInstallationId: installationId,
        githubRepositoryId: 123,
        owner: "test",
        name: "publishing",
        fullName: "test/publishing",
        defaultBranch: "main",
        private: true,
      });
      const created = await db()
        .insert(tasks)
        .values({
          id: taskId,
          organizationId: orgId,
          createdByUserId: userId,
          repositoryId: repoId,
          title: "Organize source files",
          objective: "Move source",
          baseRef: "main",
          status: "completed",
        })
        .returning();
      if (!created[0]) throw new Error("Test task could not be created");
      task = created[0];
      await mkdir(root, { recursive: true });
      await mkdir(remote, { recursive: true });
      git(["init", "--bare", "-q", "-b", "main"], remote);
      git(["init", "-q", "-b", "main"]);
      git(["config", "core.autocrlf", "false"]);
      await writeFile(join(root, "README.md"), "Test repository\n");
      await writeFile(join(root, "hello.py"), "print('Hello')\n");
      git(["add", "--all"]);
      git([
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "Baseline",
      ]);
      baseline = git(["rev-parse", "HEAD"]).trim();
      git(["remote", "add", "origin", remote]);
      git(["push", "-q", "origin", "main"]);
      git(["checkout", "-qb", `nimbus/${taskId}`]);
      await mkdir(join(root, "phase 1"));
      await writeFile(join(root, "phase 1/hello.py"), "print('Hello')\n");
      await unlink(join(root, "hello.py"));
    });
    afterAll(async () => {
      await db().delete(tasks).where(eq(tasks.id, taskId));
      await db().delete(repositories).where(eq(repositories.id, repoId));
      await db()
        .delete(githubInstallations)
        .where(eq(githubInstallations.id, installationId));
      await db().delete(organizations).where(eq(organizations.id, orgId));
      await db().delete(users).where(eq(users.id, userId));
      for (const target of [root, remote]) {
        const path = relative(base, resolve(target));
        if (
          !path.startsWith(".nimbus") ||
          path.includes("..") ||
          !target.endsWith(taskId)
        )
          throw new Error("Invalid test cleanup path");
        await rm(target, { recursive: true, force: true });
      }
      await closeDatabase();
    });
    it("recovers a failed push without losing changes or creating another commit", async () => {
      state.failPush = true;
      await expect(
        publishTaskPullRequest(base, task, "Create a PR"),
      ).rejects.toThrow("push failure");
      expect(git(["rev-list", "--count", "HEAD"]).trim()).toBe("2");
      state.failPush = false;
      const result = await publishTaskPullRequest(base, task, "Create a PR");
      expect(result.number).toBe(14);
      expect(git(["rev-list", "--count", "HEAD"]).trim()).toBe("2");
      expect(git(["rev-parse", "main"], remote).trim()).toBe(baseline);
      expect(git(["status", "--porcelain"])).toBe("");
      expect(
        state.pushes.every(
          (args) =>
            args.join(" ") === `push origin HEAD:refs/heads/nimbus/${taskId}`,
        ),
      ).toBe(true);
      expect(
        state.tokenRequests.every((ids) => JSON.stringify(ids) === "[123]"),
      ).toBe(true);
    });
    it("serializes simultaneous retries and stores one PR and one delivery event", async () => {
      const results = await Promise.all([
        publishTaskPullRequest(base, task, "Create a PR"),
        publishTaskPullRequest(base, task, "Create a PR"),
      ]);
      expect(results[0]!.headSha).toBe(results[1]!.headSha);
      expect(
        await db()
          .select()
          .from(pullRequests)
          .where(eq(pullRequests.taskId, taskId)),
      ).toHaveLength(1);
      expect(
        await db()
          .select()
          .from(taskEvents)
          .where(eq(taskEvents.taskId, taskId)),
      ).toHaveLength(1);
      expect(git(["rev-list", "--count", "HEAD"]).trim()).toBe("2");
    });
    it("rejects default-branch publishing and tenant mismatches", async () => {
      git(["checkout", "-q", "main"]);
      await expect(
        publishTaskPullRequest(base, task, "Create a PR"),
      ).rejects.toThrow("isolated branch");
      git(["checkout", "-q", `nimbus/${taskId}`]);
      await expect(
        publishTaskPullRequest(
          base,
          { ...task, organizationId: "foreign" },
          "Create a PR",
        ),
      ).rejects.toThrow("not connected");
    });
    it("blocks credential files before committing or pushing", async () => {
      const head = git(["rev-parse", "HEAD"]);
      const pushes = state.pushes.length;
      await writeFile(join(root, ".env"), "SECRET=value\n");
      try {
        await expect(
          publishTaskPullRequest(base, task, "Create a PR"),
        ).rejects.toThrow("credential file");
      } finally {
        await unlink(join(root, ".env"));
      }
      expect(git(["rev-parse", "HEAD"])).toBe(head);
      expect(state.pushes.length).toBe(pushes);
    });
    it("rolls over a squash-merged PR, preserves history and retries without duplicate commits", async () => {
      const [previous] = await db()
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.taskId, taskId));
      const tree = git(["rev-parse", "HEAD^{tree}"]).trim();
      const squash = git(
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit-tree",
          tree,
          "-p",
          baseline,
          "-m",
          "Squash prior PR",
        ],
        remote,
      ).trim();
      git(["update-ref", "refs/heads/main", squash], remote);
      state.prState = "merged";
      await writeFile(join(root, "next.py"), "print('next')\n");
      state.failPush = true;
      await expect(
        publishTaskPullRequest(base, task, "Create a PR"),
      ).rejects.toThrow("push failure");
      const nextHead = git(["rev-parse", "HEAD"]).trim();
      expect(git(["branch", "--show-current"]).trim()).toBe(
        `nimbus/${taskId}-pr-2`,
      );
      expect(git(["rev-parse", "HEAD^"]).trim()).toBe(squash);
      expect(git(["diff", "--name-only", `${squash}..HEAD`]).trim()).toBe(
        "next.py",
      );
      state.failPush = false;
      const results = await Promise.all([
        publishTaskPullRequest(base, task, "Create a PR"),
        publishTaskPullRequest(base, task, "Create a PR"),
      ]);
      expect(
        results.every(
          (result) => result.number === 15 && result.headSha === nextHead,
        ),
      ).toBe(true);
      expect(git(["rev-parse", `nimbus/${taskId}`]).trim()).not.toBe(nextHead);
      const records = await db()
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.taskId, taskId));
      expect(records).toHaveLength(2);
      expect(records.find((pr) => pr.id === previous!.id)).toMatchObject({
        number: 14,
        state: "merged",
        headSha: previous!.headSha,
      });
      expect(git(["rev-parse", "main"], remote).trim()).toBe(squash);
      state.prState = "open";
    }, 30000);
    it("updates the current open PR rather than allocating another generation", async () => {
      await writeFile(join(root, "next.py"), "print('updated')\n");
      const result = await publishTaskPullRequest(base, task, "Update the PR");
      expect(result.number).toBe(15);
      expect(
        await db()
          .select()
          .from(pullRequests)
          .where(eq(pullRequests.taskId, taskId)),
      ).toHaveLength(2);
    }, 20000);
    it("creates the next PR after a close without carrying abandoned PR changes", async () => {
      state.prState = "closed";
      state.prStateTarget = 15;
      await writeFile(join(root, "third.py"), "print('third')\n");
      const result = await publishTaskPullRequest(base, task, "Create a PR");
      expect(result.number).toBe(16);
      expect(result.branch).toBe(`nimbus/${taskId}-pr-3`);
      expect(git(["diff", "--name-only", "origin/main..HEAD"]).trim()).toBe(
        "third.py",
      );
      expect(
        await db()
          .select()
          .from(pullRequests)
          .where(eq(pullRequests.taskId, taskId)),
      ).toHaveLength(3);
      state.prState = "open";
    }, 20000);
    it("keeps pending edits recoverable and does not push a conflicting rollover", async () => {
      const branch = `nimbus/${taskId}-pr-3`;
      git(["checkout", "-qb", "fixture-base-update"]);
      await writeFile(join(root, "third.py"), "print('base version')\n");
      git(["add", "."]);
      git([
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-qm",
        "Base updated",
      ]);
      git(["push", "-q", "origin", "HEAD:refs/heads/main"]);
      git(["checkout", "-q", branch]);
      await writeFile(join(root, "third.py"), "print('pending version')\n");
      state.prStateTarget = 16;
      state.prState = "merged";
      const pushes = state.pushes.length;
      await expect(
        publishTaskPullRequest(base, task, "Create a PR"),
      ).rejects.toThrow("conflict");
      expect(await readFile(join(root, "third.py"), "utf8")).toBe(
        "print('pending version')\n",
      );
      expect(git(["branch", "--show-current"]).trim()).toBe(branch);
      expect(state.pushes).toHaveLength(pushes);
      expect(
        await db()
          .select()
          .from(pullRequests)
          .where(eq(pullRequests.taskId, taskId)),
      ).toHaveLength(3);
    }, 20000);
  },
);
