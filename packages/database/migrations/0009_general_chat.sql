ALTER TABLE tasks ALTER COLUMN repository_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE codex_threads ALTER COLUMN workspace_id DROP NOT NULL;
