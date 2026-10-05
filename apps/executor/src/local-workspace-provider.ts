import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { performance } from "node:perf_hooks";

import type {
  CommandRequest,
  CommandResult,
  ManagedProcess,
  WorkspaceHandle,
  WorkspaceProvider,
} from "./workspace-provider.js";

export class LocalWorkspaceProvider implements WorkspaceProvider {
  readonly kind = "local-test";
  readonly #root: string;

  constructor(repositoryRoot: string) {
    if (process.env.NODE_ENV === "production")
      throw new Error("LocalWorkspaceProvider is forbidden in production");
    this.#root = resolve(repositoryRoot, ".nimbus", "workspaces");
  }

  async provision(taskId: string): Promise<WorkspaceHandle> {
    const root = this.#inside(this.#root, taskId);
    await mkdir(root, { recursive: true });
    return { id: `local-${taskId}`, root };
  }

  async resume(workspaceId: string): Promise<WorkspaceHandle> {
    const taskId = workspaceId.replace(/^local-/, "");
    const root = this.#inside(this.#root, taskId);
    await stat(root);
    return { id: workspaceId, root };
  }

  async execute(
    workspace: WorkspaceHandle,
    request: CommandRequest,
  ): Promise<CommandResult> {
    const started = performance.now();
    const cwd = this.#inside(workspace.root, request.cwd ?? ".");
    return await new Promise((resolveResult, reject) => {
      const child = spawn(request.argv[0] ?? "", request.argv.slice(1), {
        cwd,
        windowsHide: true,
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const cap = (value: string) => value.slice(0, 1_000_000);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout = cap(stdout + chunk);
      });
      child.stderr.on("data", (chunk: string) => {
        stderr = cap(stderr + chunk);
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, request.timeoutMs);
      request.signal?.addEventListener("abort", () => child.kill("SIGTERM"), {
        once: true,
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolveResult({
          exitCode: code,
          stdout,
          stderr,
          durationMs: Math.round(performance.now() - started),
          timedOut,
        });
      });
    });
  }

  async startProcess(): Promise<ManagedProcess> {
    throw new Error(
      "Managed processes are not enabled in the local test provider",
    );
  }
  async *streamStdout(): AsyncIterable<string> {
    return;
  }
  async *streamStderr(): AsyncIterable<string> {
    return;
  }
  async readFile(
    workspace: WorkspaceHandle,
    path: string,
  ): Promise<Uint8Array> {
    return readFile(this.#inside(workspace.root, path));
  }
  async writeFile(
    workspace: WorkspaceHandle,
    path: string,
    content: Uint8Array,
  ): Promise<void> {
    const target = this.#inside(workspace.root, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, content, { flag: "wx" });
  }
  async listFiles(
    workspace: WorkspaceHandle,
    path: string,
  ): Promise<readonly string[]> {
    return readdir(this.#inside(workspace.root, path));
  }
  async inspectUsage(
    workspace: WorkspaceHandle,
  ): Promise<{ diskBytes: number; processes: number }> {
    const info = await stat(workspace.root);
    return { diskBytes: info.size, processes: 0 };
  }
  async snapshot(workspace: WorkspaceHandle): Promise<string> {
    return `local-snapshot-${workspace.id}`;
  }
  async restore(snapshotId: string): Promise<WorkspaceHandle> {
    return this.resume(snapshotId.replace(/^local-snapshot-/, ""));
  }
  async cancel(): Promise<void> {}
  async destroy(): Promise<void> {
    throw new Error(
      "Local workspace destruction requires the explicit cleanup command",
    );
  }

  #inside(root: string, requested: string): string {
    const target = resolve(root, requested);
    const diff = relative(root, target);
    if (
      diff === "" ||
      (!diff.startsWith(`..${sep}`) &&
        diff !== ".." &&
        !resolve(diff).startsWith(sep))
    )
      return target;
    throw new Error("Workspace path escaped its assigned root");
  }
}
