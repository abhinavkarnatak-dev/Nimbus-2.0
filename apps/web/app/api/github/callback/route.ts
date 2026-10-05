import { randomUUID } from "node:crypto";
import {
  and,
  db,
  eq,
  gt,
  isNull,
  githubAuthorizations,
  githubInstallations,
  repositories,
  integrationAccounts,
  auditLogs,
  sql,
} from "@nimbus/database";
import { GitHubAppClient, loadGitHubAppConfig } from "@nimbus/github";
import { currentIdentity, SESSION_COOKIE } from "@/lib/auth";
import { hashGitHubState } from "@/lib/github-security";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const identity = await currentIdentity();
  const browserToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!identity || !browserToken)
    return NextResponse.json(
      {
        error:
          "Sign in to Nimbus in the same browser and start GitHub connection again",
      },
      { status: 401 },
    );
  if (!["owner", "admin"].includes(identity.role))
    return NextResponse.json(
      { error: "Organization administrator required" },
      { status: 403 },
    );
  const query = new URL(request.url).searchParams;
  const state = query.get("state");
  if (!state || state.length > 200)
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  const [authorization] = await db()
    .update(githubAuthorizations)
    .set({ consumedAt: new Date().toISOString() })
    .where(
      and(
        eq(githubAuthorizations.stateHash, hashGitHubState(state)),
        eq(githubAuthorizations.userId, identity.userId),
        eq(githubAuthorizations.organizationId, identity.organizationId),
        eq(githubAuthorizations.browserHash, hashGitHubState(browserToken)),
        isNull(githubAuthorizations.consumedAt),
        gt(githubAuthorizations.expiresAt, new Date().toISOString()),
      ),
    )
    .returning();
  if (!authorization)
    return NextResponse.json(
      {
        error:
          "OAuth state is expired, already used, or belongs to another session",
      },
      { status: 400 },
    );
  if (query.has("error"))
    return NextResponse.json(
      { error: "GitHub authorization was declined. Start again to retry." },
      { status: 400 },
    );
  const code = query.get("code");
  if (!code || code.length > 500)
    return NextResponse.json(
      { error: "GitHub authorization code is missing" },
      { status: 400 },
    );
  try {
    const client = new GitHubAppClient(loadGitHubAppConfig());
    const userToken = await client.exchangeUserCode(
      code,
      authorization.redirectUri,
    );
    const accessible = (await client.listUserInstallations(userToken)).filter(
      (item) => !item.suspendedAt,
    );
    const requested = query.get("installation_id");
    const selected = requested
      ? accessible.find((item) => item.id === Number(requested))
      : accessible.length === 1
        ? accessible[0]
        : undefined;
    if (!selected)
      return NextResponse.json(
        {
          error:
            "Install the GitHub App on your test repository first. For this connection, authorize an account with one active installation.",
        },
        { status: 409 },
      );
    const verified = await client.getInstallation(selected.id);
    if (verified.suspendedAt || verified.account.id !== selected.account.id)
      return NextResponse.json(
        { error: "GitHub installation is unavailable" },
        { status: 403 },
      );
    const repos = await client.listUserRepositories(userToken, selected.id);
    const installationKey = `ghi_${selected.id}`;
    await db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${selected.id}::bigint)`,
      );
      const [existing] = await tx
        .select()
        .from(githubInstallations)
        .where(eq(githubInstallations.installationId, selected.id));
      if (existing && existing.organizationId !== identity.organizationId)
        throw new Error("installation_tenant_conflict");
      await tx
        .insert(githubInstallations)
        .values({
          id: installationKey,
          organizationId: identity.organizationId,
          installationId: selected.id,
          accountLogin: selected.account.login,
        })
        .onConflictDoUpdate({
          target: githubInstallations.installationId,
          set: {
            status: "active",
            suspendedAt: null,
            updatedAt: new Date().toISOString(),
          },
        });
      await tx
        .update(repositories)
        .set({ archived: true, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(repositories.organizationId, identity.organizationId),
            eq(
              repositories.githubInstallationId,
              existing?.id ?? installationKey,
            ),
          ),
        );
      for (const repo of repos)
        await tx
          .insert(repositories)
          .values({
            id: `repo_${randomUUID().replaceAll("-", "")}`,
            organizationId: identity.organizationId,
            githubInstallationId: existing?.id ?? installationKey,
            githubRepositoryId: repo.id,
            owner: repo.owner,
            name: repo.name,
            fullName: repo.fullName,
            defaultBranch: repo.defaultBranch,
            private: repo.private,
            archived: repo.archived,
          })
          .onConflictDoUpdate({
            target: [repositories.organizationId, repositories.fullName],
            set: {
              githubInstallationId: existing?.id ?? installationKey,
              githubRepositoryId: repo.id,
              defaultBranch: repo.defaultBranch,
              private: repo.private,
              archived: repo.archived,
              updatedAt: new Date().toISOString(),
            },
          });
      await tx
        .insert(integrationAccounts)
        .values({
          id: `gia_${selected.id}`,
          organizationId: identity.organizationId,
          userId: identity.userId,
          kind: "github",
          externalAccountId: String(selected.id),
          scopes: ["contents:write", "pull_requests:write", "checks:read"],
          status: "active",
        })
        .onConflictDoUpdate({
          target: integrationAccounts.id,
          set: { status: "active", updatedAt: new Date().toISOString() },
        });
      await tx.insert(auditLogs).values({
        id: `aud_${randomUUID()}`,
        organizationId: identity.organizationId,
        actorType: "user",
        actorId: identity.userId,
        action: "github.connect",
        targetType: "github_installation",
        targetId: existing?.id ?? installationKey,
        correlationId: randomUUID(),
        metadata: { repositoryCount: repos.length },
      });
    });
    return new NextResponse(null, {
      status: 303,
      headers: { location: "/repositories", "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "GitHub connection failed. Check App configuration and installation access, then start again.",
      },
      { status: 502 },
    );
  }
}
