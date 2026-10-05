import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Durable Nimbus control-plane coordinator. Codex app-server remains the coding agent.",
  model: "openai/gpt-5.4",
  defaultTools: false,
  limits: {
    maxOutputTokens: 2_000,
    sessionTimeoutMs: 86_400_000,
  },
  experimental: {
    workflow: {
      world: "@workflow/world-postgres",
    },
  },
});
