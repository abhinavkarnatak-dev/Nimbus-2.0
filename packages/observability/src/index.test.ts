import { describe, expect, it } from "vitest";

import {
  buildAiGenerationEvent,
  buildAiSpanEvent,
  createObservabilityId,
  createObservability,
  validateSafeMetadata,
} from "./index.js";

describe("PostHog privacy boundary", () => {
  it("allows only aggregate operational metadata", () => {
    expect(
      validateSafeMetadata({
        category: "task",
        status: "completed",
        durationMs: 40,
      }),
    ).toEqual({ category: "task", status: "completed", durationMs: 40 });
  });

  it("rejects source code and prompt-shaped properties", () => {
    expect(() => validateSafeMetadata({ prompt: "private" })).toThrow();
    expect(() => validateSafeMetadata({ sourceCode: "secret" })).toThrow();
  });

  it("uses a safe no-op when PostHog is not configured", async () => {
    const telemetry = createObservability({});
    expect(() =>
      telemetry.capture("tenant_hash", "task_completed", {
        status: "completed",
      }),
    ).not.toThrow();
    expect(() =>
      telemetry.captureAiGeneration({
        distinctId: "user_1",
        traceId: "message_1",
        spanId: "turn_1",
        sessionId: "task_1",
        model: "gpt-test",
        provider: "test",
        durationMs: 25,
        status: "completed",
        input: "Hello",
        output: "Hi",
      }),
    ).not.toThrow();
    await telemetry.shutdown();
  });

  it("builds complete PostHog AI generation events", () => {
    expect(
      buildAiGenerationEvent({
        distinctId: "user_1",
        traceId: "message_1",
        spanId: "turn_1",
        sessionId: "task_1",
        model: "gpt-test",
        provider: "codex-app-server",
        durationMs: 1_250,
        status: "completed",
        reasoningEffort: "medium",
        input: "Hello Nimbus",
        output: "Hello there",
      }),
    ).toEqual({
      distinctId: "user_1",
      event: "$ai_generation",
      properties: {
        $ai_trace_id: "message_1",
        $ai_span_id: "turn_1",
        $ai_session_id: "task_1",
        $ai_model: "gpt-test",
        $ai_provider: "codex-app-server",
        $ai_latency: 1.25,
        $ai_is_error: false,
        $ai_span_name: "nimbus.agent.generation",
        $ai_input: [
          {
            role: "user",
            content: [{ type: "text", text: "Hello Nimbus" }],
          },
        ],
        $ai_output_choices: [
          {
            role: "assistant",
            content: [{ type: "text", text: "Hello there" }],
          },
        ],
        $ai_privacy_mode: false,
        status: "completed",
        reasoning_effort: "medium",
      },
    });
  });

  it("rejects prompt or response content in AI generation input", () => {
    const base = {
      distinctId: "user_1",
      traceId: "message_1",
      spanId: "turn_1",
      sessionId: "task_1",
      model: "gpt-test",
      provider: "test",
      durationMs: 25,
      status: "completed",
      input: "Hello",
      output: "Hi",
    } as const;
    expect(() =>
      buildAiGenerationEvent({ ...base, prompt: "private prompt" }),
    ).toThrow();
    expect(() =>
      buildAiGenerationEvent({ ...base, response: "private response" }),
    ).toThrow();
  });

  it("creates stable opaque trace identifiers", () => {
    const first = createObservabilityId("session", "task_private_123");
    expect(first).toBe(createObservabilityId("session", "task_private_123"));
    expect(first).toMatch(/^session_[a-f0-9]{32}$/);
    expect(first).not.toContain("task_private_123");
  });

  it("builds tool spans for AI trace trees", () => {
    expect(
      buildAiSpanEvent({
        distinctId: "user_1",
        traceId: "trace_1",
        spanId: "tool_1",
        parentId: "generation_1",
        sessionId: "session_1",
        name: "command_execution",
        input: "pnpm test",
        output: "passed",
        durationMs: 750,
        isError: false,
      }),
    ).toMatchObject({
      event: "$ai_span",
      properties: {
        $ai_trace_id: "trace_1",
        $ai_span_name: "command_execution",
        $ai_latency: 0.75,
        $ai_is_error: false,
      },
    });
  });
});
