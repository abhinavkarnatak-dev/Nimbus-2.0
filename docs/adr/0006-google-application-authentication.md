# Google application authentication through Auth.js

Status: accepted for the personal project on 2026-10-06

## Decision

Use Auth.js through exactly pinned `next-auth@5.0.0-beta.32` for Google OAuth in the Next.js App Router, as requested by the user. Replace the unused ChatGPT application sign-in button. Keep Codex authorization separate because a Google identity grants neither repository permissions nor ChatGPT plan usage.

Auth.js owns OAuth state, PKCE, callback handling, CSRF protection, and encrypted HttpOnly session cookies. Nimbus requires verified Google email and persists accounts by provider subject, not mutable email. Transactional identity provisioning creates an isolated organization and owner membership. Existing identities are not automatically linked by email. Google access and refresh tokens are not persisted or exposed in sessions. Every application request resolves current membership from PostgreSQL.

## Consequences

The existing identity schema is sufficient and requires no migration. An eight-hour JWT session is not a durable database session and has no individual token revocation mechanism; removing membership or deleting a user removes product access. Auth.js v5 is still beta according to the installed registry tag, so this is not a declaration of production launch readiness. Live Google authorization remains unverified until credentials and consent are supplied.

GitHub OAuth uses a separate ten-minute HttpOnly browser nonce, scoped to `/api/github`, instead of depending on the development session cookie. Its database state still binds the user, organization, nonce, expiry, and single-use consumption. This survives Auth.js JWT rotation without weakening the callback's browser binding.

Local demonstration sign-in remains development-only and is rejected in production. Signing in with Google does not silently adopt the demonstration organization's repositories or Codex process. Users connect those services in their own workspace.
