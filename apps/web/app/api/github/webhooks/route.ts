import { randomUUID } from "node:crypto";
import {
  and,
  db,
  eq,
  githubInstallations,
  integrationAccounts,
  repositories,
  pullRequests,
  webhookDeliveries,
  sql,
  tasks,
} from "@nimbus/database";
import { verifyGitHubWebhookSignature } from "@nimbus/github";
import { readBoundedBody } from "@/lib/github-security";
import { reconcileGitHubRepositories } from "@/lib/github-repositories";
import { NextResponse } from "next/server";
import { z } from "zod";

const repository = z.object({ id: z.number().int().positive() });
const Payload = z.object({
  action: z.string().max(100).optional(),
  installation: z.object({ id: z.number().int().positive() }).optional(),
  repository: repository.optional(),
  repositories_removed: z.array(repository).max(10000).optional(),
  repositories_added: z.array(repository).max(10000).optional(),
  pull_request: z
    .object({
      number: z.number().int().positive(),
      state: z.enum(["open", "closed"]),
      merged: z.boolean().optional(),
      head: z
        .object({ sha: z.string().regex(/^[a-f0-9]{40,64}$/i) })
        .optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "GitHub webhook secret is not configured" },
      { status: 503 },
    );
  let body: Buffer;
  try {
    body = await readBoundedBody(request);
  } catch {
    return NextResponse.json(
      { error: "Webhook payload exceeds the limit" },
      { status: 413 },
    );
  }
  if (
    !verifyGitHubWebhookSignature(
      body,
      request.headers.get("x-hub-signature-256"),
      secret,
    )
  )
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 401 },
    );
  const deliveryId = request.headers.get("x-github-delivery");
  const eventType = request.headers.get("x-github-event");
  if (
    !deliveryId ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(deliveryId) ||
    !eventType ||
    !/^[a-z_]{1,100}$/.test(eventType)
  )
    return NextResponse.json(
      { error: "Invalid webhook headers" },
      { status: 400 },
    );
  let payload: z.infer<typeof Payload>;
  try {
    payload = Payload.parse(JSON.parse(body.toString("utf8")));
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook payload" },
      { status: 400 },
    );
  }
  try {
    const [processed] = await db()
      .select({ status: webhookDeliveries.status })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.provider, "github"),
          eq(webhookDeliveries.deliveryId, deliveryId),
        ),
      );
    if (processed?.status === "processed")
      return NextResponse.json(
        { accepted: true, duplicate: true },
        { status: 202 },
      );
    if (eventType === "installation_repositories" && payload.installation) {
      const [installation] = await db()
        .select()
        .from(githubInstallations)
        .where(eq(githubInstallations.installationId, payload.installation.id));
      if (installation)
        await reconcileGitHubRepositories(
          installation.organizationId,
          installation.installationId,
        );
    }
    const duplicate = await db().transaction(async (tx) => {
      const inserted = await tx
        .insert(webhookDeliveries)
        .values({
          id: `wh_${randomUUID()}`,
          provider: "github",
          deliveryId,
          signatureValid: true,
          eventType,
          status: "received",
          payload,
        })
        .onConflictDoNothing({
          target: [webhookDeliveries.provider, webhookDeliveries.deliveryId],
        })
        .returning({ id: webhookDeliveries.id });
      if (!inserted.length) return true;
      const installationId = payload.installation?.id;
      if (installationId) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${installationId}::bigint)`,
        );
        const [installation] = await tx
          .select()
          .from(githubInstallations)
          .where(eq(githubInstallations.installationId, installationId));
        if (installation) {
          const now = new Date().toISOString();
          if (
            eventType === "installation" &&
            ["deleted", "suspend", "unsuspend"].includes(payload.action ?? "")
          ) {
            const status =
              payload.action === "deleted"
                ? "revoked"
                : payload.action === "suspend"
                  ? "suspended"
                  : "active";
            await tx
              .update(githubInstallations)
              .set({
                status,
                suspendedAt: status === "suspended" ? now : null,
                updatedAt: now,
              })
              .where(eq(githubInstallations.id, installation.id));
            await tx
              .update(integrationAccounts)
              .set({ status, updatedAt: now })
              .where(
                and(
                  eq(
                    integrationAccounts.organizationId,
                    installation.organizationId,
                  ),
                  eq(integrationAccounts.kind, "github"),
                  eq(
                    integrationAccounts.externalAccountId,
                    String(installationId),
                  ),
                ),
              );
            if (status !== "active")
              await tx
                .update(repositories)
                .set({ archived: true, updatedAt: now })
                .where(
                  and(
                    eq(
                      repositories.organizationId,
                      installation.organizationId,
                    ),
                    eq(repositories.githubInstallationId, installation.id),
                  ),
                );
          }
          if (
            eventType === "pull_request" &&
            payload.pull_request &&
            payload.repository
          ) {
            const [authorizedRepo] = await tx
              .select()
              .from(repositories)
              .where(
                and(
                  eq(repositories.organizationId, installation.organizationId),
                  eq(repositories.githubInstallationId, installation.id),
                  eq(repositories.githubRepositoryId, payload.repository.id),
                ),
              );
            if (authorizedRepo)
              await tx
                .update(pullRequests)
                .set({
                  state: payload.pull_request.merged
                    ? "merged"
                    : payload.pull_request.state,
                  ...(payload.pull_request.head
                    ? { headSha: payload.pull_request.head.sha }
                    : {}),
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(pullRequests.githubRepositoryId, payload.repository.id),
                    eq(pullRequests.number, payload.pull_request.number),
                    sql`${pullRequests.taskId} in (select ${tasks.id} from ${tasks} where ${tasks.organizationId} = ${installation.organizationId} and ${tasks.repositoryId} = ${authorizedRepo.id})`,
                  ),
                );
          }
        }
      }
      const handled =
        eventType === "ping" ||
        (eventType === "installation" &&
          ["deleted", "suspend", "unsuspend"].includes(payload.action ?? "")) ||
        (eventType === "installation_repositories" &&
          ["added", "removed"].includes(payload.action ?? "")) ||
        eventType === "pull_request";
      await tx
        .update(webhookDeliveries)
        .set({
          status: handled ? "processed" : "received",
          processedAt: handled ? new Date().toISOString() : null,
        })
        .where(
          and(
            eq(webhookDeliveries.provider, "github"),
            eq(webhookDeliveries.deliveryId, deliveryId),
          ),
        );
      return false;
    });
    return NextResponse.json({ accepted: true, duplicate }, { status: 202 });
  } catch {
    return NextResponse.json(
      { error: "Webhook persistence failed. Retry this delivery." },
      { status: 503 },
    );
  }
}
