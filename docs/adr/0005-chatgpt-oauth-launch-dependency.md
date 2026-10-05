# ADR 0005: ChatGPT OAuth is a launch dependency

Status: Accepted

## Decision

Nimbus uses official Sign in with ChatGPT with OpenID Connect and PKCE. Eligible ChatGPT-plan access is an explicit feature flag and launch dependency. Nimbus does not request an OpenAI API key and does not read local Codex authentication files.

If commercial access is unavailable, production task execution fails with a clear unavailable status. The deterministic fake coding provider is permitted only in tests and explicit local development.
