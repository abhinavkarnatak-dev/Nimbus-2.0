# Server-side Codex device login

## Important support boundary

The existing device-code screen can be driven by a server-installed Codex CLI. OpenAI's [app-server authentication documentation](https://learn.chatgpt.com/docs/app-server#auth-endpoints) explicitly excludes this authentication flow from commercial or hosted services. An operator opt-in in Nimbus does not grant OpenAI approval, bypass upstream checks, or guarantee account access. An approved hosted integration remains the supported production path. Do not describe this deployment as OpenAI-approved.

## Runtime topology

For this initial deployment, run the Next.js web application, the private executor, and each user's Codex app-server processes in **one service instance**. The existing E2B bridge advertises loopback WebSocket addresses, and publishing/artifacts use shared `.nimbus` files. Merely putting the executor in a separate Render service will not work. Splitting services later requires a routable authenticated execution transport and shared artifact/checkpoint storage.

The combined startup supervisor installs no credentials. Users still click Connect Codex, open the verification link, and enter the one-time code. The web process runs Codex app-server through private stdin/stdout; there is no publicly exposed CLI port. The executor uses authenticated internal HTTP to drive the task owner's connection. General chat has no repository tools; repository execution still requires E2B and never falls back to running user code on the host.

## Render configuration

Keep the existing web service and domain. Do not create a second executor service for this topology.

- Runtime: Node, repository root directory left blank, Node 24.
- Build command: `pnpm install --frozen-lockfile --prod=false && pnpm runtime:build`.
- Start command: `node scripts/start-runtime.mjs` (avoids retaining pnpm wrappers in the runtime).
- One instance only. Do not enable autoscaling for this filesystem-backed runtime.
- For durable storage, attach a persistent disk at `/opt/render/project/src/.nimbus`. Render requires a paid service for persistent disks; this is a user/operator choice, not something the code provisions. For the explicitly accepted temporary test deployment, skip the disk and set `NIMBUS_STORAGE_MODE=ephemeral`. Files and connections can be lost on restart, redeploy, or free-service spin-down. See [Render disk documentation](https://render.com/docs/disks) and [free-service limitations](https://render.com/docs/free).
- Keep existing database, Google, GitHub, and PostHog environment variables.

Additional environment variables:

```dotenv
NODE_VERSION=24
AUTH_URL=https://nimbus.abhinavkarnatak.com
NIMBUS_DEVICE_AUTH_ENABLED=true
NIMBUS_CODING_PROVIDER=connected
NIMBUS_STORAGE_MODE=ephemeral
NIMBUS_CODEX_HOME=/opt/render/project/src/.nimbus/codex-device
NIMBUS_CODEX_MAX_CONNECTIONS=2
NIMBUS_CODEX_MAX_PROCESSES=1
NIMBUS_CODEX_IDLE_MS=45000
NIMBUS_EXECUTOR_SECRET=<random 64-character lowercase hexadecimal secret>
DATABASE_POOL_SIZE=3
E2B_API_KEY=<needed for repository tasks>
```

Generate the internal secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and add it privately to Render. Never commit it or use a `NEXT_PUBLIC_` prefix. This secret is not an OpenAI API key. The supervisor automatically sets the web/executor loopback URLs and private executor port; Render's injected `PORT` controls the public web listener. Database pool size is per process, so the web and executor together may open twice the configured count.

The example above is the temporary, no-disk test configuration. For durable deployment, set `NIMBUS_STORAGE_MODE=persistent` and attach the disk. The path itself does not make storage persistent. Saved account capacity is separate from running process capacity: two accounts can remain connected while only one CLI runs. An idle authenticated CLI is stopped without logging out, and is restarted when its owner runs a task. Pending device sign-ins and active task streams cannot be evicted; another user's sign-in may need to wait until that work finishes. UI polling does not restart idle CLIs. This does not guarantee the runtime fits in 512 MB; verify the container-memory logs under real task load.

`runtime:build` installs a pinned Codex CLI into the ignored `.nimbus-tools` directory without touching Render's read-only global binaries. The startup supervisor checks the CLI, required settings, and credential-directory permissions before starting the service. It selects the installed native CLI when available, avoiding its extra Node launcher. The executor's workspace TypeScript is bundled at build time and runs with plain Node, without a runtime transpiler. Next's in-memory cache is capped at 5 MiB. Container memory is logged every 30 seconds on Linux without exposing credentials.

Repository validation uses the existing GitHub App installation token on the web backend. Only verified repository metadata crosses to the executor; GitHub credentials never enter E2B. Repository sandboxes remain public-only. GitHub permission, identity, and rate-limit failures have distinct messages. Trusted host Git uses one packing thread and small delta caches. Checkpoints are limited to 8 MB per file and 24 MB total; restore bundles are limited to 24 MB, and mirror uploads are sequential rather than retaining all file buffers. Oversized checkpoints fail explicitly and retain the sandbox for recovery, rather than silently omitting user files. Larger repositories may require a future streaming checkpoint design.

For a no-login/no-inference CLI protocol check, run `pnpm --filter @nimbus/executor exec tsx ../../scripts/codex-preflight.mts`. It creates and removes its own temporary credential directory and never reads the operator's saved account. Set `CODEX_EXECUTABLE` first if the CLI isn't already installed on PATH.

If using a VM instead of Render, mount persistent storage at the repository's `.nimbus` directory and use the equivalent absolute `NIMBUS_CODEX_HOME`. For a custom CLI installation, set `CODEX_EXECUTABLE` to its absolute executable path. Keep the public site behind HTTPS.

## Credentials, recovery, and limitations

- Each organization/user pair has a separate hashed credential directory with mode `0700`; the Codex-owned `auth.json` is restricted to `0600`.
- These files contain bearer credentials. File permissions are not encryption. Render encrypts persistent disks at rest; operators on other hosts must secure/encrypt the volume and control backup access. Never publish, log, or copy these files into tickets.
- Successful login is confirmed by account read, not by displaying a code. Models and account usage are queried from that same user's process.
- A process/server restart restores saved credentials lazily for the authenticated user. A pending, uncompleted code cannot survive a process restart; the user must request a new code.
- Disconnect cancels pending login, calls Codex logout, stops the process, and removes only that user's credential file. It is refused while that user's process has an active turn.
- Concurrent connect/poll/disconnect operations are serialized per identity. `NIMBUS_CODEX_MAX_CONNECTIONS` caps retained account connections (default 10); `NIMBUS_CODEX_MAX_PROCESSES` independently caps running CLIs (default 1). The idle timeout defaults to 45 seconds. Streaming task leases protect the process through setup, inference, cleanup, and cancellation.
- Existing task concurrency remains unchanged. This work does not introduce parallel workers.
- In-flight task recovery after a full service termination is not guaranteed; do not redeploy during active tasks. Saved credentials do not make interrupted execution resumable automatically.
- No real OpenAI account login is exercised by unit tests. A live deployment acceptance test is still required, and upstream permission/account checks can reject this flow.

## Acceptance test after deployment

1. Sign into Nimbus, open Connections, click Connect Codex, and check that a code/link appears.
2. Authorize in the user's browser and confirm the modal closes, the account is connected, and real model choices appear.
3. Run a general chat and check streamed output and account usage.
4. With E2B configured, run a harmless task in a test repository and verify workspace isolation, diffs, and output. Do not test against valuable repositories first.
5. Once all tasks are idle, restart the service. With a persistent disk, verify the connection restores without a new code. With temporary storage, expect to reconnect and do not rely on old local thread/checkpoint/artifact files remaining available.
6. Disconnect, restart, and verify the connection stays disconnected.
7. Sign in as another Nimbus user and verify they cannot see the first user's code/account/threads.
