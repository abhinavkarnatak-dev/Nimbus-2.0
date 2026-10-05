# ADR 0003: Credential and sandbox boundaries

Status: Accepted

## Decision

Each task receives one isolated workspace by default. The workspace identity and workflow identity are independent and durably linked.

ChatGPT refresh credentials are envelope encrypted. A short-lived access token is passed only in the Codex child process environment at process start. It is never written to the workspace, command arguments, prompts, events, artifacts, browser responses, or PostHog.

GitHub installation tokens remain in the trusted integration layer. Codex produces commits in the workspace, while the trusted layer reauthorizes the repository before push and pull request operations.
