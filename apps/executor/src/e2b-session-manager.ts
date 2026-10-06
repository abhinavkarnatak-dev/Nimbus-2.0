import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  lstat,
  readFile,
  writeFile,
  rename,
  unlink,
} from "node:fs/promises";
import { resolve, dirname, relative, sep } from "node:path";
import { db, tasks, repositories, workspaces, eq, and } from "@nimbus/database";
import { E2BWorkspaceProvider } from "./e2b-workspace-provider.js";
import { startE2BExecBridge } from "./e2b-exec-bridge.js";
import type { WorkspaceHandle } from "./workspace-provider.js";
import { SandboxNotFoundError } from "e2b";
import { IdlePauseScheduler, SANDBOX_IDLE_PAUSE_MS } from "./idle-pause.js";

export interface SavedFile {
  path: string;
  data: string;
  executable: boolean;
}
export function validateSavedFiles(value: unknown): SavedFile[] {
  if (!Array.isArray(value) || value.length > 10000)
    throw new Error("Checkpoint exceeds file limit");
  const seen = new Set<string>();
  let bytes = 0;
  for (const item of value) {
    if (
      !item ||
      typeof item.path !== "string" ||
      typeof item.data !== "string" ||
      typeof item.executable !== "boolean"
    )
      throw new Error("Invalid checkpoint");
    const parts = item.path.split("/");
    if (
      !item.path ||
      /[\\:\x00-\x1f]/.test(item.path) ||
      parts.some(
        (p: string) =>
          !p ||
          p === "." ||
          p === ".." ||
          /^\.git$/i.test(p) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p),
      )
    )
      throw new Error("Unsafe checkpoint path");
    const key = item.path.toLowerCase();
    if (seen.has(key)) throw new Error("Checkpoint path collision");
    seen.add(key);
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        item.data,
      )
    )
      throw new Error("Invalid checkpoint encoding");
    const size = Buffer.byteLength(item.data, "base64");
    bytes += size;
    if (size > 50_000_000 || bytes > 256_000_000)
      throw new Error("Checkpoint exceeds byte limit");
  }
  return value;
}

/** Only trusted Git plumbing runs on the host, never repository scripts/hooks. */
export function supervisorGit(root: string, args: string[]): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      "git",
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
          PATH: process.env.PATH,
          SYSTEMROOT: process.env.SYSTEMROOT,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    );
    let out = "";
    let error = "";
    const timer = setTimeout(() => child.kill(), 180_000);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.length > 16_000_000) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      error += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolveResult(out)
        : reject(
            new Error(
              `Trusted repository operation failed: ${error.slice(0, 500)}`,
            ),
          );
    });
  });
}

const EXPORT_SCRIPT = `import os,json,base64,stat
root='/workspace/repo'; files=[]; total=0
excluded={'.git','.nimbus','node_modules','.venv','venv','__pycache__','.next','.cache','dist','target'}
for directory,dirs,names in os.walk(root,followlinks=False):
 dirs[:]=[d for d in dirs if d not in excluded and not os.path.islink(os.path.join(directory,d))]
 for name in sorted(names):
  p=os.path.join(directory,name); rel=os.path.relpath(p,root).replace(os.sep,'/')
  if name.startswith('.env') and name!='.env.example': continue
  if name.lower().endswith(('.pem','.key','.p12','.pfx')) or name=='.nimbus-restore.bundle': continue
  s=os.lstat(p)
  if not stat.S_ISREG(s.st_mode): raise Exception('Non-regular workspace file cannot be checkpointed')
  if s.st_size>50000000: raise Exception('Checkpoint file exceeds limit')
  with open(p,'rb') as f: data=f.read(50000001)
  total+=len(data)
  if total>256000000 or len(files)>=10000: raise Exception('Checkpoint exceeds limit')
  files.append({'path':rel,'data':base64.b64encode(data).decode(),'executable':bool(s.st_mode&0o111)})
print(json.dumps(files,separators=(',',':')))
`;

export class E2BSessionManager {
  readonly provider: E2BWorkspaceProvider;
  readonly #sessions = new Map<
    string,
    {
      workspace: WorkspaceHandle;
      bridge: Awaited<ReturnType<typeof startE2BExecBridge>>;
      token: string;
      environmentId: string;
    }
  >();
  readonly #locks = new Map<string, Promise<unknown>>();
  readonly #idlePauses = new IdlePauseScheduler();
  constructor(readonly repositoryRoot: string) {
    this.provider = new E2BWorkspaceProvider();
  }
  async locked<T>(taskId: string, action: () => Promise<T>): Promise<T> {
    const prior = this.#locks.get(taskId) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(action);
    this.#locks.set(taskId, next);
    try {
      return await next;
    } finally {
      if (this.#locks.get(taskId) === next) this.#locks.delete(taskId);
    }
  }
  root(taskId: string) {
    if (!/^task_[a-f0-9]{32}$/.test(taskId)) throw new Error("Invalid task");
    return resolve(this.repositoryRoot, ".nimbus/workspaces", taskId);
  }
  checkpoint(taskId: string) {
    this.root(taskId);
    return resolve(
      this.repositoryRoot,
      ".nimbus/e2b-checkpoints",
      `${taskId}.json`,
    );
  }
  async safeTarget(root: string, path: string, directory = false) {
    const target = resolve(root, path);
    if (
      !relative(root, target) ||
      relative(root, target).startsWith(`..${sep}`) ||
      relative(root, target) === ".."
    )
      throw new Error("Checkpoint escaped task workspace");
    let current = root;
    for (const part of relative(root, directory ? target : dirname(target))
      .split(sep)
      .filter(Boolean)) {
      current = resolve(current, part);
      await mkdir(current).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "EEXIST") throw e;
      });
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error("Linked checkpoint directory rejected");
    }
    const info = await lstat(target).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
      return undefined;
    });
    if (info?.isSymbolicLink())
      throw new Error("Linked checkpoint file rejected");
    return target;
  }
  async materialize(taskId: string, files: SavedFile[]) {
    validateSavedFiles(files);
    const root = this.root(taskId);
    const prior = await supervisorGit(root, ["ls-files", "-z"]);
    const previous = await readFile(this.checkpoint(taskId), "utf8").then(
      (v) => validateSavedFiles(JSON.parse(v).files),
      () => [],
    );
    const keep = new Set(files.map((f) => f.path));
    for (const path of new Set([
      ...prior.split("\0").filter(Boolean),
      ...previous.map((f) => f.path),
    ])) {
      // Apply only explicitly bounded task file deletions; never recursively delete directories.
      if (!keep.has(path)) {
        validateSavedFiles([{ path, data: "", executable: false }]);
        await unlink(await this.safeTarget(root, path)).catch(
          (e: NodeJS.ErrnoException) => {
            if (e.code !== "ENOENT") throw e;
          },
        );
      }
    }
    for (const file of files)
      await writeFile(
        await this.safeTarget(root, file.path),
        Buffer.from(file.data, "base64"),
        { mode: file.executable ? 0o755 : 0o644 },
      );
  }
  async ensure(taskId: string) {
    this.cancelIdle(taskId);
    return this.locked(taskId, async () => {
      const [task] = await db()
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId));
      if (!task || !["provisioning", "running"].includes(task.status))
        throw new Error("Session is not claimed");
      if (!task.repositoryId)
        throw new Error("General chat cannot provision a sandbox");
      const [repo] = await db()
        .select()
        .from(repositories)
        .where(
          and(
            eq(repositories.id, task.repositoryId),
            eq(repositories.organizationId, task.organizationId),
          ),
        );
      if (!repo || repo.archived || !repo.githubInstallationId)
        throw new Error("Repository is unavailable");
      const root = this.root(taskId);
      await mkdir(root, { recursive: true });
      if ((await lstat(root)).isSymbolicLink())
        throw new Error("Linked workspace rejected");
      const exists = await lstat(resolve(root, ".git")).then(
        (info) => {
          if (!info.isDirectory() || info.isSymbolicLink())
            throw new Error("Unsafe trusted Git directory");
          return true;
        },
        () => false,
      );
      const url = `https://github.com/${repo.owner}/${repo.name}.git`;
      if (!exists) {
        // Public clone only. No dependency installation or repository execution on this machine.
        const { verifyPublicRepository } = await import(
          "./e2b-workspace-provider.js"
        );
        await verifyPublicRepository({
          owner: repo.owner,
          name: repo.name,
          baseRef: task.baseRef,
        });
        await supervisorGit(root, ["clone", "--no-checkout", "--", url, "."]);
        await supervisorGit(root, [
          "checkout",
          "-b",
          `nimbus/${taskId}`,
          `refs/remotes/origin/${task.baseRef}`,
          "--",
        ]);
      } else if (
        (await supervisorGit(root, ["remote", "get-url", "origin"])).trim() !==
        url
      )
        throw new Error("Assigned repository mismatch");
      const [record] = await db()
        .select()
        .from(workspaces)
        .where(eq(workspaces.taskId, taskId));
      let workspace: WorkspaceHandle | undefined;
      let restored = false;
      const old = this.#sessions.get(taskId);
      if (old) {
        await this.provider.keepAlive(old.workspace);
        return { ...old, url: old.bridge.url, restored: false };
      }
      if (record?.provider === "e2b") {
        try {
          workspace = await this.provider.resume(
            record.providerWorkspaceId,
            taskId,
            task.organizationId,
          );
        } catch (error) {
          // Never treat permission/ownership/transport failures as expiry.
          const code =
            (error as { status?: number; statusCode?: number }).status ??
            (error as { statusCode?: number }).statusCode;
          if (code !== 404 && !(error instanceof SandboxNotFoundError))
            throw error;
          restored = true;
        }
      }
      if (!workspace) {
        workspace = await this.provider.provision(taskId, task.organizationId, {
          owner: repo.owner,
          name: repo.name,
          baseRef: task.baseRef,
        });
        const saved = await readFile(this.checkpoint(taskId), "utf8").then(
          (v) => validateSavedFiles(JSON.parse(v).files),
          () => undefined,
        );
        if (restored && !saved) {
          await this.provider.destroy(workspace);
          throw new Error(
            "Sandbox expired without a durable checkpoint; refusing to lose changes",
          );
        }
        if (saved) await this.materialize(taskId, saved);
        await this.importMirror(taskId, workspace);
      }
      const token = randomBytes(32).toString("hex");
      // New environment identity per VM incarnation prevents stale transport reuse.
      const environmentId = `nimbus_${taskId}_${workspace.id}_${randomUUID().replaceAll("-", "")}`;
      const bridge = await startE2BExecBridge(this.provider, workspace, token);
      this.#sessions.set(taskId, { workspace, bridge, token, environmentId });
      const values = {
        provider: "e2b",
        providerWorkspaceId: workspace.id,
        status: "ready",
        lastHeartbeatAt: new Date().toISOString(),
      };
      if (record)
        await db()
          .update(workspaces)
          .set(values)
          .where(eq(workspaces.id, record.id));
      else
        await db()
          .insert(workspaces)
          .values({
            id: `ws_${randomUUID().replaceAll("-", "")}`,
            taskId,
            ...values,
            resourceLimits: { maxSeconds: 1800 },
          });
      await db()
        .update(tasks)
        .set({
          branchName: (
            await supervisorGit(root, ["branch", "--show-current"])
          ).trim(),
        })
        .where(eq(tasks.id, taskId));
      return {
        workspace,
        bridge,
        token,
        environmentId,
        url: bridge.url,
        restored,
      };
    });
  }
  async importMirror(taskId: string, workspace: WorkspaceHandle) {
    const root = this.root(taskId);
    const sha = (await supervisorGit(root, ["rev-parse", "HEAD"])).trim();
    const branch = (
      await supervisorGit(root, ["branch", "--show-current"])
    ).trim();
    if (!/^[a-f0-9]{40}$/.test(sha) || !branch.startsWith(`nimbus/${taskId}`))
      throw new Error("Invalid saved repository identity");
    const bundle = resolve(
      this.repositoryRoot,
      ".nimbus/e2b-checkpoints",
      `${taskId}.bundle`,
    );
    await mkdir(dirname(bundle), { recursive: true });
    await unlink(bundle).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
    await supervisorGit(root, ["bundle", "create", bundle, "--all"]);
    await this.provider.writeFile(
      workspace,
      ".nimbus-restore.bundle",
      await readFile(bundle),
    );
    const run = async (argv: string[]) => {
      const result = await this.provider.execute(workspace, {
        argv,
        timeoutMs: 60_000,
      });
      if (result.exitCode !== 0)
        throw new Error("Remote repository restore failed");
    };
    await run([
      "git",
      "-c",
      "core.hooksPath=/dev/null",
      "fetch",
      ".nimbus-restore.bundle",
      "+refs/heads/*:refs/remotes/nimbus-restore/*",
    ]);
    await run([
      "git",
      "-c",
      "core.hooksPath=/dev/null",
      "reset",
      "--hard",
      sha,
    ]);
    await run([
      "git",
      "-c",
      "core.hooksPath=/dev/null",
      "checkout",
      "-B",
      branch,
      sha,
      "--",
    ]);
    const paths = (
      await supervisorGit(root, [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ])
    )
      .split("\0")
      .filter(Boolean);
    const files: SavedFile[] = [];
    for (const path of paths) {
      validateSavedFiles([{ path, data: "", executable: false }]);
      const target = await this.safeTarget(root, path);
      const info = await lstat(target).catch(() => undefined);
      if (!info) {
        await run([
          "python3",
          "-c",
          "import os,sys; os.unlink(sys.argv[1])",
          path,
        ]);
        continue;
      }
      if (!info.isFile())
        throw new Error("Saved repository contains a non-regular file");
      files.push({
        path,
        data: (await readFile(target)).toString("base64"),
        executable: Boolean(info.mode & 0o111),
      });
    }
    validateSavedFiles(files);
    for (const file of files)
      await this.provider.writeFile(
        workspace,
        file.path,
        Buffer.from(file.data, "base64"),
      );
    await run(["rm", "-f", ".nimbus-restore.bundle"]);
  }
  async sync(taskId: string) {
    return this.locked(taskId, () => this.syncLocked(taskId));
  }
  private async syncLocked(taskId: string) {
    const session = this.#sessions.get(taskId);
    if (!session) return; // Idle panels read the durable mirror; do not wake billable VMs.
    const result = await this.provider.execute(session.workspace, {
      argv: ["python3", "-c", EXPORT_SCRIPT],
      timeoutMs: 60_000,
    });
    if (result.exitCode !== 0)
      throw new Error(
        "Workspace checkpoint failed; sandbox is retained for recovery",
      );
    const files = validateSavedFiles(JSON.parse(result.stdout));
    await this.materialize(taskId, files);
    const checkpoint = this.checkpoint(taskId);
    await mkdir(dirname(checkpoint), { recursive: true });
    const temporary = `${checkpoint}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({
        version: 1,
        taskId,
        files,
        savedAt: new Date().toISOString(),
      }),
      { flag: "wx", mode: 0o600 },
    );
    await rename(temporary, checkpoint);
    await db()
      .update(workspaces)
      .set({ lastHeartbeatAt: new Date().toISOString() })
      .where(eq(workspaces.taskId, taskId));
  }
  async published(taskId: string) {
    return this.locked(taskId, async () => {
      const session = this.#sessions.get(taskId);
      if (!session) throw new Error("Remote workspace disconnected");
      await this.importMirror(taskId, session.workspace);
    });
  }
  async idle(taskId: string) {
    this.cancelIdle(taskId);
    await this.sync(taskId);
    return this.locked(taskId, async () => {
      await this.pauseLocked(taskId);
    });
  }
  cancelIdle(taskId: string) {
    this.#idlePauses.cancel(taskId);
  }
  beginRequest(taskId: string, messageId: string) {
    const session = this.#sessions.get(taskId);
    if (!session) throw new Error("Request execution session is unavailable");
    session.bridge.beginRequest(messageId);
  }
  async stopRequest(taskId: string, messageId: string) {
    const session = this.#sessions.get(taskId);
    if (session) await session.bridge.stopRequest(messageId);
  }
  async scheduleIdle(taskId: string, onPaused: () => Promise<unknown>) {
    await this.locked(taskId, async () => {
      const session = this.#sessions.get(taskId);
      if (session)
        await this.provider.keepAlive(
          session.workspace,
          SANDBOX_IDLE_PAUSE_MS + 60_000,
        );
    }).catch(() =>
      console.warn(
        "Could not extend the sandbox idle window; scheduling pause without changing the completed response",
      ),
    );
    this.#idlePauses.schedule(taskId, async (isCurrent) => {
      const paused = await this.locked(taskId, async () =>
        db().transaction(async (tx) => {
          // Share the task row lock with follow-up enqueue and executor claim.
          // A queued/running follow-up must win over an expired idle deadline.
          const [task] = await tx
            .select({ status: tasks.status })
            .from(tasks)
            .where(eq(tasks.id, taskId))
            .for("update");
          if (
            !isCurrent() ||
            !task ||
            !["completed", "pr_open", "cancelled"].includes(task.status)
          )
            return false;
          await this.syncLocked(taskId);
          return this.pauseLocked(taskId, tx);
        }),
      );
      if (paused) await onPaused();
    });
  }
  private async pauseLocked(
    taskId: string,
    database: Pick<ReturnType<typeof db>, "update"> = db(),
  ) {
    const session = this.#sessions.get(taskId);
    if (!session) return false;
    await session.bridge.close();
    this.#sessions.delete(taskId);
    await this.provider.pause(session.workspace);
    await database
      .update(workspaces)
      .set({ status: "paused" })
      .where(eq(workspaces.taskId, taskId));
    return true;
  }
  async close() {
    this.#idlePauses.clear();
    for (const taskId of this.#sessions.keys()) await this.idle(taskId);
  }
}
