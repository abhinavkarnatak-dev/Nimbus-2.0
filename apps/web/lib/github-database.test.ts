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
  added: false,
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
    hasGitHubAppConfig: () => true,
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
      async listInstallationRepositories() {
        const repos = await this.listUserRepositories();
        return fixture.added
          ? repos.map((repo) => ({
              ...repo,
              id: 9_000_000_003,
              name: "added-repo",
              fullName: "test-owner/added-repo",
            }))
          : repos;
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
      vi.stubEnv("GITHUB_APP_SLUG", "nimbus-test-app");
      vi.stubEnv(
        "GITHUB_APP_CALLBACK_URL",
        "http://localhost:3000/api/github/callback",
      );
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

    it("connects through one installation redirect and imports repositories on return", async () => {
      const { POST } = await import("../app/api/github/connect/route.js");
      const { GET } = await import("../app/api/github/callback/route.js");
      const response = await POST(
        new Request("http://localhost:3000/api/github/connect", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
      );
      expect(response.status).toBe(303);
      const target = new URL(response.headers.get("location")!);
      expect(target.origin).toBe("https://github.com");
      expect(target.pathname).toBe("/apps/nimbus-test-app/installations/new");
      const state = target.searchParams.get("state")!;
      expect(state.length).toBeGreaterThan(30);
      const cookie = response.headers.get("set-cookie")!;
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Path=/api/github");
      fixture.browserToken = /nimbus_github_oauth=([^;]+)/.exec(cookie)![1]!;
      const [pending] = await db()
        .select()
        .from(githubAuthorizations)
        .where(eq(githubAuthorizations.stateHash, hashGitHubState(state)));
      expect(pending?.browserHash).toBe(hashGitHubState(fixture.browserToken));
      expect(pending?.consumedAt).toBeNull();
      const request = () =>
        new Request(
          `http://localhost:3000/api/github/callback?state=${state}&code=simulated-code&installation_id=${fixture.installationId}`,
        );
      const completed = await GET(request());
      expect(completed.status).toBe(303);
      expect(completed.headers.get("location")).toBe("/settings#connections");
      expect((await GET(request())).status).toBe(400);
      const rows = await db()
        .select()
        .from(repositories)
        .where(eq(repositories.organizationId, fixture.organizationId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.fullName).toBe("test-owner/test-repo");
    });

    it("rejects cross-origin connect requests before creating state", async () => {
      const { POST } = await import("../app/api/github/connect/route.js");
      const response = await POST(
        new Request("http://localhost:3000/api/github/connect", {
          method: "POST",
          headers: { origin: "https://untrusted.example" },
        }),
      );
      expect(response.status).toBe(403);
    });

    it("rejects malformed and inaccessible installation IDs", async () => {
      const { GET } = await import("../app/api/github/callback/route.js");
      for (const [installation, status] of [
        ["1e3", 400],
        ["42", 409],
      ] as const) {
        const state = await authorization();
        const response = await GET(
          new Request(
            `http://localhost:3000/api/github/callback?state=${state}&code=simulated-code&installation_id=${installation}`,
          ),
        );
        expect(response.status).toBe(status);
      }
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

    it("reconciles additions, removals, repeat sync, and tenant isolation", async () => {
      const { reconcileGitHubRepositories } = await import(
        "./github-repositories.js"
      );
      fixture.added = true;
      expect(
        (await reconcileGitHubRepositories(fixture.organizationId))
          .repositories,
      ).toBe(1);
      await reconcileGitHubRepositories(fixture.organizationId);
      const rows = await db()
        .select()
        .from(repositories)
        .where(eq(repositories.organizationId, fixture.organizationId));
      expect(rows).toHaveLength(2);
      expect(rows.find((repo) => repo.name === "test-repo")?.archived).toBe(
        true,
      );
      expect(rows.find((repo) => repo.name === "added-repo")?.archived).toBe(
        false,
      );
      expect(
        await reconcileGitHubRepositories(
          "unrelated-tenant",
          fixture.installationId,
        ),
      ).toEqual({ installations: 0, repositories: 0 });
      fixture.added = false;
      await reconcileGitHubRepositories(fixture.organizationId);
    });

    it("refreshes changed repository access with one POST behind a public tunnel", async () => {
      const { POST } = await import("../app/api/github/sync/route.js");
      vi.stubEnv("AUTH_URL", "https://nimbus-refresh.example");
      fixture.added = true;
      try {
        const response = await POST(
          new Request("http://localhost:3000/api/github/sync", {
            method: "POST",
            headers: { origin: "https://nimbus-refresh.example" },
          }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          installations: 1,
          repositories: 1,
        });
        const rows = await db()
          .select()
          .from(repositories)
          .where(eq(repositories.organizationId, fixture.organizationId));
        expect(rows.find((repo) => repo.name === "added-repo")?.archived).toBe(
          false,
        );
        expect(rows.find((repo) => repo.name === "test-repo")?.archived).toBe(
          true,
        );
        const { listAvailableRepositories } = await import(
          "./available-repositories.js"
        );
        expect(
          (await listAvailableRepositories(fixture.organizationId)).map(
            (repo) => repo.fullName,
          ),
        ).toEqual(["test-owner/added-repo"]);
        expect(await listAvailableRepositories("unrelated-tenant")).toEqual([]);
      } finally {
        fixture.added = false;
        vi.stubEnv("AUTH_URL", "http://localhost:3000");
        const { reconcileGitHubRepositories } = await import(
          "./github-repositories.js"
        );
        await reconcileGitHubRepositories(fixture.organizationId);
      }
    });

    it("reconciles signed added webhook snapshots and deduplicates delivery", async () => {
      const { POST } = await import("../app/api/github/webhooks/route.js");
      fixture.added = true;
      const body = JSON.stringify({
        action: "added",
        installation: { id: fixture.installationId },
        repositories_added: [{ id: 9_000_000_003 }],
      });
      const delivery = randomUUID();
      deliveryIds.push(delivery);
      const request = () =>
        new Request("http://localhost/api/github/webhooks", {
          method: "POST",
          body,
          headers: {
            "x-github-delivery": delivery,
            "x-github-event": "installation_repositories",
            "x-hub-signature-256": `sha256=${createHmac("sha256", "database-test-webhook-secret").update(body).digest("hex")}`,
          },
        });
      expect((await POST(request())).status).toBe(202);
      expect((await (await POST(request())).json()).duplicate).toBe(true);
      const rows = await db()
        .select()
        .from(repositories)
        .where(eq(repositories.organizationId, fixture.organizationId));
      expect(rows.find((repo) => repo.name === "added-repo")?.archived).toBe(
        false,
      );
      fixture.added = false;
      const { reconcileGitHubRepositories } = await import(
        "./github-repositories.js"
      );
      await reconcileGitHubRepositories(fixture.organizationId);
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
