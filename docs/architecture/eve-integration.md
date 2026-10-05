# Eve integration

Eve 0.71.0 is pinned exactly and isolated behind the `apps/eve-agent` boundary. Its package documentation under `node_modules/eve/docs` and exported TypeScript declarations are the source of truth for authored APIs.

Eve supplies durable sessions, workflows, scheduling, channel delivery, sandbox integration, dynamic skills, memory hooks, input requests, cancellation, and bounded subagents. Nimbus maps Eve activity into its own tenant-aware task and event domain. Eve never replaces Codex as the primary coding agent.
