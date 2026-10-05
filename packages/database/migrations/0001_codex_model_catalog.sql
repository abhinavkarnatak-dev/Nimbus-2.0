ALTER TABLE "tasks" ADD COLUMN "requested_model" text;
--> statement-breakpoint
CREATE TABLE "codex_model_catalogs" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "models" jsonb NOT NULL,
  "source" text DEFAULT 'codex_app_server' NOT NULL,
  "discovered_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "codex_model_catalogs_account_unique" ON "codex_model_catalogs" ("account_id");
