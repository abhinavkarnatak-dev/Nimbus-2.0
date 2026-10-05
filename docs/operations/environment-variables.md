# Environment variables

Each service has its own ignored `.env.local` and a checked-in `.env.example` beside it. There is no shared root environment file. Copy templates only during first setup; never overwrite existing credentials.

| File                           | Used by                                     | Contents                                                                        |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/web/.env.local`          | Next.js UI and server-side control plane    | Database connection, local sign-in flags, GitHub App credentials                |
| `apps/executor/.env.local`     | Task worker and Codex supervisor            | Database connection, provider mode, health port, optional local Codex bootstrap |
| `packages/database/.env.local` | Migration, seed, schema-generation commands | Database connection only                                                        |

The web application includes backend routes. GitHub credentials remain on its server and must never use a `NEXT_PUBLIC_` prefix. The executor does not need GitHub App secrets. All three services need the same database URL because they access the same database; this does not justify sharing all secrets. Deployed services should use appropriately scoped database roles.

CI and production inject variables directly, taking precedence over local files. Next.js loads its service-local file automatically. Executor and database scripts explicitly load theirs if present. The database library uses its caller's environment; it does not load the migration file when imported by another service.

## Web service

Keep the supplied defaults:

```dotenv
DATABASE_URL=postgresql://nimbus:nimbus@localhost:55432/nimbus
NIMBUS_LOCAL_AUTH=true
NIMBUS_CODING_PROVIDER=fake
NIMBUS_CHATGPT_OAUTH_ENABLED=false
```

Local sign-in is development-only. The provider flag controls the UI mode and must match the executor. The ChatGPT flag remains false until approved authorization is implemented and configured; changing the flag alone does not enable live inference.

For live GitHub, fill these values only in `apps/web/.env.local`:

| Variable                        | Source and purpose                                                             |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `GITHUB_APP_ID`                 | App ID from GitHub App settings                                                |
| `GITHUB_APP_SLUG`               | Slug from `github.com/apps/your-app-slug`                                      |
| `GITHUB_APP_CLIENT_ID`          | Client ID from App settings                                                    |
| `GITHUB_APP_CLIENT_SECRET`      | Generate under Client secrets; exchanges authorization codes                   |
| `GITHUB_APP_CALLBACK_URL`       | Exact registered callback; locally `http://localhost:3000/api/github/callback` |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | Base64-encoded downloaded PEM; signs App JWTs                                  |
| `GITHUB_APP_WEBHOOK_SECRET`     | Locally generated secret matching GitHub's Webhook secret field                |

Client secrets, private keys, and webhook secrets are confidential. Base64 is not encryption. No personal access token or manually entered installation ID is needed. See [OAuth setup](oauth-setup.md) for URLs, permissions, and key conversion.

## Executor

```dotenv
DATABASE_URL=postgresql://nimbus:nimbus@localhost:55432/nimbus
EXECUTOR_PORT=3020
NIMBUS_CODING_PROVIDER=fake
```

These defaults run an explicitly labeled simulation, not real Codex. Production rejects fake mode. Real Codex requires approved ChatGPT authorization; no OpenAI API key or copied local Codex credential file is supported.

`NIMBUS_CODEX_ACCESS_TOKEN` is an optional development-only bootstrap using a short-lived token obtained through an approved OAuth client. Normal users should not fill it. For that explicit test only, put it in the executor file, set both services' provider mode to `codex`, then remove the token afterward. The production OAuth broker remains a launch dependency.

Model discovery uses Codex app-server `model/list`, not a manually configured model list. Live account discovery still needs approved authorization verification.

## Database commands

Only `DATABASE_URL` is needed. Docker Compose supplies the local PostgreSQL connection. Your managed provider supplies the production URL. No integration credential belongs here.

## Not required now

`REDIS_URL` was removed from active templates because no current executable adapter reads it. Redis remains available through Docker Compose. Vercel Sandbox, PostHog, object storage, channels, and managed encryption must add validated documented settings when their live adapters become executable. Do not invent credentials for unfinished integrations.

## Existing configuration migration

Recognized values were mechanically split without printing secrets. Existing nonempty service values were preserved. The old root `.env` was moved to ignored `.nimbus/env-backups/root.env.pre-service-split` for recovery; no process loads it. Protect this backup like any credential file. Restart the relevant service after editing its configuration.
