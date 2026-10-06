# Threat model

## Scope and trust boundaries

Nimbus separates the browser, control plane, execution plane, task workspace, external integrations, and observability sink. The browser and repository are untrusted. The execution plane receives only server-resolved identifiers and short-lived credentials. PostgreSQL is the source of truth. Redis is coordination infrastructure only.

## Assets

- Private repository content and Git history
- ChatGPT OAuth refresh credentials and short-lived access tokens
- GitHub installation credentials
- Tenant membership and repository authorization
- Task workspaces, artifacts, memories, and skill packages
- Audit, usage, and pull request records

## Principal threats and controls

| Threat                             | Boundary                                   | Required controls                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository prompt injection        | Repository to Codex                        | Treat repository text as data, preserve user authority, restrict tools by task policy, record consequential actions, and never grant credentials based on repository instructions. |
| Malicious skill or archive         | Upload to control plane                    | Validate frontmatter, paths, symlinks, size, count, checksum, secrets, declared capabilities, and sanitized Markdown. Run scripts only inside the isolated workspace.              |
| Malicious MCP output               | Integration to agent                       | Schema validate, output encode, classify as untrusted evidence, apply size limits, and do not let output expand authority.                                                         |
| Dependency install scripts         | Registry to workspace                      | Isolate installation, restrict egress, apply resource and time limits, preserve logs, and never expose control-plane credentials.                                                  |
| Sandbox escape                     | Workspace to execution host                | Use vendor isolation, least privilege, process and filesystem limits, network policy, patch current runtimes, and destroy compromised workspaces.                                  |
| Secret exfiltration                | Any untrusted code to network              | Envelope encrypt refresh credentials, inject short-lived tokens only into trusted process environment at startup, redact outputs, and deny unapproved egress.                      |
| SSRF                               | Browser or integration to internal network | Parse URLs server-side, allowlist protocols and destinations, block private and metadata ranges, disable redirects across policy boundaries.                                       |
| Path traversal and malicious names | Repository or archive to filesystem        | Resolve canonical workspace paths, reject absolute paths and escaping symlinks, avoid shell interpolation, and validate branch and filename inputs.                                |
| Webhook forgery and replay         | Provider to control plane                  | Verify signatures against raw bodies, enforce timestamps where supported, deduplicate delivery IDs, and record results in the webhook inbox.                                       |
| OAuth account confusion            | Browser to callback                        | Bind state, PKCE verifier, redirect URI, intended tenant, and initiating session. Consume state once and use secure cookies.                                                       |
| Cross-tenant access                | Every data path                            | Resolve identity server-side, include organization predicates in reads and writes, authorize repository access, and test tenant isolation.                                         |
| Unauthorized PR action             | Browser or agent to GitHub                 | Recheck installation, repository, task, and actor authorization. Make push and PR creation idempotent. Require explicit merge and close action by default.                         |
| Log or analytics leakage           | Services to PostHog or runtime logs        | Use an allowlist of aggregate metadata. Exclude prompts, source, diffs, output, content, credentials, headers, environment values, and direct contact data.                        |
| Supply-chain compromise            | Dependencies and CI                        | Pin lockfiles, review updates, audit dependencies, verify build provenance where available, scan secrets, and protect release workflows.                                           |

## Abuse resistance

Rate limits and quotas apply per user, organization, repository, and integration. Cancellation propagates to workspaces and Codex turns. Circuit breakers and bounded retries contain failing providers. A kill switch can disable each external integration without corrupting task records.

## Security verification

Required release tests cover tenant isolation, path and archive traversal, webhook replay, OAuth callback binding, token refresh locking, secret redaction, repository permissions, and idempotent GitHub delivery. Live penetration testing and sandbox escape review remain deployment gates. Product connections are restricted to GitHub and Codex; Slack, Gmail, Notion, and Twilio are outside scope.
