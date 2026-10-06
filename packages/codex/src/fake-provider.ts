import type {
  CodingAgentEvent,
  CodingAgentProvider,
  StartThreadInput,
  StartTurnInput,
} from "./provider.js";

export class FakeCodingAgentProvider implements CodingAgentProvider {
  readonly kind = "fake" as const;
  #started = false;
  #thread = 0;

  async start(): Promise<void> {
    this.#started = true;
  }

  async stop(): Promise<void> {
    this.#started = false;
  }

  async listModels() {
    this.#assertStarted();
    return [
      {
        id: "fake-codex-test-provider",
        displayName: "Local test model",
        description: "Deterministic simulation for local verification",
        isDefault: true,
      },
    ];
  }

  async startThread(_input: StartThreadInput): Promise<string> {
    this.#assertStarted();
    this.#thread += 1;
    return `fake_thread_${String(this.#thread)}`;
  }

  async resumeThread(_threadId: string): Promise<void> {
    this.#assertStarted();
  }

  async *runTurn(input: StartTurnInput): AsyncIterable<CodingAgentEvent> {
    this.#assertStarted();
    if (input.signal?.aborted) {
      yield { type: "turn_completed", turnId: null, status: "cancelled" };
      return;
    }
    yield {
      type: "activity",
      method: "repository/inspection",
      payload: { threadId: input.threadId },
    };
    yield {
      type: "agent_message_delta",
      text: "Local simulation received this message. No repository edits or verification commands were executed.",
    };
    yield {
      type: "activity",
      method: "verification/completed",
      payload: { exitCode: 0 },
    };
    yield {
      type: "turn_completed",
      turnId: "fake_turn_1",
      status: "completed",
    };
  }

  async interruptTurn(_threadId: string, _turnId: string): Promise<void> {
    this.#assertStarted();
  }

  #assertStarted(): void {
    if (!this.#started)
      throw new Error("FakeCodingAgentProvider has not been started");
  }
}
