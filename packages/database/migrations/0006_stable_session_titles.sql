ALTER TABLE "tasks" ADD COLUMN "title_generated_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "tasks"
SET "title_generated_at" = COALESCE("completed_at", "updated_at")
WHERE "status" IN ('completed', 'pr_open');
