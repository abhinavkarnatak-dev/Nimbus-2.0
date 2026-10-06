# PR email notifications

Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in the web environment (locally `apps/web/.env.local`, on Render the combined service's Environment page). The sender must use a domain verified by Resend. `AUTH_URL` supplies task links. Never use `NEXT_PUBLIC_` for the key. No Resend secrets are passed to Codex or the executor.

Run `pnpm db:migrate` before deploying this change. Migration 0012 adds only notification tables; it does not alter Codex, tasks, or existing PR tables.

The executor polls a secret-protected web endpoint every 15 seconds independently of task execution. Missing email configuration disables processing. Missing migrations, invalid configuration, provider errors, and network failures affect only emails. PR publishing, GitHub webhook processing and Codex authentication remain unchanged.

Recipients are the Nimbus users who created the associated tasks (their saved sign-in email). No emails are sent for unrelated GitHub PRs. A durable activation timestamp is recorded on the first configured poll; older PRs/events are excluded. Created emails come from saved PR records, so an early GitHub `opened` webhook cannot lose them. Merged/closed emails come from signature-verified, processed GitHub `pull_request` webhooks, matched to the installation, organization, repository and Nimbus PR. Ensure your GitHub App subscribes to Pull request events.

Merged PRs get a merged email, not an additional closed email. Creation and merge are deduplicated per PR; each closed webhook delivery is deduplicated by its delivery ID (a reopened then closed PR can send another closed update). Duplicate GitHub deliveries and worker polls do not create extra rows.

Delivery uses database leases and stable Resend idempotency keys. Transient failures retry up to eight attempts with backoff; permanent failures become `failed`. Retries stop 23 hours after the first attempt because Resend idempotency keys expire after 24 hours. Check `email_notifications.status`, `attempts` and `last_error` for failures. A `sent` row means Resend accepted the email, not guaranteed inbox delivery. Do not blindly resend expired/ambiguous entries.

Free Render sleeping delays notifications until the service wakes. Pending notifications survive service restarts in Postgres. Data for reconciliation is currently scanned in batches; at larger volume add indexed source cursors.

## Send a test

From the repository root:

```powershell
pnpm --filter @nimbus/executor exec tsx ../../scripts/test-pr-email.ts --to=you@example.com
```

The script sends one clearly labeled sample created email, without creating a real PR, changing user/task data, or using Codex. Add `--event=merged` or `--event=closed` to test other templates. It refuses to send without an explicit recipient.

Official references: [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email), [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
