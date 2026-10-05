# Task lifecycle

Valid top-level states are `queued`, `provisioning`, `running`, `awaiting_user`, `paused`, `preparing_pr`, `pushing`, `creating_pr`, `pr_open`, `completed`, `cancelling`, `cancelled`, and `failed`.

Every transition is validated in the domain package with an actor, reason, timestamp, idempotency key, and correlation ID. Clients cannot assign status directly. Low-level actions such as searches, commands, edits, plan revisions, checks, and retries are ordered task events.

Task and workspace lifecycles are separate. A workflow may park while its workspace remains resumable. A replacement executor can claim the durable workflow and reconnect to the recorded workspace and Codex thread.
