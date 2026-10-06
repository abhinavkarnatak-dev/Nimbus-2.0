CREATE TABLE "task_messages" (
  "id" text PRIMARY KEY,
  "task_id" text NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "content" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "task_messages_status_valid" CHECK ("status" IN ('queued','running','completed','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "task_messages_request_unique" ON "task_messages" ("task_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "task_messages_pending_idx" ON "task_messages" ("task_id", "status");
--> statement-breakpoint
INSERT INTO "task_messages" ("id","task_id","user_id","content","idempotency_key","status","created_at")
SELECT 'msg_initial_' || "id", "id", "created_by_user_id", "objective", 'initial_' || "id", CASE WHEN "status" = 'queued' THEN 'queued' ELSE 'completed' END, "created_at" FROM "tasks";
--> statement-breakpoint
ALTER TABLE "codex_turns" ADD COLUMN "task_message_id" text REFERENCES "task_messages"("id") ON DELETE RESTRICT;
