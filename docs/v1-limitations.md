# Nimbus V1 limitations

This report is based on read-only inspection of `C:\Users\abhis\Downloads\AK-Dev\AI\Projects\Nimbus\v1`. No V1 file was copied or modified.

## What V1 attempted

V1 attempted a secure, single-repository coding workflow. It authenticated users, listed GitHub repositories, cloned a public repository into E2B, let a Gemini-backed LangGraph loop choose one hand-authored tool at a time, validated a patch, and used a trusted backend for branch and pull request operations. The architecture correctly treated repository content and command output as untrusted.

## Concrete limits

### One effective session per user

`apps/api/src/sessions/service.ts` calls `findActive(userId)` and returns `ACTIVE_SESSION_EXISTS` with the message `You already have a session running. Wait for it to finish or cancel it first.` The integration test `apps/api/test/integration/sessions.test.ts` explicitly asserts that concurrent creation leaves exactly one active session. This prevents independent concurrent tasks even when repositories and branches do not conflict.

### A custom model loop, not Codex

`apps/api/src/agent/graph/graph.ts` builds a custom LangGraph `StateGraph`. It owns clone, scope, retrieval, planning, reasoning, execution, review, verification, and completion behavior. `apps/api/src/llm/gemini-text.ts` supplies the model adapter. There is no Codex CLI, Codex app-server, Codex thread, or official Codex protocol integration in the dependency manifests.

This architecture made Nimbus responsible for coding-agent behavior that Codex already owns, including context selection, tool choice, iteration, completion judgment, and recovery semantics.

### Rigid global graph and bounded action vocabulary

The graph hardcodes nodes and transitions around scoping, retrieval, planning, reasoning, execution, review, verification, and patch preparation. The code also creates a change plan automatically when a code-change task reaches reasoning without one. This is more flexible than a simple three-step bot, but it is still a product-owned global workflow that constrains every task.

`apps/api/src/agent/registry/tools.ts` defines the complete built-in tool list: tree listing, code search, file reading, file creation, patch application, a restricted command runner, trusted checks, Git status, prepare commit, message user, finish, and wait. Adding a normal engineering capability requires application code and a deployment.

### Limited editing and command behavior

The tool descriptions show important restrictions. `run_command` accepts an argv allowlist without shell expansion. `apply_patch` is the central edit path. File rename and deletion require special approval behavior. There is no general Codex CLI environment where the coding agent can naturally use repository-specific tools, package managers, official documentation search, web search, or MCP integrations.

### Delivery stops short of a complete product loop

The `prepare_commit` tool says it does not push or open a pull request. Delivery happens as a separate custom backend phase. This separation is a useful trust boundary, but V1 does not give Codex ownership of reviewing and validating its work before the trusted layer performs an idempotent delivery.

### Session recovery loses workspace state

`docs/architecture.md` states that the sandbox is torn down while waiting for clarification or approval and that resumption rebuilds from verified remote state. It also states that `MongoCheckpointSaver` is deliberately not wired because the filesystem does not survive the worker. The document acknowledges that files read or changed during the previous attempt are not carried across. This makes recovery safe but incomplete and can duplicate inspection or lose uncommitted progress.

### Reserved state without a working durable subsystem

The V1 session shape contains `checkpointId` and `toolEvents`, but `docs/architecture.md` says these are reserved fields rather than API promises and that the checkpoint saver is not wired. The result is bespoke session-level recovery instead of a durable workflow that can reconnect to an independently durable workspace.

### No durable memory product

There is no user, organization, repository, or task memory domain in the application manifests or source layout. Repository retrieval exists, and an optional Qdrant index is described, but retrieval from the current checkout is not durable product memory. There is no UI for inspecting, explaining, deleting, disabling, or retaining memory.

### No bounded supporting-agent model

The V1 agent directory contains one LangGraph agent loop. There is no durable supporting-agent contract, bounded delegation input, independent context or secret policy, or parent validation of advisory output.

### Observability is local logging, not a product control plane

V1 uses Pino and durable session events, but has no PostHog dependency or product-wide trace integration. There is no single system connecting onboarding funnels, task outcomes, Codex lifecycle, sandbox metrics, integration reliability, and privacy-safe operational alerts.

### Frontend surface is incomplete for production operation

`apps/web/src/sessions/tabs.ts` defines only `overview`, `process`, `changes`, `checks`, and `pull_request`. The requested production surfaces for evolving plan, files, terminal, artifacts, and logs do not exist as distinct durable views. The pull request view reflects recorded session data, while V1 documentation says merged or closed state can be only a local label and is not read back from GitHub.

V1 is a Vite single-page application, not a Next.js control plane. Its README labels local fake-adapter mode as not implemented and labels model-provider data disclosure documentation as not implemented.

### Tenant and repository scope are narrower than the target product

V1 centers on a user and a session. It has no organization membership model, per-organization quotas, repository policies, scoped skills, scoped memories, or organization audit experience. Its documented launch scope is public repositories only.

### Integrations and product channels are absent

There is no Eve channel layer and no Slack, Gmail, Notion, or Twilio product implementation. Email in V1 is operational mail, not a scoped Gmail integration. Dynamic skills and connection resolution do not exist.

## V2 conclusion

V2 must not port this loop, schema, tool protocol, or session abstraction. Useful V1 lessons are treated as evidence only: credentials must remain outside hostile workspaces, deterministic authorization must guard trusted side effects, and durable ordered events are necessary for refresh recovery. V2 independently implements those properties with PostgreSQL, Eve, Codex app-server, isolated task workspaces, and explicit control-plane policies.
