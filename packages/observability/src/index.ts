import { createHash } from "node:crypto";

import { SeverityNumber, type Logger } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { PostHog } from "posthog-node";
import { z } from "zod";

const SafeMetadataSchema = z
  .object({
    category: z.string().max(80).optional(),
    status: z.string().max(80).optional(),
    durationMs: z.number().nonnegative().optional(),
    count: z.number().int().nonnegative().optional(),
    errorClass: z.string().max(120).optional(),
    integration: z.string().max(80).optional(),
    provider: z.string().max(80).optional(),
    taskState: z.string().max(80).optional(),
  })
  .strict();

export type SafeMetadata = z.infer<typeof SafeMetadataSchema>;

export type ObservabilityOutcome =
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled";

const AiGenerationSchema = z
  .object({
    distinctId: z.string().min(1).max(200),
    traceId: z.string().min(1).max(200),
    spanId: z.string().min(1).max(200),
    sessionId: z.string().min(1).max(200),
    model: z.string().min(1).max(120),
    provider: z.string().min(1).max(80),
    durationMs: z.number().nonnegative(),
    status: z.enum(["completed", "failed", "interrupted", "cancelled"]),
    reasoningEffort: z.string().max(80).optional(),
    errorClass: z.string().max(120).optional(),
    input: z.string().max(100_000),
    output: z.string().max(100_000),
  })
  .strict();

export type AiGeneration = z.infer<typeof AiGenerationSchema>;

const AiSpanSchema = z
  .object({
    distinctId: z.string().min(1).max(200),
    traceId: z.string().min(1).max(200),
    spanId: z.string().min(1).max(200),
    parentId: z.string().min(1).max(200),
    sessionId: z.string().min(1).max(200),
    name: z.string().min(1).max(120),
    input: z.string().max(100_000),
    output: z.string().max(100_000),
    durationMs: z.number().nonnegative(),
    isError: z.boolean(),
  })
  .strict();

export type AiSpan = z.infer<typeof AiSpanSchema>;

export function buildAiSpanEvent(span: unknown) {
  const value = AiSpanSchema.parse(span);
  return {
    distinctId: value.distinctId,
    event: "$ai_span" as const,
    properties: {
      $ai_trace_id: value.traceId,
      $ai_span_id: value.spanId,
      $ai_parent_id: value.parentId,
      $ai_session_id: value.sessionId,
      $ai_span_name: value.name,
      $ai_input_state: value.input,
      $ai_output_state: value.output,
      $ai_latency: value.durationMs / 1_000,
      $ai_is_error: value.isError,
    },
  };
}

export function createObservabilityId(namespace: string, value: string) {
  const digest = createHash("sha256")
    .update(`${namespace}:${value}`)
    .digest("hex")
    .slice(0, 32);
  return `${namespace}_${digest}`;
}

export function buildAiGenerationEvent(generation: unknown) {
  const value = AiGenerationSchema.parse(generation);
  return {
    distinctId: value.distinctId,
    event: "$ai_generation" as const,
    properties: {
      $ai_trace_id: value.traceId,
      $ai_span_id: value.spanId,
      $ai_session_id: value.sessionId,
      $ai_model: value.model,
      $ai_provider: value.provider,
      $ai_latency: value.durationMs / 1_000,
      $ai_is_error: value.status === "failed",
      $ai_span_name: "nimbus.agent.generation",
      $ai_input: [
        {
          role: "user",
          content: [{ type: "text", text: value.input }],
        },
      ],
      $ai_output_choices: [
        {
          role: "assistant",
          content: [{ type: "text", text: value.output }],
        },
      ],
      $ai_privacy_mode: false,
      status: value.status,
      ...(value.reasoningEffort
        ? { reasoning_effort: value.reasoningEffort }
        : {}),
      ...(value.errorClass ? { error_class: value.errorClass } : {}),
    },
  };
}

export interface NimbusObservability {
  capture(distinctId: string, event: string, metadata?: SafeMetadata): void;
  captureAiGeneration(generation: AiGeneration): void;
  captureAiSpan(span: AiSpan): void;
  captureException(
    error: unknown,
    distinctId?: string,
    metadata?: SafeMetadata,
  ): void;
  log(
    severity: "info" | "warn" | "error",
    message: string,
    metadata?: SafeMetadata,
  ): void;
  startSpan(
    name: string,
    context: {
      distinctId?: string;
      sessionId?: string;
      metadata?: SafeMetadata;
    },
  ): NimbusSpan;
  recordAgentRun(outcome: ObservabilityOutcome, durationMs: number): void;
  shutdown(): Promise<void>;
}

export interface NimbusSpan {
  readonly traceId?: string;
  readonly spanId?: string;
  finish(outcome: ObservabilityOutcome, error?: unknown): void;
}

const noopSpan: NimbusSpan = {
  finish: () => undefined,
};

function traceIdentifiers(traceparent: string | null) {
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$/i.exec(
    traceparent ?? "",
  );
  return match ? { traceId: match[1]!, spanId: match[2]! } : {};
}

function logSeverity(severity: "info" | "warn" | "error") {
  if (severity === "error") return SeverityNumber.ERROR;
  if (severity === "warn") return SeverityNumber.WARN;
  return SeverityNumber.INFO;
}

export function validateSafeMetadata(metadata: unknown): SafeMetadata {
  return SafeMetadataSchema.parse(metadata ?? {});
}

export function createObservability(
  environment: NodeJS.ProcessEnv = process.env,
): NimbusObservability {
  const apiKey =
    environment.POSTHOG_PROJECT_TOKEN ?? environment.POSTHOG_API_KEY;
  if (!apiKey)
    return {
      capture: () => undefined,
      captureAiGeneration: () => undefined,
      captureAiSpan: () => undefined,
      captureException: () => undefined,
      log: () => undefined,
      startSpan: () => noopSpan,
      recordAgentRun: () => undefined,
      shutdown: async () => undefined,
    };
  const host = environment.POSTHOG_HOST ?? "https://us.i.posthog.com";
  const serviceName = environment.POSTHOG_SERVICE_NAME ?? "nimbus-executor";
  const deploymentEnvironment =
    environment.POSTHOG_DEPLOYMENT_ENVIRONMENT ??
    environment.NODE_ENV ??
    "development";
  const client = new PostHog(apiKey, {
    host,
    traces: {
      serviceName,
      environment: deploymentEnvironment,
    },
    metrics: { serviceName },
  });
  let loggerProvider: LoggerProvider | undefined;
  let logger: Logger | undefined;
  try {
    loggerProvider = new LoggerProvider({
      resource: resourceFromAttributes({
        "service.name": serviceName,
        "deployment.environment": deploymentEnvironment,
      }),
      processors: [
        new BatchLogRecordProcessor(
          new OTLPLogExporter({
            url: `${host.replace(/\/$/, "")}/i/v1/logs`,
            headers: { Authorization: `Bearer ${apiKey}` },
          }),
        ),
      ],
    });
    logger = loggerProvider.getLogger("nimbus");
  } catch {
    loggerProvider = undefined;
    logger = undefined;
  }
  return {
    capture(distinctId, event, metadata = {}) {
      client.capture({
        distinctId,
        event,
        properties: validateSafeMetadata(metadata),
      });
    },
    captureAiGeneration(generation) {
      client.captureAi(buildAiGenerationEvent(generation));
    },
    captureAiSpan(span) {
      client.captureAi(buildAiSpanEvent(span));
    },
    captureException(error, distinctId, metadata = {}) {
      client.captureException(
        error,
        distinctId,
        validateSafeMetadata(metadata),
      );
    },
    log(severity, message, metadata = {}) {
      logger?.emit({
        severityNumber: logSeverity(severity),
        severityText: severity.toUpperCase(),
        body: message.slice(0, 200),
        attributes: validateSafeMetadata(metadata),
      });
    },
    startSpan(name, context) {
      const metadata = validateSafeMetadata(context.metadata);
      const span = client.withContext(
        {
          ...(context.distinctId ? { distinctId: context.distinctId } : {}),
          ...(context.sessionId ? { sessionId: context.sessionId } : {}),
        },
        () =>
          client.startSpan(name.slice(0, 120), {
            kind: "internal",
            attributes: metadata,
          }),
      );
      const identifiers = traceIdentifiers(span.traceparent());
      return {
        ...identifiers,
        finish(outcome, error) {
          span.setAttribute("nimbus.outcome", outcome);
          if (outcome === "failed") {
            if (error) span.recordException(error);
            else span.setStatus("error", "Nimbus operation failed");
          } else span.setStatus("ok");
          span.end();
        },
      };
    },
    recordAgentRun(outcome, durationMs) {
      const attributes = { outcome };
      client.metrics.count("nimbus.agent.requests", 1, { attributes });
      client.metrics.histogram("nimbus.agent.duration", durationMs, {
        unit: "ms",
        attributes,
      });
    },
    async shutdown() {
      await Promise.allSettled([
        client.shutdown(),
        loggerProvider?.shutdown() ?? Promise.resolve(),
      ]);
    },
  };
}
