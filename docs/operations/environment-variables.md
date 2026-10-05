# Environment variables

Copy `.env.example` to `.env` for local development. The checked-in example contains no secret values. The local `.env` file is ignored by Git.

## Variables used now

| Variable                       | Local value                                         | Why Nimbus needs it                                                                                           | Where it comes from                                                                                                                                     |
| ------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | `postgresql://nimbus:nimbus@localhost:55432/nimbus` | Stores users, organizations, tasks, events, model catalogs, and recovery state.                               | The PostgreSQL service in `docker-compose.yml` creates this local database. Production uses the connection string from the managed PostgreSQL provider. |
| `REDIS_URL`                    | `redis://localhost:6379`                            | Supports short leases, rate limits, and coordination. Redis is never the source of truth.                     | The Redis service in `docker-compose.yml`. Production uses the managed Redis connection string.                                                         |
| `NIMBUS_LOCAL_AUTH`            | `true`                                              | Enables the development-only sign-in button. Production rejects this mode.                                    | Set manually only for local development.                                                                                                                |
| `NIMBUS_CODING_PROVIDER`       | `fake`                                              | Chooses the deterministic local test provider or real Codex app-server. Fake mode is forbidden in production. | Use `fake` locally. Use `codex` only after ChatGPT OAuth is configured.                                                                                 |
| `NIMBUS_CHATGPT_OAUTH_ENABLED` | `false`                                             | Controls whether the ChatGPT sign-in entry point is available.                                                | Keep `false` until OpenAI approves the application's Sign in with ChatGPT client.                                                                       |
| `EXECUTOR_PORT`                | `3020`                                              | Selects the local HTTP health port for the executor service.                                                  | A local convention. Change it only if port 3020 is occupied.                                                                                            |

## Development-only Codex bootstrap

`NIMBUS_CODEX_ACCESS_TOKEN` is intentionally commented out. Normal users must never set this value. In production, Nimbus obtains a short-lived access token from the user's Sign in with ChatGPT session, keeps refresh credentials encrypted, and passes only the access token to the Codex child process.

The variable exists only to test the real app-server provider locally before the OAuth broker is deployed:

1. Set `NIMBUS_CODING_PROVIDER=codex`.
2. Set `NIMBUS_CODEX_ACCESS_TOKEN` to a short-lived test token obtained through the approved OAuth client.
3. Restart the executor.
4. Remove the token from `.env` after the test.

Do not use an OpenAI API key. Nimbus does not implement an API-key fallback. Do not copy `~/.codex/auth.json` into Nimbus.

## Model selection

There is no `NIMBUS_CODEX_MODEL` variable. After a ChatGPT account is connected, Nimbus starts Codex app-server with that account's short-lived access token and calls `model/list`. It stores the returned catalog for 15 minutes and presents those entries in the task model selector. The selected model ID is stored on the task and passed to `thread/start`.

The app-server catalog is not a guaranteed account entitlement list. A successful inference turn is the final proof that the account can use the selected model. Nimbus records a failed or rejected turn honestly and can ask the user to select another discovered model.

## Live GitHub App variables

These variables are unnecessary for the local fake-provider flow. They become required together when the live GitHub integration is enabled.

| Variable                        | Secret | Purpose                                                      |
| ------------------------------- | ------ | ------------------------------------------------------------ |
| `GITHUB_APP_ID`                 | No     | Identifies the GitHub App when signing app JWTs.             |
| `GITHUB_APP_SLUG`               | No     | Builds the official GitHub App installation URL.             |
| `GITHUB_APP_CLIENT_ID`          | No     | Starts and validates GitHub user authorization.              |
| `GITHUB_APP_CLIENT_SECRET`      | Yes    | Exchanges the one-time GitHub authorization code.            |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | Yes    | Signs short-lived app JWTs used to mint installation tokens. |
| `GITHUB_APP_WEBHOOK_SECRET`     | Yes    | Verifies the raw bytes of incoming GitHub webhooks.          |

See `docs/operations/oauth-setup.md` for exact GitHub App URLs, permissions, events, and credential generation steps.

## Variables not added yet

Vercel Sandbox, PostHog, object storage, Slack, Gmail, Notion, Twilio, and managed encryption variables are not in `.env.example` yet because their live adapters are not complete. Adding unused secret-shaped variables would make setup confusing and encourage insecure placeholder values. Each adapter must add validation and documentation when it becomes executable.
