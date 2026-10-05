# ADR 0002: PostgreSQL is the source of truth

Status: Accepted

## Decision

PostgreSQL 17 stores control-plane state, ordered task events, workflow references, idempotency records, and the transactional outbox. Drizzle provides migrations and typed access. pgvector stores permitted memory embeddings.

Redis is limited to leases, refresh locks, rate counters, and short-lived coordination. A Redis loss can reduce availability but cannot change the truth of task ownership or completion.

No network call occurs inside a database transaction.
