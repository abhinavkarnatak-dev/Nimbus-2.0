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
AUTH_URL=http://localhost:3000
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
```

Local sign-in is development-only. The provider flag controls the UI mode and must match the executor. Google sign-in uses Auth.js and requires the four `AUTH_` values above. `AUTH_URL` is the Nimbus origin, `AUTH_SECRET` is a locally generated random session-encryption secret of at least 32 characters, and `AUTH_GOOGLE_ID` plus `AUTH_GOOGLE_SECRET` come from a Google Cloud OAuth Web application client. They belong only in `apps/web/.env.local`. The old `NIMBUS_CHATGPT_OAUTH_ENABLED` setting is no longer used for Nimbus sign-in. Codex authorization stays separate. See [OAuth setup](oauth-setup.md) for registered URLs.

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

### PostHog observability

Set the following values in `apps/web/.env.local` and in the web deployment environment:

| Variable                            | Purpose                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | Public `phc_...` project token used by the browser SDK                        |
| `NEXT_PUBLIC_POSTHOG_HOST`          | PostHog ingestion host, normally `https://us.i.posthog.com`                   |
| `POSTHOG_PROJECT_TOKEN`             | Optional server-side override; the web service falls back to the public token |
| `POSTHOG_HOST`                      | Optional server-side ingestion-host override                                  |

The browser integration enables Session Replay using the project-selected privacy posture: password fields are masked, while ordinary text, non-password inputs, and rendered application content are recorded. It also enables autocapture, SPA-aware `$pageview`, `$pageleave`, Web Vitals/performance capture, browser console recording, and exception autocapture. This supplies Session Replay, Web Analytics, Product Analytics dashboards, performance metrics, and Error Tracking. Because ordinary chat and repository text can appear in replay under this configuration, use PostHog project access controls and retention settings accordingly.

PostHog project tokens are designed to be public. Never expose a PostHog personal API key (`phx_...`) through a `NEXT_PUBLIC_` variable.

## Executor

For the combined server-installed CLI runtime, use `NIMBUS_CODING_PROVIDER=connected`. It needs no operator-wide `NIMBUS_CODEX_ACCESS_TOKEN`: tasks use their owner's device connection. See [server device login](server-device-login.md) for the explicit opt-in, upstream support limitation, storage, secret, and deployment requirements. Do not deploy this executor separately without first replacing its loopback execution bridge and shared filesystem assumptions.

```dotenv
DATABASE_URL=postgresql://nimbus:nimbus@localhost:55432/nimbus
EXECUTOR_PORT=3020
NIMBUS_CODING_PROVIDER=fake
```

These defaults run an explicitly labeled simulation, not real Codex. Production rejects fake mode. Real Codex requires approved ChatGPT authorization; no OpenAI API key or copied local Codex credential file is supported.

Set `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` in the executor deployment to send task events and all supported observability signals to the same project. `POSTHOG_SERVICE_NAME` defaults to `nimbus-executor`; `POSTHOG_DEPLOYMENT_ENVIRONMENT` defaults to `NODE_ENV`. The executor emits native PostHog metrics for agent volume and duration, distributed spans for agent requests, structured OTLP logs, `$exception` events, `$ai_generation` events, and `$ai_span` events for command tools. AI Observability includes the actual composed model input, streamed output, tool commands, and tool output. Session IDs remain opaque hashes; native PostHog trace/span IDs link AI generations to distributed traces. Token counts and cost remain absent until the Codex provider exposes authoritative usage rather than an estimate. The legacy `POSTHOG_API_KEY` name remains accepted for existing environments, but new deployments should use `POSTHOG_PROJECT_TOKEN`. Do not use a PostHog personal API key.

PostHog Metrics is currently an open-alpha product and must also be enabled once in the PostHog project UI. The project token is sufficient for ingesting events, replays, exceptions, AI events, OTLP logs, traces, and metrics; a personal API key is only required for private management/query API operations.

`NIMBUS_CODEX_ACCESS_TOKEN` is an optional development-only bootstrap using a short-lived token obtained through an approved OAuth client. Normal users should not fill it. For that explicit test only, put it in the executor file, set both services' provider mode to `codex`, then remove the token afterward. The production OAuth broker remains a launch dependency.

Model discovery uses Codex app-server `model/list`, not a manually configured model list. Live account discovery still needs approved authorization verification.

### E2B execution

`apps/executor/.env.example` includes an empty `E2B_API_KEY` placeholder. Add your E2B account API key to the existing ignored `apps/executor/.env.local`; do not overwrite that file or copy the complete example over existing credentials. This key authorizes sandbox provisioning and management and belongs only in the trusted executor environment. Never expose it with a `NEXT_PUBLIC_` prefix, send it to the browser, or inject it into sandbox commands, environment variables, repository files, or images.

Real connected Codex sessions now require E2B and select an explicitly registered remote environment for commands and file edits. Public repositories are cloned without GitHub credentials inside the sandbox. Existing GitHub App credentials stay in the web control plane for authorized commit publication and PR operations. The private execution bridge runs only the credential-free Codex execution service inside E2B; the model/account controller stays outside it. No additional E2B credential or custom template ID is required. Fake mode remains an explicit simulation, not a remote security test.

For bounded manual tests, set `NIMBUS_E2B_LIVE_TEST=true` in your terminal, then run `pnpm --filter @nimbus/executor test:e2b` and `pnpm --filter @nimbus/executor test:e2b-protocol`. The former tests the public Testing-Nimbus-PRs checkout, installs, edits, binary file transfers, process streaming, failed commands and pause/resume. The latter tests the authenticated controller-to-sandbox protocol and remote thread selection using an isolated, unauthenticated controller home. Both destroy their test sandbox and perform no GitHub writes or model turns. These tests use E2B credits; neither is run by the default unit test suite.

The worker synchronizes a bounded, data-only trusted mirror for Files, Changes, history, artifact snapshots and authorized Git publication. Repository programs, tests and installation commands run in E2B, not in that host mirror. GitHub publishing remains outside E2B and imports the resulting commit back into the sandbox. Remote routing failures do not intentionally select local execution.

After a turn, the executor checkpoints files outside the VM and pauses it. A later request resumes the owned VM; if it has been deleted, a replacement public clone restores saved Git history and files while retaining the chat, Codex thread, title and PR history. Dependency/cache directories are excluded, so a replacement may need dependency reinstallation. Sandboxes have a bounded 30-minute timeout; this is not an unlimited active-run lease. Checkpoints and artifact snapshots currently live on the trusted server's `.nimbus` storage: deployments require persistent storage and do not recover from loss of that disk. This integration has live end-to-end evidence, not a formal hostile-repository security certification; the production authorization broker remains a separate launch dependency.

## Database commands

Only `DATABASE_URL` is needed. Docker Compose supplies the local PostgreSQL connection. Your managed provider supplies the production URL. No integration credential belongs here.

## Not required now

`REDIS_URL` was removed from active templates because no current executable adapter reads it. Redis remains available through Docker Compose. Vercel Sandbox, object storage, channels, and managed encryption must add validated documented settings when their live adapters become executable. Do not invent credentials for unfinished integrations.

## Existing configuration migration

Recognized values were mechanically split without printing secrets. Existing nonempty service values were preserved. The old root `.env` was moved to ignored `.nimbus/env-backups/root.env.pre-service-split` for recovery; no process loads it. Protect this backup like any credential file. Restart the relevant service after editing its configuration.
