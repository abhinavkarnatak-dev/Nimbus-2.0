# Sandbox model

`WorkspaceProvider` exposes provision, resume, command execution, managed processes, stdout and stderr streaming, file access, file listing, resource inspection, snapshots, restoration, cancellation, and destruction.

Vercel Sandbox is the first production provider through Eve. Tests use an explicit deterministic in-process provider. Production startup rejects fake-provider configuration.

Every workspace enforces path containment, resource and time limits, process limits, egress policy, secret redaction, idle cleanup, and artifact retention. Repository code never receives control-plane or GitHub credentials.
