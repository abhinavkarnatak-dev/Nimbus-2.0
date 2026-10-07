import { performance } from "node:perf_hooks";
import { posix } from "node:path";
import { Sandbox, CommandExitError, type CommandHandle } from "e2b";
import type {
  CommandRequest,
  CommandResult,
  ManagedProcess,
  WorkspaceHandle,
} from "./workspace-provider.js";

export const E2B_WORKSPACE_ROOT = "/workspace/repo";
export const E2B_CODEX_VERSION = "0.160.0";
// Public dependency hosts remain reachable; no host/backend secrets are injected.
// Do not add broad allowOut entries: they override the denied destinations.
export const E2B_NETWORK = {
  allowPublicTraffic: false,
  denyOut: [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
    "127.0.0.0/8",
  ],
};

export interface PublicRepository {
  owner: string;
  name: string;
  baseRef: string;
}

export function shellQuote(value: string): string {
  if (value.includes("\0"))
    throw new Error("NUL is not allowed in command arguments");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function sandboxPath(path: string): string {
  if (path.includes("\\") || path.includes("\0") || path.includes(":"))
    throw new Error("Invalid sandbox path");
  const resolved = posix.resolve(E2B_WORKSPACE_ROOT, path);
  if (
    resolved !== E2B_WORKSPACE_ROOT &&
    !resolved.startsWith(`${E2B_WORKSPACE_ROOT}/`)
  )
    throw new Error("Sandbox path escaped the repository");
  return resolved;
}

export async function verifyPublicRepository(repository: PublicRepository) {
  if (
    ![repository.owner, repository.name].every((value) =>
      /^[a-zA-Z0-9_.-]+$/.test(value),
    )
  )
    throw new Error("Invalid GitHub repository name");
  if (
    !repository.baseRef ||
    repository.baseRef.startsWith("-") ||
    /[\s~^:?*\[\\\x00-\x1f]/.test(repository.baseRef) ||
    repository.baseRef.includes("..")
  )
    throw new Error("Invalid repository branch");
  const response = await fetch(
    `https://api.github.com/repos/${repository.owner}/${repository.name}`,
    {
      headers: { accept: "application/vnd.github+json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Public GitHub repository validation failed (HTTP ${response.status}). ${response.status === 403 || response.status === 429 ? "GitHub may have rate-limited this request." : "Check repository visibility and URL."}`,
    );
  const data = (await response.json()) as {
    private?: boolean;
    full_name?: string;
    visibility?: string;
  };
  if (
    data.private !== false ||
    data.visibility !== "public" ||
    data.full_name?.toLowerCase() !==
      `${repository.owner}/${repository.name}`.toLowerCase()
  )
    throw new Error("Only public GitHub repositories are supported");
}

/** Credential belongs to this trusted supervisor, never to sandbox processes. */
export class E2BWorkspaceProvider {
  readonly kind = "e2b";
  readonly #apiKey: string;
  readonly #sandboxes = new Map<string, Sandbox>();
  readonly #processes = new Map<string, CommandHandle>();
  readonly #ownedIds = new Set<string>();

  constructor(
    apiKey = process.env.E2B_API_KEY,
    readonly verifyRepository: (
      repository: PublicRepository,
      taskId: string,
    ) => Promise<void> = verifyPublicRepository,
  ) {
    if (!apiKey?.trim())
      throw new Error(
        "E2B_API_KEY is required; local execution fallback is forbidden",
      );
    this.#apiKey = apiKey.trim();
  }

  async provision(
    taskId: string,
    organizationId: string,
    repository: PublicRepository,
  ): Promise<WorkspaceHandle> {
    if (
      !/^task_[a-zA-Z0-9_-]{1,100}$/.test(taskId) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(organizationId)
    )
      throw new Error("Invalid sandbox ownership");
    await this.verifyRepository(repository, taskId); // Never provision before authorization/publicity checks.
    const sandbox = await Sandbox.create({
      apiKey: this.#apiKey,
      timeoutMs: 30 * 60_000,
      lifecycle: { onTimeout: "pause" },
      network: E2B_NETWORK,
      metadata: {
        nimbusTaskId: taskId,
        nimbusOrganizationId: organizationId,
        repository: `${repository.owner}/${repository.name}`,
      },
    });
    this.#sandboxes.set(sandbox.sandboxId, sandbox);
    this.#ownedIds.add(sandbox.sandboxId);
    const workspace = { id: sandbox.sandboxId, root: E2B_WORKSPACE_ROOT };
    try {
      await this.checked(
        workspace,
        ["mkdir", "-p", E2B_WORKSPACE_ROOT],
        "/",
        10_000,
      );
      const url = `https://github.com/${repository.owner}/${repository.name}.git`;
      // No auth headers, tokens, submodules, hooks, or repository code on the host.
      await this.checked(
        workspace,
        [
          "git",
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "core.fsmonitor=false",
          "clone",
          "--no-checkout",
          "--",
          url,
          E2B_WORKSPACE_ROOT,
        ],
        "/",
        180_000,
      );
      await this.checked(
        workspace,
        [
          "git",
          "-c",
          "core.hooksPath=/dev/null",
          "checkout",
          "-b",
          `nimbus/${taskId}`,
          `refs/remotes/origin/${repository.baseRef}`,
          "--",
        ],
        E2B_WORKSPACE_ROOT,
        60_000,
      );
      await this.checked(
        workspace,
        ["npm", "install", "--global", `@openai/codex@${E2B_CODEX_VERSION}`],
        "/",
        180_000,
      );
      await this.checked(
        workspace,
        ["chown", "-R", "user:user", "/workspace"],
        "/",
        30_000,
      );
      return workspace;
    } catch (error) {
      await this.destroy(workspace);
      const detail =
        error instanceof CommandExitError
          ? `command exit ${error.exitCode}: ${error.stderr.slice(0, 1000)}`
          : "provider connection failure";
      throw new Error(
        `Remote sandbox initialization failed (${detail.replaceAll(this.#apiKey, "[redacted]")}); nothing was executed locally`,
      );
    }
  }

  async resume(
    id: string,
    taskId: string,
    organizationId: string,
  ): Promise<WorkspaceHandle> {
    // Read metadata before resuming: a foreign sandbox must never be started.
    const info = await Sandbox.getInfo(id, { apiKey: this.#apiKey });
    if (
      info.metadata.nimbusTaskId !== taskId ||
      info.metadata.nimbusOrganizationId !== organizationId
    )
      throw new Error("Sandbox does not belong to this session");
    const sandbox = await Sandbox.connect(id, {
      apiKey: this.#apiKey,
      timeoutMs: 30 * 60_000,
    });
    this.#sandboxes.set(id, sandbox);
    this.#ownedIds.add(id);
    return { id, root: E2B_WORKSPACE_ROOT };
  }

  handle(workspace: WorkspaceHandle): Sandbox {
    if (workspace.root !== E2B_WORKSPACE_ROOT)
      throw new Error("Invalid sandbox root");
    const sandbox = this.#sandboxes.get(workspace.id);
    if (!sandbox)
      throw new Error("Sandbox is not connected; local fallback is forbidden");
    return sandbox;
  }

  async keepAlive(workspace: WorkspaceHandle, timeoutMs = 30 * 60_000) {
    await this.handle(workspace).setTimeout(timeoutMs);
  }

  async checked(
    workspace: WorkspaceHandle,
    argv: readonly string[],
    cwd = E2B_WORKSPACE_ROOT,
    timeoutMs = 60_000,
  ) {
    return this.handle(workspace).commands.run(argv.map(shellQuote).join(" "), {
      cwd,
      timeoutMs,
      user: "root",
    });
  }

  async execute(
    workspace: WorkspaceHandle,
    request: CommandRequest,
  ): Promise<CommandResult> {
    if (!request.argv.length) throw new Error("A command is required");
    request.signal?.throwIfAborted();
    const started = performance.now();
    const sandbox = this.handle(workspace);
    const command = await sandbox.commands.run(
      request.argv.map(shellQuote).join(" "),
      {
        cwd: sandboxPath(request.cwd ?? "."),
        background: true,
        timeoutMs: request.timeoutMs,
      },
    );
    const abort = () => {
      void command.kill().catch(() => {});
    };
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) abort();
    try {
      const result = await command.wait();
      request.signal?.throwIfAborted();
      return {
        ...result,
        durationMs: Math.round(performance.now() - started),
        timedOut: false,
      };
    } catch (error) {
      request.signal?.throwIfAborted();
      if (error instanceof CommandExitError)
        return {
          exitCode: error.exitCode,
          stdout: error.stdout,
          stderr: error.stderr,
          durationMs: Math.round(performance.now() - started),
          timedOut: false,
        };
      // Transport failures/timeouts are not successful command completion.
      throw new Error(
        "Remote command connection failed or timed out; local fallback is forbidden",
      );
    } finally {
      request.signal?.removeEventListener("abort", abort);
    }
  }

  async startProcess(
    workspace: WorkspaceHandle,
    request: Omit<CommandRequest, "timeoutMs">,
    onStdout?: (data: string) => void,
    onStderr?: (data: string) => void,
  ): Promise<ManagedProcess> {
    request.signal?.throwIfAborted();
    const command = await this.handle(workspace).commands.run(
      request.argv.map(shellQuote).join(" "),
      {
        cwd: sandboxPath(request.cwd ?? "."),
        background: true,
        stdin: true,
        timeoutMs: 0,
        ...(onStdout ? { onStdout } : {}),
        ...(onStderr ? { onStderr } : {}),
      },
    );
    const id = `${workspace.id}:${command.pid}`;
    this.#processes.set(id, command);
    const abort = () => {
      void command.kill().catch(() => {});
    };
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) abort();
    // wait() drives streaming callbacks; retain no unhandled rejection.
    void command
      .wait()
      .catch(() => {})
      .finally(() => {
        this.#processes.delete(id);
        request.signal?.removeEventListener("abort", abort);
      });
    return {
      id,
      write: (data) => command.sendStdin(data),
      stop: async () => {
        await command.kill();
      },
    };
  }

  async readFile(
    workspace: WorkspaceHandle,
    path: string,
    maxBytes = 50_000_000,
  ): Promise<Uint8Array> {
    const target = sandboxPath(path);
    const check = await this.checked(
      workspace,
      [
        "python3",
        "-c",
        "import os,sys; p=sys.argv[1]; root=sys.argv[2]; assert os.path.commonpath([os.path.realpath(p),root])==root; assert os.path.isfile(p); assert os.path.getsize(p)<=int(sys.argv[3])",
        target,
        E2B_WORKSPACE_ROOT,
        String(maxBytes),
      ],
      E2B_WORKSPACE_ROOT,
      10_000,
    );
    if (check.exitCode !== 0) throw new Error("Sandbox file is unavailable");
    const data = await this.handle(workspace).files.read(target, {
      format: "bytes",
    });
    if (data.byteLength > maxBytes)
      throw new Error("Sandbox file exceeds size limit");
    return data;
  }

  async writeFile(workspace: WorkspaceHandle, path: string, data: Uint8Array) {
    if (data.byteLength > 50_000_000)
      throw new Error("Sandbox file exceeds size limit");
    const target = sandboxPath(path);
    const directory = await this.execute(workspace, {
      argv: [
        "python3",
        "-c",
        "import os,sys; p=sys.argv[1]; root=sys.argv[2]; assert os.path.commonpath([os.path.realpath(p),root])==root; os.makedirs(p,exist_ok=True)",
        posix.dirname(target),
        E2B_WORKSPACE_ROOT,
      ],
      timeoutMs: 10_000,
    });
    if (directory.exitCode !== 0)
      throw new Error("Sandbox file directory is unavailable");
    await this.handle(workspace).files.write(
      target,
      new Uint8Array(data).buffer,
    );
  }

  async pause(workspace: WorkspaceHandle) {
    await this.handle(workspace).pause();
    this.#sandboxes.delete(workspace.id);
  }

  async destroy(workspace: WorkspaceHandle) {
    if (
      workspace.root !== E2B_WORKSPACE_ROOT ||
      !this.#ownedIds.has(workspace.id)
    )
      throw new Error("Cannot destroy an unowned sandbox");
    await Sandbox.kill(workspace.id, { apiKey: this.#apiKey });
    this.#sandboxes.delete(workspace.id);
    this.#ownedIds.delete(workspace.id);
  }
}
