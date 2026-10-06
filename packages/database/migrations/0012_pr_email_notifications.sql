CREATE TABLE "email_notification_settings" (
  "id" text PRIMARY KEY NOT NULL,
  "enabled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_notifications" (
  "id" text PRIMARY KEY NOT NULL,
  "pull_request_id" text NOT NULL REFERENCES "pull_requests"("id") ON DELETE CASCADE,
  "recipient_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event" text NOT NULL CONSTRAINT "email_notifications_event_valid" CHECK ("event" IN ('created','merged','closed')),
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL CONSTRAINT "email_notifications_status_valid" CHECK ("status" IN ('pending','sending','sent','failed')),
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_until" timestamp with time zone,
  "lease_token" text,
  "first_attempt_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "provider_message_id" text,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_notifications_pending_idx" ON "email_notifications" ("status", "available_at");
