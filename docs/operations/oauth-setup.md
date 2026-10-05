# OAuth and GitHub App setup

Nimbus uses two separate connections:

- A GitHub App grants repository access, branch push, pull request, and webhook capabilities.
- Sign in with ChatGPT grants verified OpenAI identity and, when approved and eligible, ChatGPT plan usage for Codex app-server.

An OpenAI API key is not part of either flow.

## GitHub App

Create a new GitHub App under the organization that will own the production integration. Use a separate app for development if local testing uses a tunnel.

### URLs

Replace `https://nimbus.example.com` with the deployed Nimbus origin.

| GitHub setting                                 | Value                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| Homepage URL                                   | `https://nimbus.example.com`                                       |
| Callback URL                                   | `https://nimbus.example.com/api/github/callback`                   |
| Setup URL                                      | Leave empty when requesting user authorization during installation |
| Webhook URL                                    | `https://nimbus.example.com/api/github/webhooks`                   |
| Expire user authorization tokens               | Enabled                                                            |
| Request user authorization during installation | Enabled                                                            |
| Device flow                                    | Disabled                                                           |

Production callback and webhook URLs must be public HTTPS endpoints. For local development, use a dedicated HTTPS tunnel for webhooks. Do not reuse a production webhook secret locally.

For the current local development sign-in, register `http://localhost:3000/api/github/callback` as the callback and set `GITHUB_APP_CALLBACK_URL` to that exact value. Open Nimbus on localhost and start the connection from Integrations after installing the App. Use the Cloudflare HTTPS origin for the homepage and webhook. The local development sign-in is blocked over Cloudflare, and browser sessions do not transfer between localhost and the tunnel hostname. Production callbacks must use the public HTTPS origin with production authentication.

The routes are implemented at `/api/github/connect` (POST), `/api/github/callback` (GET), and `/api/github/webhooks` (POST). The callback requires a Nimbus owner or administrator session, consumes state once, verifies installation access through GitHub user and App APIs, and imports repositories in a database transaction. Network requests occur before that transaction. This initial connection flow accepts one active installation or an explicit authorized installation ID; installation selection for accounts with several installations remains pending.

Webhook requests are verified before parsing, bounded to 2 MB, stripped to necessary metadata, and deduplicated in PostgreSQL. Revocation, suspension, repository removal, and known pull request state updates are applied transactionally. Other events are retained with `received` status for later reconciliation; check and push processing is not implemented yet. The endpoint returns 503 if the webhook secret is missing.

Database route verification uses real PostgreSQL with simulated GitHub responses. Run it with `NIMBUS_GITHUB_DATABASE_TEST=true` and a migrated `DATABASE_URL`. These checks do not prove a live GitHub OAuth exchange works.

The active development Cloudflare tunnel runs as Docker container `nimbus20-cloudflare-tunnel`, using cloudflared 2026.9.3. Inspect its current URL with `docker logs nimbus20-cloudflare-tunnel`. A Quick Tunnel hostname changes after recreation and does not support SSE. Continue testing task streaming on localhost. Use a named tunnel with a stable domain for deployment.

### Repository permissions

Configure the smallest set required by the current product slice:

| Permission    | Access         | Reason                                                    |
| ------------- | -------------- | --------------------------------------------------------- |
| Metadata      | Read-only      | Required GitHub App repository metadata                   |
| Contents      | Read and write | Clone, create commits, and push task branches             |
| Pull requests | Read and write | Create, update, close, reopen, and inspect pull requests  |
| Checks        | Read-only      | Read verification status without publishing GitHub checks |

Do not grant Administration, Secrets, Environments, Actions, or Workflows permission for the initial slice. Add Workflows permission only if Nimbus later supports changing files under `.github/workflows`, and require installation owners to approve that expansion.

Subscribe to these webhook events:

- Installation
- Installation repositories
- Pull request
- Pull request review
- Pull request review comment
- Push
- Check run
- Check suite

### Credentials

Nimbus needs these server-side values:

| Variable                        | Where to find it                                              | Secret |
| ------------------------------- | ------------------------------------------------------------- | ------ |
| `GITHUB_APP_ID`                 | GitHub App settings, About section                            | No     |
| `GITHUB_APP_SLUG`               | The slug in the app public link                               | No     |
| `GITHUB_APP_CLIENT_ID`          | GitHub App settings, About section                            | No     |
| `GITHUB_APP_CLIENT_SECRET`      | Generate under Client secrets                                 | Yes    |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | Generate a private key, then base64 encode the downloaded PEM | Yes    |
| `GITHUB_APP_WEBHOOK_SECRET`     | Generate locally and enter the same value in GitHub           | Yes    |

Generate the webhook secret in PowerShell:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

Convert the downloaded GitHub private key to one line for local environment storage:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\nimbus.private-key.pem"))
```

Put local values in ignored `.env` or `apps/web/.env.local` files. In production, put secrets in the deployment platform secret manager or a managed key vault. Never paste the private key, client secret, webhook secret, installation token, or user token into chat, source control, PostHog, logs, task events, or a sandbox.

The GitHub App installation ID is not an environment variable. GitHub returns it after installation, Nimbus verifies it with the authenticated GitHub user and GitHub App API, then stores it against the Nimbus organization. Installation access tokens are created just in time and expire after one hour.

## Sign in with ChatGPT and Codex

Nimbus is a remotely hosted cloud product. It requires an approved commercial Sign in with ChatGPT integration with both identity and ChatGPT plan usage. Complete the OpenAI interest form and choose `Sign in and ChatGPT plan use for AI requests`.

When OpenAI approves the integration, Nimbus expects:

- The issued OpenAI client ID, normally beginning with `oaiapp_`.
- The registered callback URL for each environment.
- The client secret only if OpenAI registers Nimbus as a confidential client.
- Confirmation that the client may request ChatGPT plan usage scopes, not identity-only scopes.

Nimbus must request `openid profile email` plus the approved plan-use scopes. It generates fresh state, nonce, and PKCE values per attempt, validates the signed ID token, checks granted scopes, and binds the verified OpenAI subject to a Nimbus user.

Refresh credentials are envelope encrypted under a managed key service. Refreshes are serialized per account because refresh tokens may rotate. Tokens never enter browser storage, sandboxes, prompts, command arguments, PostHog, logs, or artifacts.

Codex app-server receives only the short-lived access token in its child-process environment. Nimbus starts the ChatGPT-plan Responses provider, initializes app-server, calls `model/list`, starts or resumes the saved thread, and accepts a turn as successful only when the official terminal event reports `completed`.

The model list is a catalog, not an entitlement guarantee. A completed inference request verifies access to the selected model for that request.

## Credential handoff

Do not send secrets through chat. The safe handoff is:

1. Add local development secrets directly to the ignored environment file on the machine running Nimbus.
2. Add production secrets directly to the deployment platform secret manager.
3. Share only non-secret identifiers in issue or chat text.
4. Confirm that the variables have been installed without revealing their values.
5. Run live connection checks that report identifiers, scopes, expiration timestamps, and redacted fingerprints only.
