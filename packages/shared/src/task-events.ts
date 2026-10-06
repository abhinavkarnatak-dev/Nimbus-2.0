import { z } from "zod";

export const EventCategorySchema = z.enum([
  "lifecycle",
  "decision",
  "plan",
  "tool",
  "repository",
  "command",
  "check",
  "delivery",
  "recovery",
  "message",
  "security",
  "protocol",
]);

export const EventStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
]);

export const TaskEventSchema = z.strictObject({
  eventId: z.string().min(12),
  taskId: z.string().min(12),
  sequence: z.number().int().positive(),
  timestamp: z.iso.datetime({ offset: true }),
  category: EventCategorySchema,
  phase: z.string().min(1).max(100),
  status: EventStatusSchema,
  title: z.string().min(1).max(200),
  whatWasDone: z.string().min(1).max(2_000),
  whyItWasDone: z.string().min(1).max(2_000),
  evidence: z.array(z.string().max(1_000)).max(50).default([]),
  filesAffected: z.array(z.string().max(500)).max(200).default([]),
  command: z.string().max(2_000).nullable().default(null),
  toolName: z.string().max(100).nullable().default(null),
  verification: z.string().max(2_000).nullable().default(null),
  risks: z.array(z.string().max(500)).max(20).default([]),
  nextStep: z.string().max(1_000).nullable().default(null),
  visibility: z.enum(["user", "internal", "audit"]),
  correlationId: z.string().min(12).max(100),
});

export type TaskEvent = z.infer<typeof TaskEventSchema>;
