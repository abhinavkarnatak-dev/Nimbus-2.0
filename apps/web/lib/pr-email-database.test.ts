import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db, closeDatabase, sql } from "@nimbus/database";
import { processPrEmails, reconcilePrEmails } from "./pr-email-outbox";

// Only a dedicated disposable database is allowed; never use the app DATABASE_URL.
const target = process.env.EMAIL_DATABASE_TEST_URL;
const allowed =
  target &&
  new URL(target).hostname === "127.0.0.1" &&
  new URL(target).port === "57532";
describe.skipIf(!allowed)(
  "PR email durable reconciliation and delivery",
  () => {
    beforeAll(async () => {
      vi.stubEnv("DATABASE_URL", target!);
      vi.stubEnv("RESEND_API_KEY", "re_test");
      vi.stubEnv("RESEND_FROM_EMAIL", "Nimbus <notify@example.com>");
      vi.stubEnv("AUTH_URL", "https://nimbus.example.com");
      await db().execute(
        sql.raw(`
      create table users (id text primary key, email text, name text);
      create table github_installations (id text primary key, installation_id bigint, organization_id text);
      create table repositories (id text primary key, github_installation_id text, organization_id text, github_repository_id bigint, full_name text);
      create table tasks (id text primary key, repository_id text, organization_id text, created_by_user_id text);
      create table pull_requests (id text primary key, task_id text, github_repository_id bigint, number integer, title text, url text, created_at timestamptz default now());
      create table webhook_deliveries (id text primary key, provider text default 'github', delivery_id text, signature_valid boolean default true, status text default 'processed', event_type text default 'pull_request', payload jsonb, received_at timestamptz default now());
    `),
      );
      await db().execute(
        sql.raw(
          await readFile(
            resolve(
              process.cwd(),
              "../../packages/database/migrations/0012_pr_email_notifications.sql",
            ),
            "utf8",
          ),
        ),
      );
    });
    beforeEach(async () => {
      vi.unstubAllGlobals();
      await db().execute(
        sql.raw(`truncate email_notifications, email_notification_settings, pull_requests, users, tasks, repositories, github_installations, webhook_deliveries cascade;
      insert into users values ('u1','one@example.com','One'), ('u2','two@example.com','Two');
      insert into github_installations values ('i1',100,'org1'),('i2',200,'org2');
      insert into repositories values ('r1','i1','org1',10,'owner/repo'), ('r2','i2','org2',20,'other/repo');
      insert into tasks values ('task_1','r1','org1','u1'), ('task_2','r2','org2','u2');
    `),
      );
      await reconcilePrEmails();
    });
    afterAll(async () => {
      await closeDatabase();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });
    const addPr = async (id = "p1", number = 1) =>
      db().execute(
        sql`insert into pull_requests values (${id}, 'task_1', 10, ${number}, 'Fix layout', ${`https://github.com/owner/repo/pull/${number}`}, now())`,
      );
    const addWebhook = async (
      id: string,
      merged: boolean,
      installation = 100,
      signed = true,
    ) => {
      const payload = JSON.stringify({
        action: "closed",
        installation: { id: installation },
        repository: { id: 10 },
        pull_request: { number: 1, state: "closed", merged },
      });
      await db().execute(
        sql`insert into webhook_deliveries (id,delivery_id,payload,signature_valid) values (${id},${id},${payload}::jsonb,${signed})`,
      );
    };
    const emails = async () =>
      db().execute(sql`select * from email_notifications order by id`);

    it("excludes historical PRs and deduplicates creation for the correct recipient", async () => {
      await db().execute(
        sql`insert into pull_requests values ('old','task_1',10,2,'Old','https://github.com/owner/repo/pull/2',now()-interval '1 day')`,
      );
      await addPr();
      await reconcilePrEmails();
      await reconcilePrEmails();
      const rows = await emails();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.recipient_user_id).toBe("u1");
      expect((rows[0]!.payload as { recipient: string }).recipient).toBe(
        "one@example.com",
      );
    });
    it("handles early merge webhooks, excludes unsigned/cross-tenant events, and deduplicates merges", async () => {
      await addWebhook("early", true);
      await reconcilePrEmails();
      expect(await emails()).toHaveLength(0);
      await addPr();
      await addWebhook("duplicate-merge", true);
      await addWebhook("unsigned", false, 100, false);
      await addWebhook("wrong-tenant", false, 200);
      await reconcilePrEmails();
      await reconcilePrEmails();
      const rows = await emails();
      expect(rows.map((r) => r.event).sort()).toEqual(["created", "merged"]);
    });
    it("deduplicates closed deliveries and distinguishes close from merge", async () => {
      await addPr();
      await addWebhook("closed", false);
      await reconcilePrEmails();
      await reconcilePrEmails();
      expect((await emails()).map((r) => r.event).sort()).toEqual([
        "closed",
        "created",
      ]);
    });
    it("concurrent workers accept each email once and preserve stable keys", async () => {
      await addPr();
      await addWebhook("merge", true);
      const fetcher = vi
        .fn()
        .mockImplementation(async () => Response.json({ id: "mail_1" }));
      vi.stubGlobal("fetch", fetcher);
      await Promise.all([processPrEmails(), processPrEmails()]);
      expect(fetcher).toHaveBeenCalledTimes(2);
      const keys = fetcher.mock.calls.map(
        (call) => call[1].headers["idempotency-key"],
      );
      expect(new Set(keys).size).toBe(2);
      expect((await emails()).every((row) => row.status === "sent")).toBe(true);
      await processPrEmails();
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
    it("retries transient failures but isolates permanent failures", async () => {
      await addPr();
      const fetcher = vi
        .fn()
        .mockResolvedValue(new Response("rate limit", { status: 429 }));
      vi.stubGlobal("fetch", fetcher);
      await processPrEmails();
      expect((await emails())[0]!.status).toBe("pending");
      await db().execute(
        sql`update email_notifications set available_at = now()`,
      );
      fetcher.mockResolvedValue(Response.json({ id: "mail_1" }));
      await processPrEmails();
      expect((await emails())[0]!.status).toBe("sent");
      expect(fetcher.mock.calls[0]![1].headers["idempotency-key"]).toBe(
        fetcher.mock.calls[1]![1].headers["idempotency-key"],
      );
      await addPr("p2", 2);
      fetcher.mockResolvedValue(new Response("secret-body", { status: 401 }));
      await processPrEmails();
      const rows = await emails();
      expect(rows[1]!.status).toBe("failed");
      expect(rows[1]!.last_error).toBe("Resend HTTP 401");
    });
    it("recovers expired leases but never resends beyond the idempotency window", async () => {
      await addPr();
      await reconcilePrEmails();
      await db().execute(
        sql`update email_notifications set status='sending', lease_until=now()-interval '1 minute', first_attempt_at=now()-interval '24 hours'`,
      );
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      await processPrEmails();
      expect(fetcher).not.toHaveBeenCalled();
      expect((await emails())[0]!.status).toBe("failed");
    });
  },
);
