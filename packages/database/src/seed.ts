import { db, closeDatabase } from "./index.js";
import {
  artifacts,
  codexThreads,
  codexTurns,
  commandRuns,
  fileChanges,
  memberships,
  organizations,
  pullRequests,
  repositories,
  taskEvents,
  taskPlans,
  tasks,
  users,
  workspaces,
} from "./schema.js";

const database = db();

await database.transaction(async (tx) => {
  await tx
    .insert(users)
    .values({
      id: "usr_local_01J000000000000000000001",
      email: "developer@nimbus.local",
      name: "Nimbus Developer",
    })
    .onConflictDoNothing();

  await tx
    .insert(organizations)
    .values({
      id: "org_local_01J000000000000000000001",
      slug: "nimbus-labs",
      name: "Nimbus Labs",
      concurrencyLimit: 4,
    })
    .onConflictDoNothing();

  await tx
    .insert(memberships)
    .values({
      organizationId: "org_local_01J000000000000000000001",
      userId: "usr_local_01J000000000000000000001",
      role: "owner",
    })
    .onConflictDoNothing();

  await tx
    .insert(repositories)
    .values({
      id: "repo_local_01J00000000000000000001",
      organizationId: "org_local_01J000000000000000000001",
      owner: "nimbus-labs",
      name: "acme-web",
      fullName: "nimbus-labs/acme-web",
      defaultBranch: "main",
      private: true,
    })
    .onConflictDoNothing();

  await tx
    .insert(tasks)
    .values({
      id: "task_demo_01J00000000000000000001",
      organizationId: "org_local_01J000000000000000000001",
      createdByUserId: "usr_local_01J000000000000000000001",
      repositoryId: "repo_local_01J00000000000000000001",
      title: "Make password reset failures actionable",
      objective:
        "Diagnose password reset failures, improve the error handling, add regression coverage, and open a pull request.",
      status: "pr_open",
      baseRef: "main",
      branchName: "nimbus/task-demo-password-reset",
    })
    .onConflictDoNothing();

  await tx
    .insert(workspaces)
    .values({
      id: "ws_demo_01J0000000000000000000001",
      taskId: "task_demo_01J00000000000000000001",
      provider: "local-test",
      providerWorkspaceId: "local-ws-task-demo",
      status: "ready",
      resourceLimits: {
        cpu: 2,
        memoryMb: 4096,
        diskMb: 10240,
        maxSeconds: 3600,
      },
      lastHeartbeatAt: "2026-10-05T15:40:31.000Z",
    })
    .onConflictDoNothing();

  await tx
    .insert(codexThreads)
    .values({
      id: "ctx_demo_01J0000000000000000000001",
      taskId: "task_demo_01J00000000000000000001",
      workspaceId: "ws_demo_01J0000000000000000000001",
      providerThreadId: "thread_demo_deterministic",
      model: "fake-codex-test-provider",
      providerConfigVersion: 1,
      lastProcessedEventSequence: 9,
      lastConfirmedCompletionStatus: "completed",
    })
    .onConflictDoNothing();

  await tx
    .insert(codexTurns)
    .values({
      id: "turn_demo_01J000000000000000000001",
      codexThreadId: "ctx_demo_01J0000000000000000000001",
      providerTurnId: "turn_demo_deterministic",
      status: "completed",
      startedAt: "2026-10-05T15:38:20.000Z",
      completedAt: "2026-10-05T15:40:18.000Z",
    })
    .onConflictDoNothing();

  const events = [
    [
      1,
      "lifecycle",
      "queued",
      "succeeded",
      "Task accepted",
      "Nimbus stored the task and authorization context.",
      "Durable state is required before work can be scheduled.",
      [],
      null,
      null,
      "Provision an isolated workspace.",
    ],
    [
      2,
      "lifecycle",
      "provisioning",
      "succeeded",
      "Workspace ready",
      "A task-scoped workspace was provisioned and linked to the durable workflow.",
      "Repository work must be isolated from the control plane and other tasks.",
      [],
      null,
      null,
      "Start Codex app-server.",
    ],
    [
      3,
      "repository",
      "running",
      "succeeded",
      "Repository inspected",
      "Codex read repository instructions, package scripts, and the password reset flow.",
      "The implementation needed repository-specific conventions before any edit.",
      [
        "AGENTS.md",
        "src/auth/reset-password.ts",
        "src/auth/reset-password.test.ts",
      ],
      null,
      "repository_search",
      "Revise the plan using the discovered validation helper.",
    ],
    [
      4,
      "plan",
      "running",
      "succeeded",
      "Plan revised",
      "The plan changed from adding a generic error boundary to preserving server error codes in the form state.",
      "Inspection showed the shared validation helper already classified retryable failures.",
      ["src/auth/errors.ts"],
      null,
      null,
      "Implement the focused change and regression test.",
    ],
    [
      5,
      "repository",
      "running",
      "succeeded",
      "Password reset flow updated",
      "Codex preserved retryable server errors and added an accessible recovery action.",
      "Users previously received a generic message with no useful next step.",
      ["src/auth/reset-password.ts", "src/auth/reset-password-form.tsx"],
      null,
      "apply_patch",
      "Add regression coverage.",
    ],
    [
      6,
      "repository",
      "running",
      "succeeded",
      "Regression coverage added",
      "Codex added tests for expired, throttled, and offline reset attempts.",
      "The new behavior needs deterministic coverage before delivery.",
      ["src/auth/reset-password.test.ts"],
      null,
      "apply_patch",
      "Run the affected checks.",
    ],
    [
      7,
      "check",
      "running",
      "succeeded",
      "Targeted tests passed",
      "The authentication test suite completed successfully.",
      "A successful process exit is required before Nimbus can claim verification.",
      ["src/auth/reset-password.test.ts"],
      "pnpm test src/auth/reset-password.test.ts",
      "shell",
      "Review the final diff.",
    ],
    [
      8,
      "decision",
      "running",
      "succeeded",
      "Final diff reviewed",
      "Codex inspected the final diff and found no unrelated files or unresolved risk.",
      "A coherent reviewed change is required before trusted delivery.",
      [
        "src/auth/reset-password.ts",
        "src/auth/reset-password-form.tsx",
        "src/auth/reset-password.test.ts",
      ],
      "git diff --check",
      "shell",
      "Push the task branch and create the pull request.",
    ],
    [
      9,
      "delivery",
      "pr_open",
      "succeeded",
      "Pull request created",
      "The trusted GitHub layer pushed the task branch and recorded pull request 148.",
      "Verified work is delivered automatically and idempotently for review.",
      [
        "src/auth/reset-password.ts",
        "src/auth/reset-password-form.tsx",
        "src/auth/reset-password.test.ts",
      ],
      null,
      "github",
      "Wait for review or a follow-up message.",
    ],
  ] as const;

  for (const [
    sequence,
    category,
    phase,
    status,
    title,
    whatWasDone,
    whyItWasDone,
    filesAffected,
    command,
    toolName,
    nextStep,
  ] of events) {
    await tx
      .insert(taskEvents)
      .values({
        id: `evt_demo_${String(sequence).padStart(2, "0")}_01J0000000000000000000`,
        taskId: "task_demo_01J00000000000000000001",
        sequence,
        timestamp: new Date(
          Date.parse("2026-10-05T15:37:00.000Z") + sequence * 22_000,
        ).toISOString(),
        category,
        phase,
        status,
        title,
        whatWasDone,
        whyItWasDone,
        evidence:
          sequence === 7
            ? ["exitCode=0", "38 tests passed", "duration=18.4s"]
            : [],
        filesAffected: [...filesAffected],
        command,
        toolName,
        verification:
          sequence === 7
            ? "Process exited 0. All 38 targeted tests passed."
            : null,
        risks:
          sequence === 4
            ? ["Copy must not disclose whether an email account exists."]
            : [],
        nextStep,
        visibility: "user",
        correlationId: "corr_demo_01J0000000000000000001",
      })
      .onConflictDoNothing();
  }

  await tx
    .insert(taskPlans)
    .values({
      id: "plan_demo_01J000000000000000000001",
      taskId: "task_demo_01J00000000000000000001",
      revision: 2,
      objective:
        "Make password reset failures actionable without leaking account existence.",
      confirmedFacts: [
        "The repository has a shared retryable error classifier.",
        "Password reset responses must not reveal whether an email address exists.",
        "The affected package uses Vitest and Testing Library.",
      ],
      items: [
        {
          id: "inspect",
          title: "Inspect reset flow and conventions",
          status: "completed",
        },
        {
          id: "implement",
          title: "Preserve retryable errors and recovery action",
          status: "completed",
        },
        { id: "tests", title: "Add regression coverage", status: "completed" },
        {
          id: "verify",
          title: "Run targeted tests and review diff",
          status: "completed",
        },
        {
          id: "deliver",
          title: "Push and open pull request",
          status: "completed",
        },
      ],
      verificationRequirements: [
        "Targeted authentication tests pass",
        "git diff --check passes",
      ],
      risks: [
        "Do not disclose account existence",
        "Keep retry guidance accessible",
      ],
      changeReason:
        "Repository inspection found an existing classifier, so the plan reused it instead of adding a parallel error boundary.",
    })
    .onConflictDoNothing();

  await tx
    .insert(commandRuns)
    .values([
      {
        id: "cmd_demo_01J000000000000000000001",
        taskId: "task_demo_01J00000000000000000001",
        command: "pnpm test src/auth/reset-password.test.ts",
        workingDirectory: "/workspace",
        status: "succeeded",
        exitCode: 0,
        durationMs: 18_431,
        startedAt: "2026-10-05T15:39:32.000Z",
        completedAt: "2026-10-05T15:39:50.431Z",
      },
      {
        id: "cmd_demo_01J000000000000000000002",
        taskId: "task_demo_01J00000000000000000001",
        command: "git diff --check",
        workingDirectory: "/workspace",
        status: "succeeded",
        exitCode: 0,
        durationMs: 287,
        startedAt: "2026-10-05T15:39:58.000Z",
        completedAt: "2026-10-05T15:39:58.287Z",
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(fileChanges)
    .values([
      {
        id: "chg_demo_01J000000000000000000001",
        taskId: "task_demo_01J00000000000000000001",
        path: "src/auth/reset-password.ts",
        status: "modified",
        additions: 19,
        deletions: 6,
      },
      {
        id: "chg_demo_01J000000000000000000002",
        taskId: "task_demo_01J00000000000000000001",
        path: "src/auth/reset-password-form.tsx",
        status: "modified",
        additions: 24,
        deletions: 9,
      },
      {
        id: "chg_demo_01J000000000000000000003",
        taskId: "task_demo_01J00000000000000000001",
        path: "src/auth/reset-password.test.ts",
        status: "modified",
        additions: 63,
        deletions: 2,
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(pullRequests)
    .values({
      id: "pr_demo_01J0000000000000000000001",
      taskId: "task_demo_01J00000000000000000001",
      number: 148,
      branchName: "nimbus/task-demo-password-reset",
      title: "Improve password reset recovery",
      state: "open",
      url: "https://github.com/nimbus-labs/acme-web/pull/148",
      headSha: "b8e33f841e6fc13a240c7ef4217ceef1f03f8a46",
      mergeable: true,
      reviewState: "awaiting_review",
      idempotencyKey: "pr_task_demo_01J00000000000000000001",
    })
    .onConflictDoNothing();

  await tx
    .insert(artifacts)
    .values({
      id: "art_demo_01J000000000000000000001",
      taskId: "task_demo_01J00000000000000000001",
      name: "verification-summary.json",
      mimeType: "application/json",
      objectKey: "local/task-demo/verification-summary.json",
      sizeBytes: 842,
      checksum:
        "sha256:1b1e75253ab6ce52d5dbf9451c29e68bff2cdad76cc670e670db850fa8a0c33e",
    })
    .onConflictDoNothing();
});

await closeDatabase();
console.log("Nimbus local development data is ready");
