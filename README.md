# Nimbus 2.0

Nimbus is an autonomous cloud coding agent product. Codex app-server owns repository understanding and the adaptive coding loop. Eve owns durable orchestration around that loop. Nimbus owns authorization, tenancy, task data, trusted GitHub effects, and the product experience.

This repository is under active construction. See [docs/BUILD_STATUS.md](docs/BUILD_STATUS.md) for verified capabilities and launch dependencies. A missing external credential is never replaced by a production fake.

## Local requirements

- Node.js 24
- pnpm 10.12.1
- Docker Desktop
- PostgreSQL 17 and Redis are started through Docker Compose

```powershell
Copy-Item -LiteralPath '.env.example' -Destination '.env'
docker compose up -d --wait
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://localhost:3000`. Local development sign-in is explicit and is disabled when `NODE_ENV=production`.

## Trust boundaries

- The browser receives only an opaque Nimbus session cookie.
- The control plane authorizes every tenant and repository operation from server-owned state.
- Each task receives an isolated workspace and a distinct Codex thread.
- ChatGPT access tokens are encrypted at rest and only enter the Codex child process environment.
- GitHub installation credentials never enter the task workspace.
- PostHog receives redacted operational metadata, never repository content by default.

## Main packages

- `apps/web`: Next.js product UI and HTTP control plane
- `apps/executor`: task execution worker and Codex process supervisor
- `apps/eve-agent`: Eve agent definition and durable workflow entry points
- `packages/database`: Drizzle schema, migrations, and repositories
- `packages/codex`: Codex app-server protocol and provider boundary
- `packages/shared`: domain contracts, task state machine, and event schemas
