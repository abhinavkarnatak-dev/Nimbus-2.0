CREATE TABLE "codex_credentials" (
  "account_key" text NOT NULL,
  "kind" text DEFAULT 'auth' NOT NULL,
  "organization_id" text,
  "user_id" text,
  "blob" text,
  "algorithm" text DEFAULT 'aes-256-gcm' NOT NULL,
  "blob_version" integer DEFAULT 1 NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("account_key", "kind")
);
--> statement-breakpoint
CREATE INDEX "codex_credentials_identity_idx" ON "codex_credentials" ("organization_id", "user_id");
