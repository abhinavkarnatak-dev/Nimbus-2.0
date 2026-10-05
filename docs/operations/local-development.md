# Local development

Use Node.js 24 and pnpm 10.12.1. Start PostgreSQL 17 and Redis with `docker compose up -d --wait`, then run migrations and the seed. The seed creates an explicit local user, organization, repository, and durable demonstration task.

`NIMBUS_LOCAL_AUTH=true` enables local sign-in only when `NODE_ENV` is not `production`. `NIMBUS_CODING_PROVIDER=fake` is accepted only in the same condition. Production startup rejects both.

Run `pnpm dev` for all services. Health endpoints report dependency readiness without disclosing configuration values.
