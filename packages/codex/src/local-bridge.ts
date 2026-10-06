import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NdjsonParser } from "./ndjson.js";
import type {
  CodingAgentEvent,
  CodingAgentModel,
  CodingAgentProvider,
  StartThreadInput,
  StartTurnInput,
} from "./provider.js";

export async function localBridgeKey(repositoryRoot: string): Promise<string> {
  if (process.env.NODE_ENV === "production")
    throw new Error("Local execution bridge is disabled in production");
  const directory = resolve(repositoryRoot, ".nimbus", "control");
  const file = resolve(directory, "executor-bridge.key");
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(file, randomBytes(32).toString("hex"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const key = (await readFile(/*turbopackIgnore: true*/ file, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(key))
    throw new Error("Invalid local executor credential");
  return key;
}

export function validBridgeKey(supplied: string, expected: string): boolean {
  return (
    /^[a-f0-9]{64}$/.test(supplied) &&
    supplied.length === expected.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  );
}

export class LocalConnectedCodexProvider implements CodingAgentProvider {
  readonly kind = "codex-app-server" as const;
  constructor(
    readonly taskId: string,
    readonly repositoryRoot: string,
  ) {}
  async start() {}
  async stop() {}
  async listModels(): Promise<readonly CodingAgentModel[]> {
    throw new Error(
      "Models are discovered from the user's connection, not the executor",
    );
  }
  async prepareRepository(): Promise<void> {
    await this.#request("checkout");
  }
  async startThread(_input: StartThreadInput): Promise<string> {
    const result = (await this.#request("thread/start")) as {
      threadId: string;
    };
    return result.threadId;
  }
  async resumeThread(threadId: string): Promise<void> {
    await this.#request("thread/resume", { threadId });
  }
  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.#request("turn/interrupt", { threadId, turnId });
  }
  async *runTurn(input: StartTurnInput): AsyncIterable<CodingAgentEvent> {
    const response = await this.#fetch(
      "turn/start",
      { threadId: input.threadId },
      input.signal,
    );
    if (!response.body) throw new Error("Codex execution stream is missing");
    const reader = response.body.getReader();
    const parser = new NdjsonParser();
    let terminal = false;
    try {
      while (true) {
        const chunk = await reader.read();
        const lines = chunk.done
          ? parser.finish()
          : parser.push(Buffer.from(chunk.value));
        for (const line of lines) {
          if (line.kind !== "message")
            throw new Error("Malformed Codex execution stream");
          const event = line.value as unknown as CodingAgentEvent;
          if (
            ![
              "activity",
              "warning",
              "agent_message_delta",
              "turn_completed",
            ].includes(event.type)
          )
            throw new Error("Unknown execution event");
          yield event;
          if (event.type === "turn_completed") terminal = true;
        }
        if (chunk.done) break;
      }
      if (!terminal)
        throw new Error("Codex stream ended without a terminal event");
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async #request(operation: string, fields: object = {}) {
    return (await this.#fetch(operation, fields)).json();
  }
  async #fetch(operation: string, fields: object = {}, signal?: AbortSignal) {
    const key = await localBridgeKey(this.repositoryRoot);
    const response = await fetch(
      `http://127.0.0.1:3000/api/internal/codex/${encodeURIComponent(this.taskId)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-nimbus-executor-key": key,
        },
        body: JSON.stringify({ operation, ...fields }),
        signal:
          signal ??
          AbortSignal.timeout(
            operation === "turn/start" ? 60 * 60_000 : 180_000,
          ),
      },
    );
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        result.error ?? `Local execution bridge returned ${response.status}`,
      );
    }
    return response;
  }
}
