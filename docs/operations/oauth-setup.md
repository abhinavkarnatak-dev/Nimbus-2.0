# OAuth setup

Register approved Sign in with ChatGPT and GitHub App clients with exact HTTPS callbacks. ChatGPT sign-in uses OpenID Connect with PKCE and server-side code exchange. Verify issuer, audience, nonce, state, code verifier, token timestamps, and the signed ID token before issuing a Nimbus session.

Store refresh credentials with envelope encryption under a managed key encryption service. Acquire a lease before refreshing. Never put access or refresh tokens in URLs, command arguments, logs, PostHog, browser payloads, workspaces, prompts, or artifacts.
