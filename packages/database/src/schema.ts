import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const utc = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });
const timestamps = {
  createdAt: utc("created_at").notNull().defaultNow(),
  updatedAt: utc("updated_at").notNull().defaultNow(),
};

export const taskStatus = pgEnum("task_status", [
  "queued",
  "provisioning",
  "running",
  "awaiting_user",
  "paused",
  "preparing_pr",
  "pushing",
  "creating_pr",
  "pr_open",
  "completed",
  "cancelling",
  "cancelled",
  "failed",
]);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    onboardingCompletedAt: utc("onboarding_completed_at"),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    encryptedRefreshCredential: text("encrypted_refresh_credential"),
    credentialKeyVersion: integer("credential_key_version"),
    expiresAt: utc("expires_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("accounts_provider_identity_unique").on(
      table.provider,
      table.providerAccountId,
    ),
  ],
);

export const agentInstructions = pgTable(
  "agent_instructions",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull().default(""),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.userId] })],
);

export const codexModelCatalogs = pgTable(
  "codex_model_catalogs",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    models: jsonb("models")
      .$type<
        Array<{
          id: string;
          displayName?: string;
          description?: string;
          isDefault?: boolean;
          defaultReasoningEffort?: string;
          supportedReasoningEfforts?: Array<{
            reasoningEffort: string;
            description: string;
          }>;
        }>
      >()
      .notNull(),
    source: text("source").notNull().default("codex_app_server"),
    discoveredAt: utc("discovered_at").notNull().defaultNow(),
    expiresAt: utc("expires_at").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("codex_model_catalogs_account_unique").on(table.accountId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: utc("expires_at").notNull(),
    lastSeenAt: utc("last_seen_at").notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [uniqueIndex("sessions_token_hash_unique").on(table.tokenHash)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    concurrencyLimit: integer("concurrency_limit").notNull().default(4),
    ...timestamps,
  },
  (table) => [uniqueIndex("organizations_slug_unique").on(table.slug)],
);

export const memberships = pgTable(
  "memberships",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.userId] })],
);

export const integrationAccounts = pgTable("integration_accounts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  externalAccountId: text("external_account_id").notNull(),
  encryptedCredentials: text("encrypted_credentials"),
  scopes: text("scopes")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    accountLogin: text("account_login").notNull(),
    status: text("status").notNull().default("active"),
    suspendedAt: utc("suspended_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("github_installation_external_unique").on(table.installationId),
  ],
);

export const repositories = pgTable(
  "repositories",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    githubInstallationId: text("github_installation_id").references(
      () => githubInstallations.id,
      { onDelete: "restrict" },
    ),
    githubRepositoryId: bigint("github_repository_id", { mode: "number" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    private: boolean("private").notNull().default(true),
    archived: boolean("archived").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("repositories_org_full_name_unique").on(
      table.organizationId,
      table.fullName,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    repositoryId: text("repository_id").references(() => repositories.id, {
      onDelete: "restrict",
    }),
    title: text("title").notNull(),
    objective: text("objective").notNull(),
    titleGeneratedAt: utc("title_generated_at"),
    selectedSkillIds: jsonb("selected_skill_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    requestedModel: text("requested_model"),
    requestedReasoningEffort: text("requested_reasoning_effort"),
    status: taskStatus("status").notNull().default("queued"),
    version: integer("version").notNull().default(1),
    branchName: text("branch_name"),
    baseRef: text("base_ref").notNull(),
    archivedAt: utc("archived_at"),
    completedAt: utc("completed_at"),
    failureCode: text("failure_code"),
    ...timestamps,
  },
  (table) => [
    index("tasks_org_status_idx").on(table.organizationId, table.status),
    index("tasks_repo_created_idx").on(table.repositoryId, table.createdAt),
  ],
);

export const taskMessages = pgTable(
  "task_messages",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    content: text("content").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    selectedSkills: jsonb("selected_skills")
      .$type<import("@nimbus/shared").SkillSnapshot[]>()
      .notNull()
      .default([]),
    requestedModel: text("requested_model"),
    requestedReasoningEffort: text("requested_reasoning_effort"),
    status: text("status").notNull().default("queued"),
    completedAt: utc("completed_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("task_messages_request_unique").on(
      table.taskId,
      table.idempotencyKey,
    ),
    index("task_messages_pending_idx").on(table.taskId, table.status),
    check(
      "task_messages_status_valid",
      sql`${table.status} IN ('queued','running','completed','failed','cancelling','cancelled')`,
    ),
  ],
);

export const taskSessions = pgTable("task_sessions", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  eveSessionId: text("eve_session_id"),
  startedAt: utc("started_at").notNull().defaultNow(),
  endedAt: utc("ended_at"),
  ...timestamps,
});

export const taskEvents = pgTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    timestamp: utc("timestamp").notNull().defaultNow(),
    category: text("category").notNull(),
    phase: text("phase").notNull(),
    status: text("status").notNull(),
    title: text("title").notNull(),
    whatWasDone: text("what_was_done").notNull(),
    whyItWasDone: text("why_it_was_done").notNull(),
    evidence: jsonb("evidence").notNull().default([]),
    filesAffected: jsonb("files_affected").notNull().default([]),
    command: text("command"),
    toolName: text("tool_name"),
    verification: text("verification"),
    risks: jsonb("risks").notNull().default([]),
    nextStep: text("next_step"),
    visibility: text("visibility").notNull().default("user"),
    correlationId: text("correlation_id").notNull(),
  },
  (table) => [
    uniqueIndex("task_events_sequence_unique").on(table.taskId, table.sequence),
  ],
);

export const taskPlans = pgTable(
  "task_plans",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    objective: text("objective").notNull(),
    confirmedFacts: jsonb("confirmed_facts").notNull().default([]),
    items: jsonb("items").notNull().default([]),
    verificationRequirements: jsonb("verification_requirements")
      .notNull()
      .default([]),
    risks: jsonb("risks").notNull().default([]),
    changeReason: text("change_reason").notNull(),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("task_plans_revision_unique").on(table.taskId, table.revision),
  ],
);

export const taskCheckpoints = pgTable("task_checkpoints", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  eventSequence: integer("event_sequence").notNull(),
  createdAt: utc("created_at").notNull().defaultNow(),
});

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerWorkspaceId: text("provider_workspace_id").notNull(),
    status: text("status").notNull(),
    resourceLimits: jsonb("resource_limits").notNull(),
    lastHeartbeatAt: utc("last_heartbeat_at"),
    expiresAt: utc("expires_at"),
    ...timestamps,
  },
  (table) => [uniqueIndex("workspaces_task_unique").on(table.taskId)],
);

export const workspaceSnapshots = pgTable("workspace_snapshots", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  providerSnapshotId: text("provider_snapshot_id").notNull(),
  reason: text("reason").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  createdAt: utc("created_at").notNull().defaultNow(),
});

export const codexThreads = pgTable(
  "codex_threads",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "restrict",
    }),
    providerThreadId: text("provider_thread_id").notNull(),
    model: text("model").notNull(),
    providerConfigVersion: integer("provider_config_version").notNull(),
    lastProcessedEventSequence: integer("last_processed_event_sequence")
      .notNull()
      .default(0),
    lastConfirmedCompletionStatus: text("last_confirmed_completion_status"),
    ...timestamps,
  },
  (table) => [uniqueIndex("codex_threads_task_unique").on(table.taskId)],
);

export const codexTurns = pgTable("codex_turns", {
  id: text("id").primaryKey(),
  taskMessageId: text("task_message_id").references(() => taskMessages.id, {
    onDelete: "restrict",
  }),
  codexThreadId: text("codex_thread_id")
    .notNull()
    .references(() => codexThreads.id, { onDelete: "cascade" }),
  providerTurnId: text("provider_turn_id"),
  status: text("status").notNull(),
  startedAt: utc("started_at").notNull().defaultNow(),
  completedAt: utc("completed_at"),
  errorClassification: text("error_classification"),
});

// Durable Codex device-login credentials. A free web service replaces its
// container on every restart, redeploy, and spin-down, so the credential file
// is only a cache and this table is the source of truth that keeps a connected
// account connected. Rows are revoked, never reused, on disconnect.
export const codexCredentials = pgTable(
  "codex_credentials",
  {
    accountKey: text("account_key").notNull(),
    kind: text("kind").notNull().default("auth"),
    organizationId: text("organization_id"),
    userId: text("user_id"),
    blob: text("blob"),
    algorithm: text("algorithm").notNull().default("aes-256-gcm"),
    blobVersion: integer("blob_version").notNull().default(1),
    revokedAt: utc("revoked_at"),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.accountKey, table.kind] }),
    index("codex_credentials_identity_idx").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const toolCalls = pgTable("tool_calls", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  codexTurnId: text("codex_turn_id").references(() => codexTurns.id, {
    onDelete: "cascade",
  }),
  toolName: text("tool_name").notNull(),
  status: text("status").notNull(),
  summary: text("summary").notNull(),
  startedAt: utc("started_at").notNull().defaultNow(),
  completedAt: utc("completed_at"),
  durationMs: integer("duration_ms"),
  correlationId: text("correlation_id").notNull(),
});

export const commandRuns = pgTable("command_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  toolCallId: text("tool_call_id").references(() => toolCalls.id, {
    onDelete: "set null",
  }),
  command: text("command").notNull(),
  workingDirectory: text("working_directory").notNull(),
  status: text("status").notNull(),
  exitCode: integer("exit_code"),
  outputObjectKey: text("output_object_key"),
  startedAt: utc("started_at").notNull().defaultNow(),
  completedAt: utc("completed_at"),
  durationMs: integer("duration_ms"),
