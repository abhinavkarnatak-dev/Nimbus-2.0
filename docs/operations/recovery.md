# Recovery

PostgreSQL is restored first and is authoritative. Workers rebuild Redis leases and counters from durable task state. Reconciliation finds stale running tasks, verifies worker heartbeats, validates workspace availability, and resumes from the last confirmed Codex event sequence.

Retries reuse idempotency keys for workspace provision, branch push, pull request creation, and notifications. A recovery never marks a turn successful without an official completed event and recorded verification evidence.
