import { z } from "zod";

export const taskStatuses = [
  "queued",
  "provisioning",
  "running",
  "awaiting_user",
  "paused",
  "preparing_pr",
  "pushing",
  "creating_pr",
  "pr_open",
  "completed",
  "cancelling",
  "cancelled",
  "failed",
] as const;

export const TaskStatusSchema = z.enum(taskStatuses);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TransitionActorSchema = z.enum([
  "user",
  "system",
  "executor",
  "reconciler",
]);
export type TransitionActor = z.infer<typeof TransitionActorSchema>;

const allowedTargets: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  queued: ["provisioning", "cancelling", "cancelled", "failed"],
  provisioning: ["running", "cancelling", "failed"],
  running: [
    "awaiting_user",
    "paused",
    "preparing_pr",
    "completed",
    "cancelling",
    "failed",
  ],
  awaiting_user: ["running", "cancelling", "cancelled", "failed"],
  paused: ["queued", "cancelling", "cancelled"],
  preparing_pr: ["pushing", "cancelling", "failed"],
  pushing: ["creating_pr", "cancelling", "failed"],
  creating_pr: ["pr_open", "cancelling", "failed"],
  pr_open: ["running", "completed", "cancelling", "failed"],
  completed: ["queued"],
  cancelling: ["cancelled", "failed"],
  cancelled: ["queued"],
  failed: ["queued"],
};

export const TaskTransitionSchema = z.strictObject({
  from: TaskStatusSchema,
  to: TaskStatusSchema,
  actor: TransitionActorSchema,
  reason: z.string().trim().min(1).max(500),
  at: z.iso.datetime({ offset: true }),
  idempotencyKey: z.string().min(12).max(200),
  correlationId: z.string().min(12).max(100),
});

export type TaskTransition = z.infer<typeof TaskTransitionSchema>;

export function assertTaskTransition(value: TaskTransition): TaskTransition {
  const transition = TaskTransitionSchema.parse(value);
  if (!allowedTargets[transition.from].includes(transition.to)) {
    throw new Error(
      `Invalid task transition: ${transition.from} -> ${transition.to}`,
    );
  }
  if (
    transition.to === "cancelled" &&
    !["user", "executor", "system"].includes(transition.actor)
  ) {
    throw new Error(
      "Only a user, executor, or system action can complete cancellation",
    );
  }
  return transition;
}

export function allowedTaskTargets(status: TaskStatus): readonly TaskStatus[] {
  return allowedTargets[status];
}
