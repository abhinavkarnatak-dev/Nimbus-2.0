# Codex integration

The production provider starts `codex app-server --listen stdio://` with a Responses provider configured for a ChatGPT-plan OAuth access token in a child-only environment variable.

The protocol sequence is `initialize`, `initialized`, model discovery when needed, `thread/start` or `thread/resume`, and `turn/start`. The reader handles partial lines, multiple messages per chunk, invalid JSON, unknown events, stderr, duplicate sequence values, backpressure, and unexpected exits.

Only `turn/completed` with `turn.status` equal to `completed` is success. Failed, interrupted, cancelled, malformed, and timed-out turns remain unsuccessful.

After token refresh, Nimbus restarts app-server, initializes it, resumes the persisted thread, and continues without replaying confirmed actions.
