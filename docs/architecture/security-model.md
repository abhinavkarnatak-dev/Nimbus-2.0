# Security model

Nimbus assumes repository files, branch names, filenames, skills, MCP output, dependency scripts, tests, webhooks, and external integration content can be malicious.

Primary controls include tenant predicates in repositories, opaque identifiers, repository reauthorization, webhook signature verification, OAuth issuer and state validation, PKCE, secure cookies, CSRF protection, CSP, output encoding, request limits, idempotency, path containment, sandbox isolation, egress control, short-lived credentials, envelope encryption, secret redaction, audit events, and dependency lockfiles.

External content is data, never authority. A repository instruction may guide Codex inside the assigned task but cannot expand OAuth scopes, repository access, integrations, or credential visibility.
