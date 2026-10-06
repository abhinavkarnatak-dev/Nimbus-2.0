ALTER TABLE skills ADD COLUMN summary text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN selected_skill_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE task_messages ADD COLUMN selected_skills jsonb NOT NULL DEFAULT '[]'::jsonb;
