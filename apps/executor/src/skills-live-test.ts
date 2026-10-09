import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  closeDatabase,
  codexThreads,
  db,
  eq,
  resolveChatSkills,
  skills,
  taskEvents,
  taskMessages,
  tasks,
  workspaces,
} from "@nimbus/database";

// Opt-in live verification of selected guidance. No tools, file edits or GitHub writes.
const sourceId = process.env.NIMBUS_LIVE_SOURCE_TASK;
if (!sourceId)
  throw new Error(
    "Set NIMBUS_LIVE_SOURCE_TASK to an authorized public repository session",
  );
const [source] = await db().select().from(tasks).where(eq(tasks.id, sourceId));
if (
  !source?.repositoryId ||
  !source.requestedModel ||
  source.requestedModel === "fake-codex-test-provider"
)
  throw new Error("A live repository source is required");
const skillId = `skl_${randomUUID().replaceAll("-", "")}`;
const summary = (marker: string) =>
  `Begin every assistant response with the exact word ${marker}. Keep it to one short sentence and answer the user's question. Do not add a heading.`;
async function waitMessage(messageId: string) {
  for (let i = 0; i < 180; i++) {
    const [message] = await db()
      .select()
      .from(taskMessages)
      .where(eq(taskMessages.id, messageId));
    if (message?.status === "completed") return;
    if (message?.status === "failed")
      throw new Error(`Live skills request failed: ${messageId}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Skills verification timed out");
}
async function reply(taskId: string, after = 0) {
  const events = await db()
    .select()
    .from(taskEvents)
    .where(
      and(
        eq(taskEvents.taskId, taskId),
        eq(taskEvents.category, "agent_message"),
      ),
    )
    .orderBy(asc(taskEvents.sequence));
  return events
    .filter((event) => event.sequence > after)
    .map((event) => event.whatWasDone)
    .join("");
}
try {
  await db()
    .insert(skills)
    .values({
      id: skillId,
      slug: skillId,
      name: "Live skill verification",
      description: "Verification marker",
      summary: summary("nebula-skill-initial"),
      organizationId: source.organizationId,
      ownerUserId: source.createdByUserId,
    });
  for (const repositoryMode of [false, true]) {
    await db()
      .update(skills)
      .set({ summary: summary("nebula-skill-initial") })
      .where(eq(skills.id, skillId));
    const taskId = `task_${randomUUID().replaceAll("-", "")}`,
      messageId = `msg_${randomUUID().replaceAll("-", "")}`;
    const content =
      "Read-only skill verification. What is 2+2? Do not use tools, edit files, commit, push, or create/manage PRs.";
    const selectedSkills = await resolveChatSkills(
      source.organizationId,
      source.createdByUserId,
      [skillId],
    );
    if (!selectedSkills) throw new Error("Skill snapshot unavailable");
    await db().transaction(async (tx) => {
      await tx.insert(tasks).values({
        id: taskId,
        organizationId: source.organizationId,
        createdByUserId: source.createdByUserId,
        repositoryId: repositoryMode ? source.repositoryId : null,
        title: repositoryMode
          ? "Repo skills verification"
          : "General skills verification",
        titleGeneratedAt: new Date().toISOString(),
        objective: content,
        requestedModel: source.requestedModel,
        requestedReasoningEffort: source.requestedReasoningEffort,
        selectedSkillIds: [skillId],
        baseRef: repositoryMode ? source.baseRef : "",
        status: "queued",
      });
      await tx.insert(taskMessages).values({
        id: messageId,
        taskId,
        userId: source.createdByUserId,
        content,
        selectedSkills,
        idempotencyKey: randomUUID(),
      });
    });
    console.log(JSON.stringify({ taskId, repositoryMode, phase: "created" }));
    await waitMessage(messageId);
    const initial = await reply(taskId);
    if (!initial.includes("nebula-skill-initial") || !initial.includes("4"))
      throw new Error("Initial skill was not reflected in the reply");
    const [thread] = await db()
      .select()
      .from(codexThreads)
      .where(eq(codexThreads.taskId, taskId));
    const eventRows = await db()
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskId))
      .orderBy(asc(taskEvents.sequence));
    await db()
      .update(skills)
      .set({ summary: summary("nebula-skill-updated") })
      .where(eq(skills.id, skillId));
    const updated = await resolveChatSkills(
      source.organizationId,
      source.createdByUserId,
      [skillId],
    );
    const followupId = `msg_${randomUUID().replaceAll("-", "")}`;
    await db().transaction(async (tx) => {
      await tx.insert(taskMessages).values({
        id: followupId,
        taskId,
        userId: source.createdByUserId,
        content: "Now what is 3+3? Do not use tools or modify anything.",
        selectedSkills: updated!,
        idempotencyKey: randomUUID(),
      });
      await tx
        .update(tasks)
        .set({
          status: "queued",
          completedAt: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, taskId));
    });
    await waitMessage(followupId);
    const followup = await reply(taskId, eventRows.at(-1)?.sequence ?? 0);
    if (
      !followup.includes("nebula-skill-updated") ||
      !followup.includes("6") ||
      followup.includes("nebula-skill-initial")
    )
      throw new Error("Updated skill did not replace the earlier version");
    const [sameThread] = await db()
      .select()
      .from(codexThreads)
      .where(eq(codexThreads.taskId, taskId));
    if (sameThread?.providerThreadId !== thread?.providerThreadId)
      throw new Error("Follow-up changed conversation thread");
    const savedWorkspaces = await db()
      .select()
      .from(workspaces)
      .where(eq(workspaces.taskId, taskId));
    if (!repositoryMode && savedWorkspaces.length)
      throw new Error("General chat provisioned a sandbox");
    console.log(
      JSON.stringify({
        taskId,
        repositoryMode,
        phase: "passed",
        sameThread: true,
        initial,
        followup,
      }),
    );
  }
} finally {
  await db().delete(skills).where(eq(skills.id, skillId));
  await closeDatabase();
}
