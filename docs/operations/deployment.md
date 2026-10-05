# Deployment

Production uses Node.js 24, PostgreSQL 17 with pgvector, managed Redis, Vercel Blob or S3-compatible storage, Vercel Sandbox, and PostHog. Schema migration runs as a separate release step before new workers accept traffic.

Deployments use graceful shutdown, worker heartbeats, stale-task reconciliation, feature flags, integration kill switches, and rollback-compatible migrations. Secrets are injected by the platform and never baked into images.
