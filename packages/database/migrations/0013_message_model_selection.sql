ALTER TABLE "task_messages" ADD COLUMN "requested_model" text;
--> statement-breakpoint
ALTER TABLE "task_messages" ADD COLUMN "requested_reasoning_effort" text;
