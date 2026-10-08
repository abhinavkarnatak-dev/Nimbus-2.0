export type CodingAgentEvent =
  | { type: "agent_message_delta"; text: string; itemId?: string }
  | { type: "activity"; method: string; payload: unknown }
  | { type: "warning"; classification: string; message: string }
  | {
      type: "turn_completed";
      turnId: string | null;
      status: "completed" | "failed" | "interrupted" | "cancelled";
      error?: string;
      errorClassification?: string;
    };

export interface StartThreadInput {
  workspacePath: string;
  model: string;
  environmentId?: string;
}

export interface StartTurnInput {
  threadId: string;
  model?: string;
  workspacePath?: string;
  environmentId?: string;
  prompt: string;
  reasoningEffort?: string;
  signal?: AbortSignal;
  onToolCall?: (tool: string, args: unknown) => Promise<unknown>;
  // Read-only saved guidance; kept separate from execution/publishing tools.
  onSkillCall?: (args: unknown) => Promise<unknown>;
  // General chat repository reads and deferred work handoff only. No execution.
  onRepositoryCall?: (tool: string, args: unknown) => Promise<unknown>;
}

export interface CodingAgentModel {
  id: string;
  displayName?: string;
  description?: string;
  isDefault?: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{
    reasoningEffort: string;
    description: string;
  }>;
}

export interface CodingAgentProvider {
  readonly kind: "codex-app-server" | "fake";
  start(): Promise<void>;
  stop(): Promise<void>;
  listModels(): Promise<readonly CodingAgentModel[]>;
  startThread(input: StartThreadInput): Promise<string>;
  // A provider can safely replace an unavailable thread before starting a turn.
  resumeThread(threadId: string): Promise<void | string>;
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
