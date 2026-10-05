import { db, eq, integrationAccounts } from "@nimbus/database";
import { requireIdentity } from "@/lib/auth";
import { hasGitHubAppConfig } from "@nimbus/github";

export default async function IntegrationsPage() {
  const identity = await requireIdentity();
  const rows = await db()
    .select()
    .from(integrationAccounts)
    .where(eq(integrationAccounts.organizationId, identity.organizationId));
  const byKind = new Map(rows.map((row) => [row.kind, row]));
  const integrations = [
    ["github", "GitHub App", "Branches and pull requests"],
    ["slack", "Slack", "Task conversations in authorized threads"],
    ["gmail", "Gmail", "Scoped search, drafts, and confirmed sends"],
    ["notion", "Notion", "Approved workspaces and parent pages"],
    ["twilio", "Twilio", "Opt-in reminders with quiet hours"],
    ["chatgpt", "ChatGPT", "Identity and eligible Codex plan usage"],
  ] as const;
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Integrations</p>
          <h1>Connections with explicit boundaries.</h1>
          <p className="lede">
            No integration receives repository content or authority outside its
            configured scope.
          </p>
        </div>
      </div>
      <div className="surface-grid">
        {integrations.map(([kind, name, detail]) => {
          const row = byKind.get(kind);
          return (
            <section className="card surface-card" key={kind}>
              <span
                className={`status ${row?.status === "active" ? "completed" : ""}`}
              >
                {row?.status ?? "not connected"}
              </span>
              <h2 style={{ marginTop: 15 }}>{name}</h2>
              <p>{detail}</p>
              {kind === "github" && hasGitHubAppConfig() ? (
                <form action="/api/github/connect" method="post">
                  <button className="button secondary" type="submit">
                    {row ? "Reconnect GitHub" : "Connect GitHub"}
                  </button>
                  <p>
                    Install the App on your test repository in GitHub before
                    connecting.
                  </p>
                  <a
                    href={`https://github.com/apps/${encodeURIComponent(process.env.GITHUB_APP_SLUG!)}/installations/new`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Install GitHub App
                  </a>
                </form>
              ) : (
                <button className="button secondary" disabled={!row}>
                  {row ? "Manage" : "Configuration required"}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
