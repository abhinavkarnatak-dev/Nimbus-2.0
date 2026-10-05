export interface CommandRequest {
  argv: readonly string[];
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ManagedProcess {
  id: string;
  write(data: string): Promise<void>;
  stop(signal?: NodeJS.Signals): Promise<void>;
}

export interface WorkspaceHandle {
  id: string;
  root: string;
}

export interface WorkspaceProvider {
  readonly kind: string;
  provision(taskId: string): Promise<WorkspaceHandle>;
  resume(workspaceId: string): Promise<WorkspaceHandle>;
  execute(
    workspace: WorkspaceHandle,
    request: CommandRequest,
  ): Promise<CommandResult>;
  startProcess(
    workspace: WorkspaceHandle,
    request: Omit<CommandRequest, "timeoutMs">,
  ): Promise<ManagedProcess>;
  streamStdout(processId: string): AsyncIterable<string>;
  streamStderr(processId: string): AsyncIterable<string>;
  readFile(workspace: WorkspaceHandle, path: string): Promise<Uint8Array>;
  writeFile(
    workspace: WorkspaceHandle,
    path: string,
    content: Uint8Array,
  ): Promise<void>;
  listFiles(
    workspace: WorkspaceHandle,
    path: string,
  ): Promise<readonly string[]>;
  inspectUsage(
    workspace: WorkspaceHandle,
  ): Promise<{ diskBytes: number; processes: number }>;
  snapshot(workspace: WorkspaceHandle): Promise<string>;
  restore(snapshotId: string): Promise<WorkspaceHandle>;
  cancel(workspace: WorkspaceHandle): Promise<void>;
  destroy(workspace: WorkspaceHandle): Promise<void>;
}
