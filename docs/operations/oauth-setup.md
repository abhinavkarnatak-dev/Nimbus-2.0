# OAuth and GitHub App setup

Nimbus separates application sign-in from coding connections:

- Google through Auth.js identifies the Nimbus user and creates a private workspace.
- A GitHub App grants repository access, branch push, pull request, and webhook capabilities.
- Codex authorization grants eligible ChatGPT plan usage for Codex app-server. It is not the Nimbus login button.

An OpenAI API key is not part of either flow.

## Google sign-in

Create an OAuth client with application type **Web application** in Google Cloud Console. Configure the consent screen and add your Google account as a test user if the app is in testing mode. Only `openid email profile` scopes are requested; no Gmail or other Google service access is requested.

- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

Use localhost consistently, not `127.0.0.1`. For deployment, register the stable HTTPS app origin and the same callback path on that origin; update `AUTH_URL` to match. Do not use an ephemeral tunnel as your permanent OAuth registration.

Add these values only to `apps/web/.env.local`:

```dotenv
AUTH_URL=http://localhost:3000
AUTH_SECRET=<random-secret-at-least-32-characters>
AUTH_GOOGLE_ID=<Google-OAuth-client-ID>
AUTH_GOOGLE_SECRET=<Google-OAuth-client-secret>
```

Generate `AUTH_SECRET` locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Keep it stable across restarts. Never share secrets in chat or put them in executor configuration. Restart only the web service after configuring it; reconnect Codex if its ephemeral connection was interrupted by that restart.

Auth.js validates OAuth state and PKCE. Nimbus requires a verified Google email, persists identity by Google subject ID, and atomically creates a user, account, private organization, and owner membership. Existing emails are not automatically linked to a different account. Google tokens are not stored or returned to the browser. Application sessions use Auth.js encrypted HttpOnly JWT cookies with an eight-hour lifetime; every request resolves current database membership. No database migration is needed because these identity tables already exist.

Signing in with Google creates a separate workspace from the shared local demonstration identity, named using only the user's first name. New users land on `/onboarding`, a centered GitHub and Codex setup page. Connect both services and select at least one usable repository. GitHub's setup callback returns to this page, which polls authenticated connection status and enables Continue after both connections are confirmed. Clicking Continue revalidates the connections, records completion, and opens Mission Control. Failed checks have a visible manual retry; background checks never silently complete setup. Completion uses the registered `AUTH_URL` origin for CSRF validation rather than the internal Next.js request address. The completion timestamp survives refresh and future sign-ins; later connection management is in Settings > Connections at `/settings#connections`. Legacy `/integrations` links redirect there. GitHub connections made outside onboarding return to the Settings section. Existing development repositories and credentials are not silently reassigned. Sign out is available in Settings. Development-only sign-in remains available for existing local tests and is rejected in production.

The implementation is pinned to `next-auth@5.0.0-beta.32`, following the current Auth.js App Router installation guide. This is still a beta dependency and remains a launch risk. Live Google consent and code exchange require your credentials and browser authorization; unit and simulated checks are not proof of that exchange.

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

For the current local development sign-in, register `http://localhost:3000/api/github/callback` as the first callback and set `GITHUB_APP_CALLBACK_URL` to that exact value. Enable **Request user authorization (OAuth) during installation** in GitHub App settings. GitHub uses the first callback for installation-time authorization. Leave Setup URL empty. Open Nimbus on localhost, click **Connect GitHub** in Integrations, and select the GitHub account and repositories. GitHub may require sign-in and consent. After authorization, Nimbus verifies and imports the selected repositories automatically; there is no separate Install App button or second Connect action. Existing installations can use **Reconnect GitHub**. Use the Cloudflare HTTPS origin for the homepage and webhook. The local development sign-in is blocked over Cloudflare, and browser sessions do not transfer between localhost and the tunnel hostname. Production callbacks must use the public HTTPS origin with production authentication.

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

Put all local GitHub App values only in ignored `apps/web/.env.local`. The executor and migration commands have their own `.env.local` files and do not need GitHub App secrets. In production, put secrets in the deployment platform secret manager or a managed key vault. Never paste the private key, client secret, webhook secret, installation token, or user token into chat, source control, PostHog, logs, task events, or a sandbox.

The GitHub App installation ID is not an environment variable. GitHub returns it after installation, Nimbus verifies it with the authenticated GitHub user and GitHub App API, then stores it against the Nimbus organization. Installation access tokens are created just in time and expire after one hour.

## Sign in with ChatGPT and Codex

For this personal local project, open Connections on `http://localhost:3000`, click `Connect to Codex`, open the displayed link, and enter the one-time code while signing in to your own ChatGPT account. If necessary, enable device-code login in ChatGPT security settings first. No API key, OpenAI client secret, or manually copied token is needed.

The implementation uses `account/login/start` with `type: "chatgptDeviceCode"`, verifies the account through `account/read`, and displays the models returned by `model/list`. Each Nimbus identity has a separate Codex process and workspace-local configuration directory. Credentials use Codex's ephemeral in-memory storage; no existing Codex auth cache is read or copied. Browser refresh retains a pending login, but restarting the web server loses this connection and requires reconnecting. Disconnect stops that Nimbus process without logging out your existing Codex installation. This connection does not change the separately configured task executor mode.

By default, the route rejects public hosts, Cloudflare tunnel traffic, and production mode. A server operator can explicitly opt into the existing flow with the single-instance runtime described in [server device login](server-device-login.md). The current official [app-server authentication contract](https://learn.chatgpt.com/docs/app-server#auth-endpoints) excludes commercial or hosted services; this opt-in is not OpenAI approval or a cloud-client approval workaround.

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
