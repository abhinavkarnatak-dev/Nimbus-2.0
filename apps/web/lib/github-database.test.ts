import { createHmac, randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import {
  db,
  eq,
  users,
  organizations,
  githubAuthorizations,
  githubInstallations,
  repositories,
  webhookDeliveries,
  integrationAccounts,
  auditLogs,
  closeDatabase,
} from "@nimbus/database";
import { hashGitHubState } from "./github-security";

const fixture = vi.hoisted(() => ({
  userId: `github_test_user_${Date.now()}`,
  organizationId: `github_test_org_${Date.now()}`,
  browserToken: "test-browser-token",
  installationId: 9_000_000_001,
}));
vi.mock("@/lib/auth", () => ({
  SESSION_COOKIE: "nimbus_session",
  currentIdentity: async () => ({
    userId: fixture.userId,
    organizationId: fixture.organizationId,
    role: "owner",
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: fixture.browserToken }) }),
}));
vi.mock("@nimbus/github", async (original) => {
  const actual = await original<typeof import("@nimbus/github")>();
  return {
    ...actual,
    loadGitHubAppConfig: () => ({}),
    GitHubAppClient: class {
      async exchangeUserCode() {
        return "simulated-github-token";
      }
      async listUserInstallations() {
        return [
          {
            id: fixture.installationId,
            account: { id: 1, login: "test-owner" },
            suspendedAt: null,
          },
        ];
      }
      async getInstallation() {
        return {
          id: fixture.installationId,
          account: { id: 1, login: "test-owner" },
          suspendedAt: null,
        };
      }
      async listUserRepositories() {
        return [
          {
            id: 9_000_000_002,
            owner: "test-owner",
            name: "test-repo",
            fullName: "test-owner/test-repo",
            defaultBranch: "main",
            private: true,
            archived: false,
          },
        ];
      }
    },
  };
});

const enabled = process.env.NIMBUS_GITHUB_DATABASE_TEST === "true";
describe.runIf(enabled)(
  "GitHub routes against PostgreSQL with simulated GitHub responses",
  () => {
    const deliveryIds: string[] = [];
    beforeAll(async () => {
      vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "database-test-webhook-secret");
      await db()
        .insert(users)
        .values({
          id: fixture.userId,
          name: "GitHub test",
          email: `${fixture.userId}@example.invalid`,
        });
      await db().insert(organizations).values({
        id: fixture.organizationId,
        slug: fixture.organizationId,
        name: "GitHub tests",
      });
    });
    afterAll(async () => {
      await db()
        .delete(auditLogs)
        .where(eq(auditLogs.organizationId, fixture.organizationId));
      await db()
        .delete(repositories)
        .where(eq(repositories.organizationId, fixture.organizationId));
      await db()
        .delete(integrationAccounts)
        .where(eq(integrationAccounts.organizationId, fixture.organizationId));
      await db()
        .delete(githubInstallations)
        .where(eq(githubInstallations.organizationId, fixture.organizationId));
      for (const delivery of deliveryIds)
        await db()
          .delete(webhookDeliveries)
          .where(eq(webhookDeliveries.deliveryId, delivery));
      await db()
        .delete(organizations)
        .where(eq(organizations.id, fixture.organizationId));
      await db().delete(users).where(eq(users.id, fixture.userId));
      await closeDatabase();
      vi.unstubAllEnvs();
    });

    async function authorization(
      browserToken = fixture.browserToken,
      lifetime = 60000,
    ) {
      const state = randomUUID();
      await db()
        .insert(githubAuthorizations)
        .values({
          stateHash: hashGitHubState(state),
          userId: fixture.userId,
          organizationId: fixture.organizationId,
          browserHash: hashGitHubState(browserToken),
          redirectUri: "http://localhost:3000/api/github/callback",
          expiresAt: new Date(Date.now() + lifetime).toISOString(),
        });
      return state;
    }

    it("imports real durable repository records and rejects callback replay", async () => {
      const { GET } = await import("../app/api/github/callback/route.js");
      const state = await authorization();
      const request = () =>
        new Request(
          `http://localhost:3000/api/github/callback?state=${state}&code=simulated-code`,
        );
      expect((await GET(request())).status).toBe(303);
      expect((await GET(request())).status).toBe(400);
      const rows = await db()
        .select()
        .from(repositories)
        .where(eq(repositories.organizationId, fixture.organizationId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.fullName).toBe("test-owner/test-repo");
    });

    it("rejects expired state and state belonging to another browser", async () => {
      const { GET } = await import("../app/api/github/callback/route.js");
      for (const state of [
        await authorization("other-browser"),
        await authorization(fixture.browserToken, -1000),
      ]) {
        expect(
          (
            await GET(
              new Request(
                `http://localhost:3000/api/github/callback?state=${state}&code=simulated-code`,
              ),
            )
          ).status,
        ).toBe(400);
      }
    });

    it("persists signed deliveries once and applies suspension atomically", async () => {
      const { POST } = await import("../app/api/github/webhooks/route.js");
      const body = JSON.stringify({
        action: "suspend",
        installation: { id: fixture.installationId },
      });
      const delivery = randomUUID();
      deliveryIds.push(delivery);
      const signature = `sha256=${createHmac("sha256", "database-test-webhook-secret").update(body).digest("hex")}`;
      const request = () =>
        new Request("http://localhost/api/github/webhooks", {
          method: "POST",
          body,
          headers: {
            "x-github-delivery": delivery,
            "x-github-event": "installation",
            "x-hub-signature-256": signature,
          },
        });
      const results = await Promise.all([POST(request()), POST(request())]);
      expect(results.map((response) => response.status)).toEqual([202, 202]);
      const data = await Promise.all(
        results.map((response) => response.json()),
      );
      expect(data.filter((result) => result.duplicate)).toHaveLength(1);
      const [installation] = await db()
        .select()
        .from(githubInstallations)
        .where(eq(githubInstallations.installationId, fixture.installationId));
      expect(installation?.status).toBe("suspended");
      const [repo] = await db()
        .select()
        .from(repositories)
        .where(eq(repositories.organizationId, fixture.organizationId));
      expect(repo?.archived).toBe(true);
    });
  },
);
