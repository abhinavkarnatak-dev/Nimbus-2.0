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

export interface NimbusObservability {
  capture(distinctId: string, event: string, metadata?: SafeMetadata): void;
  shutdown(): Promise<void>;
}

export function validateSafeMetadata(metadata: unknown): SafeMetadata {
  return SafeMetadataSchema.parse(metadata ?? {});
}

export function createObservability(
  environment: NodeJS.ProcessEnv = process.env,
): NimbusObservability {
  const apiKey = environment.POSTHOG_API_KEY;
  if (!apiKey)
    return { capture: () => undefined, shutdown: async () => undefined };
  const client = new PostHog(apiKey, {
    host: environment.POSTHOG_HOST ?? "https://us.i.posthog.com",
  });
  return {
    capture(distinctId, event, metadata = {}) {
      client.capture({
        distinctId,
        event,
        properties: validateSafeMetadata(metadata),
      });
    },
    async shutdown() {
      await client.shutdown();
    },
  };
}
