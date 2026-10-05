import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";

import { NdjsonParser, type ParsedLine } from "./ndjson.js";
import type {
  CodingAgentEvent,
  CodingAgentProvider,
  StartThreadInput,
  StartTurnInput,
} from "./provider.js";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface QueuedEvent {
  value: CodingAgentEvent;
}

const TERMINAL = new Set(["completed", "failed", "interrupted", "cancelled"]);

export interface CodexAppServerOptions {
  accessToken: string;
  codexExecutable?: string;
  requestTimeoutMs?: number;
  clientVersion?: string;
  onStderr?: (message: string) => void;
}

export class CodexAppServerProvider implements CodingAgentProvider {
  readonly kind = "codex-app-server" as const;
  readonly #options: CodexAppServerOptions;
  #process: ChildProcessWithoutNullStreams | undefined;
  #nextId = 1;
  #pending = new Map<number, PendingRequest>();
  #events: QueuedEvent[] = [];
  #eventWaiters: Array<() => void> = [];
  #fatal: Error | undefined;

  constructor(options: CodexAppServerOptions) {
    if (!options.accessToken)
      throw new Error("A short-lived ChatGPT OAuth access token is required");
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#process) return;
    const childEnvironment = { ...process.env };
    delete childEnvironment.NIMBUS_CODEX_ACCESS_TOKEN;
    delete childEnvironment.OPENAI_API_KEY;
    const args = [
      "app-server",
      "--listen",
      "stdio://",
      "-c",
      'model_provider="openai_chatgpt_plan"',
      "-c",
      'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
      "-c",
      'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
      "-c",
      'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
      "-c",
      'model_providers.openai_chatgpt_plan.wire_api="responses"',
      "-c",
      "model_providers.openai_chatgpt_plan.requires_openai_auth=false",
      "-c",
      "model_providers.openai_chatgpt_plan.supports_websockets=false",
    ];
    this.#process = spawn(this.#options.codexExecutable ?? "codex", args, {
      env: { ...childEnvironment, ACCESS_TOKEN: this.#options.accessToken },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#wireProcess(this.#process);
    await this.#request("initialize", {
      clientInfo: {
        name: "nimbus",
        title: "Nimbus",
        version: this.#options.clientVersion ?? "0.1.0",
      },
    });
    this.#notify("initialized", {});
  }

  async stop(): Promise<void> {
    const child = this.#process;
    if (!child) return;
    this.#process = undefined;
    if (!child.killed) child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (!child.killed) child.kill("SIGKILL");
  }

  async listModels(): Promise<readonly string[]> {
    const result = await this.#request("model/list", {});
    const data = asRecord(result).data;
    if (!Array.isArray(data)) return [];
    return data.flatMap((entry) => {
      const model = asRecord(entry);
      const id = model.id ?? model.model;
      return typeof id === "string" ? [id] : [];
    });
  }

  async startThread(input: StartThreadInput): Promise<string> {
    const result = asRecord(
      await this.#request("thread/start", {
        cwd: input.workspacePath,
        model: input.model,
        approvalPolicy: "never",
        sandbox: "workspace-write",
      }),
    );
    const thread = asRecord(result.thread);
    if (typeof thread.id !== "string")
      throw new Error("Codex thread/start response omitted thread.id");
    return thread.id;
  }

  async resumeThread(threadId: string): Promise<void> {
    await this.#request("thread/resume", { threadId });
  }

  async *runTurn(input: StartTurnInput): AsyncIterable<CodingAgentEvent> {
    this.#events = [];
    const result = asRecord(
      await this.#request("turn/start", {
        threadId: input.threadId,
        input: [{ type: "text", text: input.prompt }],
      }),
    );
    const turn = asRecord(result.turn);
    const startedTurnId = typeof turn.id === "string" ? turn.id : null;
    const abort = () => {
      if (startedTurnId) void this.interruptTurn(input.threadId, startedTurnId);
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        if (this.#fatal) throw this.#fatal;
        const next = this.#events.shift();
        if (!next) {
          await new Promise<void>((resolve) =>
            this.#eventWaiters.push(resolve),
          );
          continue;
        }
        yield next.value;
        if (next.value.type === "turn_completed") return;
      }
    } finally {
      input.signal?.removeEventListener("abort", abort);
    }
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.#request("turn/interrupt", { threadId, turnId });
  }

  #wireProcess(child: ChildProcessWithoutNullStreams): void {
    const parser = new NdjsonParser();
    child.stdout.on("data", (chunk: Buffer) => {
      for (const line of parser.push(chunk)) this.#handleLine(line);
    });
    child.stdout.on("end", () => {
      for (const line of parser.finish()) this.#handleLine(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) =>
      this.#options.onStderr?.(redact(chunk)),
    );
    child.on("error", (error) =>
      this.#fail(new Error(`Codex app-server process error: ${error.message}`)),
    );
    child.on("exit", (code, signal) => {
      if (this.#process === child) {
        this.#fail(
          new Error(
            `Codex app-server exited unexpectedly with code ${String(code)} and signal ${String(signal)}`,
          ),
        );
      }
    });
  }

  #handleLine(line: ParsedLine): void {
    if (line.kind === "invalid") {
      this.#pushEvent({
        type: "warning",
        classification: "malformed_output",
        message: line.error,
      });
      return;
    }
    const id = line.value.id;
    if (
      typeof id === "number" &&
      ("result" in line.value || "error" in line.value)
    ) {
      const pending = this.#pending.get(id);
      if (!pending) return;
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      if ("error" in line.value)
        pending.reject(
          new Error(`Codex request failed: ${safeSummary(line.value.error)}`),
        );
      else pending.resolve(line.value.result);
      return;
    }
    const method =
      typeof line.value.method === "string" ? line.value.method : "unknown";
    const params = asRecord(line.value.params);
    if (method === "item/agentMessage/delta") {
      const delta = params.delta;
      if (typeof delta === "string")
        this.#pushEvent({ type: "agent_message_delta", text: delta });
      return;
    }
    if (method === "turn/completed") {
      const turn = asRecord(params.turn);
      const rawStatus = turn.status;
      const status =
        typeof rawStatus === "string" && TERMINAL.has(rawStatus)
          ? (rawStatus as "completed" | "failed" | "interrupted" | "cancelled")
          : "failed";
      this.#pushEvent({
        type: "turn_completed",
        turnId: typeof turn.id === "string" ? turn.id : null,
        status,
      });
      return;
    }
    this.#pushEvent({ type: "activity", method, payload: params });
  }

  #request(method: string, params: unknown): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, this.#options.requestTimeoutMs ?? 30_000);
      this.#pending.set(id, { resolve, reject, timer });
      this.#write({ jsonrpc: "2.0", id, method, params });
    });
  }

  #notify(method: string, params: unknown): void {
    this.#write({ jsonrpc: "2.0", method, params });
  }

  #write(message: unknown): void {
    if (!this.#process || this.#process.stdin.destroyed)
      throw new Error("Codex app-server is not running");
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #pushEvent(value: CodingAgentEvent): void {
    this.#events.push({ value });
    this.#eventWaiters.shift()?.();
  }

  #fail(error: Error): void {
    this.#fatal = error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const wake of this.#eventWaiters.splice(0)) wake();
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeSummary(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "string" && item.length > 500
      ? `${item.slice(0, 500)}...`
      : item,
  ).slice(0, 2_000);
}

function redact(value: string): string {
  return value.replace(
    /(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9._-]{12,}/gi,
    "[REDACTED]",
  );
}
