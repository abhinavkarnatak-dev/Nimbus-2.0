# Local development

Use Node.js 24 and pnpm 10.12.1. Start PostgreSQL 17 and Redis with `docker compose up -d --wait`, then run migrations and the seed. The seed creates an explicit local user, organization, repository, and durable demonstration task.

On first setup, copy each service's `.env.example` to `.env.local` in the same directory: `apps/web`, `apps/executor`, and `packages/database`. Never overwrite an existing credential file. No service reads a root `.env`. CI and production inject environment variables directly; those override local files. GitHub App values belong only in `apps/web/.env.local`.

`NIMBUS_LOCAL_AUTH=true` enables local sign-in only when `NODE_ENV` is not `production`. `NIMBUS_CODING_PROVIDER=fake` is accepted only in the same condition. Production startup rejects both.

Run `pnpm dev` for all services. Health endpoints report dependency readiness without disclosing configuration values.

See `environment-variables.md` for every current variable, why it exists, and where its value comes from.

## Personal Codex testing

Connect Codex from Connections using the official device code on localhost. No API key is needed. Credentials remain ephemeral in the managed app-server process; a web process restart requires reconnecting. After an update that adds provider capabilities, reconnect once if Usage reports that the connection predates the limits reader.

Usage reads the connected account's limit windows from Codex, including percentages and reset times when returned. Nimbus activity records are separate from the account's ChatGPT-plan quota. Missing limits are unavailable, not zero usage. A limit error cannot be bypassed by selecting the simulation provider for a real task.

The local executor uses an automatically generated, ignored `.nimbus/control/executor-bridge.key` to reach the localhost control plane. No additional credential belongs in an environment file for this bridge. GitHub App credentials stay in `apps/web/.env.local`; restricted checkout tokens are passed to Git only for checkout and are not stored in repository configuration.

This personal bridge and local workspace provider are not a production sandbox boundary. Production Eve/Vercel execution and trusted automatic PR delivery still need live verification.
