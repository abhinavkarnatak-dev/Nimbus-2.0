ALTER TABLE task_messages ADD COLUMN attachment_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE task_messages ADD CONSTRAINT task_messages_attachment_limit CHECK (jsonb_typeof(attachment_ids) = 'array' AND jsonb_array_length(attachment_ids) <= 6);
--> statement-breakpoint
CREATE TABLE message_attachments (
 id text PRIMARY KEY,
 organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 task_id text REFERENCES tasks(id) ON DELETE CASCADE,
 message_id text REFERENCES task_messages(id) ON DELETE CASCADE,
 name text NOT NULL,
 size integer NOT NULL CHECK (size > 0 AND size <= 10485760),
 content_type text NOT NULL,
 object_key text NOT NULL,
 text_key text NOT NULL,
 status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','ready','bound')),
 extraction_warning text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((task_id IS NULL) = (message_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX message_attachments_owner_idx ON message_attachments(organization_id,user_id,status);
--> statement-breakpoint
CREATE INDEX message_attachments_task_idx ON message_attachments(task_id,message_id);
