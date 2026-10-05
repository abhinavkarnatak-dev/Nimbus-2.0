export type CodingAgentEvent =
  | { type: "agent_message_delta"; text: string }
  | { type: "activity"; method: string; payload: unknown }
  | { type: "warning"; classification: string; message: string }
  | {
      type: "turn_completed";
      turnId: string | null;
      status: "completed" | "failed" | "interrupted" | "cancelled";
    };

export interface StartThreadInput {
  workspacePath: string;
  model: string;
}

export interface StartTurnInput {
  threadId: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface CodingAgentProvider {
  readonly kind: "codex-app-server" | "fake";
  start(): Promise<void>;
  stop(): Promise<void>;
  listModels(): Promise<readonly string[]>;
  startThread(input: StartThreadInput): Promise<string>;
  resumeThread(threadId: string): Promise<void>;
  runTurn(input: StartTurnInput): AsyncIterable<CodingAgentEvent>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
}

export function requireProductionProvider(
  provider: CodingAgentProvider,
  nodeEnv: string | undefined,
): void {
  if (nodeEnv === "production" && provider.kind === "fake") {
    throw new Error("FakeCodingAgentProvider is forbidden in production");
  }
}
