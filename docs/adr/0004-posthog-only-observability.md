# ADR 0004: PostHog is the only observability platform

Status: Accepted

## Decision

PostHog receives privacy-filtered product events, feature flags, task metrics, Eve traces, Codex lifecycle metadata, and integration reliability metrics. Nimbus will not install a second analytics, tracing, or error-monitoring vendor.

Operational logs remain structured and redacted for local and infrastructure debugging. They are not a second hosted observability product.

Repository content, prompts, diffs, terminal output, tokens, authorization headers, cookies, email bodies, Notion content, Slack bodies, and phone numbers are denied by default at the observability boundary.
