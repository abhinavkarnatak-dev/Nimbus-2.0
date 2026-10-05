# ADR 0001: Hybrid Eve and Codex architecture

Status: Accepted

## Context

Nimbus needs durable product orchestration without replacing the coding agent with a custom model loop.

## Decision

Codex app-server is the only production `CodingAgentProvider`. It owns the adaptive repository coding loop. Eve owns durable outer workflow concerns such as session persistence, parking, resumption, channels, scheduling, skills, memory hooks, subagents, cancellation, and event delivery.

Nimbus domain code owns tenant authorization, task state transitions, the durable event model, workspace references, OAuth credential custody, and trusted GitHub side effects.

The `running` task state can contain any number and order of Codex turns and tool events. Coding actions are events, not lifecycle states.

## Consequences

- Nimbus does not define a fixed analyze, implement, test sequence.
- Eve and Codex are behind narrow adapters so preview API changes do not leak into the domain.
- A deterministic fake provider is available only through explicit non-production configuration.
