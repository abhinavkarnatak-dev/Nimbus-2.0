CREATE TABLE "github_authorizations" (
  "state_hash" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "browser_hash" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "payload" jsonb;
