import { randomUUID } from "node:crypto";
import { db, sql } from "@nimbus/database";
import {
  emailConfiguration,
  EmailDeliveryError,
  PrEmail,
  sendPrEmail,
} from "./pr-email";

// Reconcile durable sources instead of adding email dependencies to PR/Codex code.
// A singleton activation timestamp prevents sending a backlog of old PR emails.
export async function reconcilePrEmails() {
  await db().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('nimbus-pr-emails'))`,
    );
    await tx.execute(
      sql`insert into email_notification_settings (id) values ('pr') on conflict do nothing`,
    );
    await tx.execute(sql`
      insert into email_notifications (id, pull_request_id, recipient_user_id, event, payload)
      select 'pr-created-' || p.id, p.id, u.id, 'created',
        jsonb_build_object('event','created','recipient',u.email,'name',u.name,
          'title',p.title,'repository',r.full_name,'number',p.number,'url',p.url,'taskId',t.id)
      from pull_requests p
      join tasks t on t.id = p.task_id
      join repositories r on r.id = t.repository_id and r.organization_id = t.organization_id
      join users u on u.id = t.created_by_user_id
      where p.created_at >= (select enabled_at from email_notification_settings where id = 'pr')
        and p.number is not null and p.url is not null
        and not exists (select 1 from email_notifications e where e.id = 'pr-created-' || p.id)
      order by p.created_at limit 100
      on conflict do nothing
    `);
    await tx.execute(sql`
      insert into email_notifications (id, pull_request_id, recipient_user_id, event, payload)
      select distinct on (candidate.id) candidate.id, candidate.pr_id, candidate.user_id, candidate.event, candidate.payload
      from (
        select case when w.payload->'pull_request'->>'merged' = 'true'
            then 'pr-merged-' || p.id else 'pr-closed-' || p.id || '-' || md5(w.delivery_id) end as id,
          p.id as pr_id, u.id as user_id,
          case when w.payload->'pull_request'->>'merged' = 'true' then 'merged' else 'closed' end as event,
          jsonb_build_object('event', case when w.payload->'pull_request'->>'merged' = 'true' then 'merged' else 'closed' end,
            'recipient',u.email,'name',u.name,'title',p.title,'repository',r.full_name,
            'number',p.number,'url',p.url,'taskId',t.id) as payload
        from webhook_deliveries w
        join github_installations i on i.installation_id::text = w.payload->'installation'->>'id'
        join repositories r on r.github_installation_id = i.id and r.organization_id = i.organization_id
          and r.github_repository_id::text = w.payload->'repository'->>'id'
        join tasks t on t.repository_id = r.id and t.organization_id = i.organization_id
        join pull_requests p on p.task_id = t.id and p.github_repository_id = r.github_repository_id
          and p.number::text = w.payload->'pull_request'->>'number'
        join users u on u.id = t.created_by_user_id
        where w.provider = 'github' and w.signature_valid = true and w.status = 'processed'
          and w.event_type = 'pull_request' and w.payload->>'action' = 'closed'
          and w.received_at >= (select enabled_at from email_notification_settings where id = 'pr')
          and p.url is not null
      ) candidate
      where not exists (select 1 from email_notifications e where e.id = candidate.id)
      order by candidate.id limit 100
      on conflict do nothing
    `);
  });
}

export function retryEmail(
  attempts: number,
  firstAttemptAt: string,
  error: unknown,
  now = Date.now(),
) {
  // Resend keys expire after 24h. Stop before that boundary even following downtime.
  return (
    error instanceof EmailDeliveryError &&
    error.retryable &&
    attempts < 8 &&
    now - new Date(firstAttemptAt).getTime() < 23 * 60 * 60_000
  );
}

export async function processPrEmails() {
  const config = emailConfiguration();
  if (!config) return { enabled: false, sent: 0, failed: 0 };
  await reconcilePrEmails();
  let sent = 0;
  let failed = 0;
  // Keep each authenticated worker request bounded; leases recover after crashes.
  for (let index = 0; index < 3; index++) {
    const token = randomUUID();
    const rows = await db().execute(sql`
      with candidate as (
        select id from email_notifications
        where status in ('pending','sending') and available_at <= now()
          and (lease_until is null or lease_until < now())
        order by created_at, id for update skip locked limit 1
      )
      update email_notifications e set status = 'sending', attempts = attempts + 1,
        first_attempt_at = coalesce(first_attempt_at, now()), lease_until = now() + interval '2 minutes',
        lease_token = ${token}, updated_at = now()
      from candidate where e.id = candidate.id
      returning e.id, e.payload, e.attempts, e.first_attempt_at
    `);
    const row = rows[0] as
      | {
          id: string;
          payload: unknown;
          attempts: number;
          first_attempt_at: string | Date;
        }
      | undefined;
    if (!row) break;
    const firstAttempt = new Date(row.first_attempt_at).toISOString();
    let accepted = false;
    try {
      if (
        row.attempts > 8 ||
        Date.now() - new Date(firstAttempt).getTime() >= 23 * 60 * 60_000
      )
        throw new EmailDeliveryError(
          false,
          "Email retry window expired; manual review required",
        );
      const messageId = await sendPrEmail(
        PrEmail.parse(row.payload),
        row.id,
        config,
      );
      accepted = true;
      await db()
        .execute(sql`update email_notifications set status = 'sent', sent_at = now(),
        provider_message_id = ${messageId}, lease_until = null, lease_token = null, last_error = null, updated_at = now()
        where id = ${row.id} and lease_token = ${token}`);
      sent++;
    } catch (error) {
      // If acceptance was confirmed but the DB write failed, retain the lease.
      // Recovery retries with the same Resend key rather than marking a false failure.
      if (accepted) throw error;
      const retry = retryEmail(row.attempts, firstAttempt, error);
      const delay = Math.min(300, 15 * 2 ** Math.min(row.attempts, 8));
      // Do not save raw provider/network exceptions: they may contain sensitive data.
      const message =
        error instanceof EmailDeliveryError
          ? error.message
          : "Invalid email payload or delivery persistence failed";
      await db()
        .execute(sql`update email_notifications set status = ${retry ? "pending" : "failed"},
        available_at = now() + ${delay} * interval '1 second', lease_until = null, lease_token = null,
        last_error = ${message}, updated_at = now() where id = ${row.id} and lease_token = ${token}`);
      failed++;
    }
  }
  return { enabled: true, sent, failed };
}
