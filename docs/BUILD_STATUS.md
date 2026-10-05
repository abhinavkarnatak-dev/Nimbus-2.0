# Build status

Last updated: 2026-10-06

## Completed

- Repository root, Git state, empty remote history, and origin URL verified.
- V1 inspected read-only and limitations recorded with concrete source evidence.
- Current official Codex app-server and Sign in with ChatGPT contracts reviewed.
- Eve 0.71.0 documentation and declarations reviewed. The exact version is pinned.
- Initial ADRs, architecture documentation, operations guides, threat model, and OpenAPI contract created.
- Node.js 24 pnpm monorepo foundation with strict TypeScript and Turborepo created.
- PostgreSQL 17 plus pgvector schema and initial migration created for all required control-plane records.
- Explicit task transition policy and structured event schema implemented and unit tested.
- Production Codex app-server provider boundary and deterministic fake test provider implemented.
- Executor provider selection now supports explicit `codex` and `fake` modes. Fake mode is forbidden in production and is clearly labeled in the UI.
- Codex NDJSON partial-line, multi-message, malformed-output, terminal-status, interruption, restart, and resume handling implemented at the provider boundary.
- Eve agent and Vercel Sandbox definitions implemented from Eve 0.71.0 APIs.
- Local execution worker persists tasks, workspaces, Codex threads, turns, and replayable events.
- Responsive command-center frontend implements local development sign-in, organization navigation, repositories, task creation and lists, complete agent workspace surfaces, integrations, skills, memory, usage, audit, and settings views.
- The task workspace keeps conversation and durable execution evidence visible together, with real plan, file, diff, terminal, check, pull request, artifact, and runtime panels.
- The conversation streams durable events in real time and reports current activity mode, task state, elapsed time, confirmed work count, latest action, and connection health without exposing hidden reasoning.
- The task workbench can be closed for a full-width conversation and reopened with an accessible control.
- Task creation accepts the user's objective directly and derives concise session titles server-side instead of asking users to name agent runs.
- Task creation selects from an account-scoped Codex app-server model catalog. Selected models are validated server-side and persisted per task.
- PostHog-only observability boundary rejects non-allowlisted content metadata.
- Desktop and mobile Playwright task creation and refresh recovery checks pass.
- Next.js and Drizzle security advisories discovered by audit were remediated by patched exact-version upgrades.
- GitHub Actions verification workflow created with PostgreSQL, Redis, Node.js 24, all static checks, tests, build, audit, and Playwright.

## In progress

- First live-provider vertical slice. Local durability and UI behavior are verified with a deterministic provider, but external credentials are not configured.
- ChatGPT OAuth completion must invoke the implemented model catalog refresh after token exchange. Live account discovery remains unverified without an approved client.
- Executor recovery, cancellation propagation, distributed leases, outbox delivery, and reconciliation hardening.
- GitHub App trusted branch push and idempotent pull request delivery.

## Blocked

- Live commercial Sign in with ChatGPT requires an approved client ID. Official documentation describes this availability as a limited commercial trial.
- Live Vercel Sandbox, GitHub App, PostHog, and ChatGPT-plan inference verification require deployment credentials.
- The local machine currently runs Node.js 22.16.0. The repository and CI target Node.js 24, which Eve 0.71.0 requires.

## Not started

- Slack, Gmail, Notion, and Twilio live integrations.
- Dynamic skill publishing and secure archive import.
- Scoped vector memory retrieval and management UI actions.
- Production infrastructure deployment and live recovery exercise.
- Live automatic branch push and pull request end-to-end verification.

## Verification evidence

- `git ls-remote --heads --tags https://github.com/abhinavkarnatak-dev/Nimbus-2.0` returned no refs before first push.
- `npm view eve` reported version 0.71.0 and Node.js `>=24`.
- `codex --version` reported `codex-cli 0.160.0`.
- PostgreSQL migration and seed completed successfully and completed again idempotently.
- Local sign-in returned 303, the authenticated dashboard returned 200, and task creation returned 303.
- The local executor advanced a created task to completed and stored six ordered events.
- SSE replay returned all six durable events after a fresh request.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- Vitest reports 22 passing tests across state, protocol, model discovery, provider selection, task metadata, workspace, and analytics privacy boundaries.
- Playwright reports 2 passing critical-flow tests across desktop and mobile Chromium.
- `pnpm audit --prod` reports no known vulnerabilities.
- No live external integration is claimed as verified.

## Known risks

- Eve is preview software and its public API can change. The exact version is pinned and wrapped at the application boundary.
- Sign in with ChatGPT commercial approval is a launch dependency, not a technical fallback opportunity.
- Local fake providers are useful for deterministic verification but fail closed in production.
- Live GitHub delivery, sandbox isolation, OAuth renewal, and worker restart recovery still require credentialed integration tests.

## Live integration status

| Integration          | Status                       | Evidence                                                                  |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| PostgreSQL           | Verified locally             | PostgreSQL 17 migration, seed, reads, writes, and idempotent rerun passed |
| Redis                | Healthy locally              | Redis 7.4 container health check passed                                   |
| Codex app-server     | Contract and parser verified | Live OAuth token unavailable                                              |
| Sign in with ChatGPT | Launch dependency            | Approved client ID unavailable                                            |
| GitHub App           | Not verified live            | Credentials unavailable                                                   |
| Vercel Sandbox       | Definition type checked      | Credentials unavailable                                                   |
| PostHog              | Privacy boundary verified    | Live project key unavailable                                              |
