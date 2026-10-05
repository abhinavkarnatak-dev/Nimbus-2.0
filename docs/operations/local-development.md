# Local development

Use Node.js 24 and pnpm 10.12.1. Start PostgreSQL 17 and Redis with `docker compose up -d --wait`, then run migrations and the seed. The seed creates an explicit local user, organization, repository, and durable demonstration task.

On first setup, copy each service's `.env.example` to `.env.local` in the same directory: `apps/web`, `apps/executor`, and `packages/database`. Never overwrite an existing credential file. No service reads a root `.env`. CI and production inject environment variables directly; those override local files. GitHub App values belong only in `apps/web/.env.local`.

`NIMBUS_LOCAL_AUTH=true` enables local sign-in only when `NODE_ENV` is not `production`. `NIMBUS_CODING_PROVIDER=fake` is accepted only in the same condition. Production startup rejects both.

Run `pnpm dev` for all services. Health endpoints report dependency readiness without disclosing configuration values.

See `environment-variables.md` for every current variable, why it exists, and where its value comes from.
