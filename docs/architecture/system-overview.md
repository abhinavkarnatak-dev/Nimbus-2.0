# System overview

Nimbus has a control plane and an execution plane.

The control plane runs in the web application and trusted workers. It owns identities, organizations, repository authorization, tasks, events, workflow references, credentials, integrations, audit records, quotas, and trusted pull request effects.

The execution plane owns task workspaces, checkout, Codex app-server processes, command and file activity, checks, artifacts, snapshots, resource measurements, cancellation, and cleanup. It accepts only server-signed task claims and resolves all ownership from the control plane.

Data flows from a user request to a durable task row and outbox record. Eve schedules execution. The executor provisions or resumes a workspace, starts Codex, streams normalized events into PostgreSQL, and checkpoints protocol identifiers. After Codex reports official completed status and deterministic verification passes, the trusted GitHub adapter idempotently pushes and opens or updates the task pull request.
