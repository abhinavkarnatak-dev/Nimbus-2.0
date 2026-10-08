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
});

export const fileChanges = pgTable("file_changes", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  previousPath: text("previous_path"),
  status: text("status").notNull(),
  additions: integer("additions").notNull().default(0),
  deletions: integer("deletions").notNull().default(0),
  patchObjectKey: text("patch_object_key"),
  ...timestamps,
});

export const artifacts = pgTable("artifacts", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  objectKey: text("object_key").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  checksum: text("checksum").notNull(),
  createdAt: utc("created_at").notNull().defaultNow(),
});

export const pullRequests = pgTable(
  "pull_requests",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    generation: integer("generation").notNull().default(1),
    githubRepositoryId: bigint("github_repository_id", { mode: "number" }),
    number: integer("number"),
    branchName: text("branch_name").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    url: text("url"),
    headSha: text("head_sha"),
    mergeable: boolean("mergeable"),
    reviewState: text("review_state"),
    idempotencyKey: text("idempotency_key").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pull_requests_task_generation_unique").on(
      table.taskId,
      table.generation,
    ),
    uniqueIndex("pull_requests_task_open_unique")
      .on(table.taskId)
      .where(sql`${table.state} = 'open'`),
  ],
);

// Notification storage is independent of task execution and PR publishing.
export const emailNotificationSettings = pgTable(
  "email_notification_settings",
  {
    id: text("id").primaryKey(),
    enabledAt: utc("enabled_at").notNull().defaultNow(),
  },
);
export const emailNotifications = pgTable(
  "email_notifications",
  {
    id: text("id").primaryKey(),
    pullRequestId: text("pull_request_id")
      .notNull()
      .references(() => pullRequests.id, { onDelete: "cascade" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: utc("available_at").notNull().defaultNow(),
    leaseUntil: utc("lease_until"),
    leaseToken: text("lease_token"),
    firstAttemptAt: utc("first_attempt_at"),
    sentAt: utc("sent_at"),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    index("email_notifications_pending_idx").on(
      table.status,
      table.availableAt,
    ),
    check(
      "email_notifications_event_valid",
      sql`${table.event} IN ('created','merged','closed')`,
    ),
    check(
      "email_notifications_status_valid",
      sql`${table.status} IN ('pending','sending','sent','failed')`,
    ),
  ],
);

export const skills = pgTable("skills", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  ownerUserId: text("owner_user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  visibility: text("visibility").notNull().default("private"),
  summary: text("summary").notNull().default(""),
  disabledAt: utc("disabled_at"),
  ...timestamps,
});

export const skillVersions = pgTable(
  "skill_versions",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    checksum: text("checksum").notNull(),
    objectKey: text("object_key").notNull(),
    frontmatter: jsonb("frontmatter").notNull(),
    requestedCapabilities: jsonb("requested_capabilities")
      .notNull()
      .default([]),
    publishedAt: utc("published_at"),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("skill_versions_number_unique").on(
      table.skillId,
      table.version,
    ),
  ],
);

export const skillAssignments = pgTable(
  "skill_assignments",
  {
    id: text("id").primaryKey(),
    skillVersionId: text("skill_version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("skill_assignments_scope_unique").on(
      table.skillVersionId,
      table.scopeType,
      table.scopeId,
    ),
  ],
);

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    summary: text("summary").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    sourceTaskId: text("source_task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    expiresAt: utc("expires_at"),
    deletedAt: utc("deleted_at"),
    ...timestamps,
  },
  (table) => [index("memories_scope_idx").on(table.scopeType, table.scopeId)],
);

export const schedules = pgTable("schedules", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  schedule: text("schedule").notNull(),
  timezone: text("timezone").notNull(),
  payload: jsonb("payload").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps,
});

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    payload: jsonb("payload").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    sentAt: utc("sent_at"),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notifications_idempotency_unique").on(table.idempotencyKey),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    deliveryId: text("delivery_id").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload"),
    status: text("status").notNull(),
    receivedAt: utc("received_at").notNull().defaultNow(),
    processedAt: utc("processed_at"),
    errorClassification: text("error_classification"),
  },
  (table) => [
    uniqueIndex("webhook_deliveries_provider_unique").on(
      table.provider,
      table.deliveryId,
    ),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response"),
    expiresAt: utc("expires_at").notNull(),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idempotency_keys_scope_unique").on(
      table.organizationId,
      table.scope,
      table.key,
    ),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    correlationId: text("correlation_id").notNull(),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_org_time_idx").on(table.organizationId, table.createdAt),
  ],
);

export const usageRecords = pgTable("usage_records", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  quantity: bigint("quantity", { mode: "number" }).notNull(),
  unit: text("unit").notNull(),
  recordedAt: utc("recorded_at").notNull().defaultNow(),
});

export const oauthAuthorizationStates = pgTable(
  "oauth_authorization_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    stateHash: text("state_hash").notNull(),
    encryptedVerifier: text("encrypted_verifier").notNull(),
    nonceHash: text("nonce_hash").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: utc("expires_at").notNull(),
    consumedAt: utc("consumed_at"),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("oauth_state_hash_unique").on(table.stateHash)],
);

export const githubAuthorizations = pgTable("github_authorizations", {
  stateHash: text("state_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  browserHash: text("browser_hash").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  expiresAt: utc("expires_at").notNull(),
  consumedAt: utc("consumed_at"),
});

export const outbox = pgTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: utc("available_at").notNull().defaultNow(),
    processedAt: utc("processed_at"),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("outbox_available_idx").on(table.processedAt, table.availableAt),
  ],
);
