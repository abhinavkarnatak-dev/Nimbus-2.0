ALTER TABLE "pull_requests" ADD COLUMN "generation" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
DROP INDEX "pull_requests_task_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_task_generation_unique" ON "pull_requests" ("task_id", "generation");
--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_task_open_unique" ON "pull_requests" ("task_id") WHERE "state" = 'open';
