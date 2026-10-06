import { db, eq, integrationAccounts } from "@nimbus/database";
import { requireIdentity } from "@/lib/auth";
import { hasGitHubAppConfig } from "@nimbus/github";
import Image from "next/image";
import { ArrowUpRight, LockKeyhole, RotateCw } from "lucide-react";
import { integrationStatus } from "@/lib/integration-status";
import { CodexConnection } from "./codex-connection";
import styles from "./connections.module.css";

export async function ConnectionCards({
  onboarding = false,
}: {
  onboarding?: boolean;
}) {
  const identity = await requireIdentity();
  const rows = await db()
    .select()
    .from(integrationAccounts)
    .where(eq(integrationAccounts.organizationId, identity.organizationId));
  const byKind = new Map(rows.map((row) => [row.kind, row]));
  const integrations = [
    ["github", "GitHub App", "Branches and pull requests"],
    ["chatgpt", "Codex", "Identity and eligible Codex plan usage"],
  ] as const;
  return (
    <div className={`connections-grid ${styles.layout}`}>
      {integrations.map(([kind, name, detail]) => {
        if (kind === "chatgpt") return <CodexConnection key={kind} />;
        const row = byKind.get(kind);
        const status = integrationStatus(row?.status);
        return (
          <section className="connection-card" key={kind}>
            <div className="connection-card-header">
              <div className="connection-logo">
                <Image
                  src={`/integrations/${kind}.svg`}
                  alt={`${name} logo`}
                  width={32}
                  height={32}
                  unoptimized
                />
              </div>
              <span
                className={`connection-status connection-status-${status.tone}`}
              >
                <span className="connection-status-dot" aria-hidden="true" />
                {status.label}
              </span>
            </div>
            <h2>{name}</h2>
            <p className="connection-description">{detail}</p>
            {kind === "github" && hasGitHubAppConfig() ? (
              <form
                className="connection-card-footer"
                action="/api/github/connect"
                method="post"
              >
                <input
                  type="hidden"
                  name="returnTo"
                  value={onboarding ? "/onboarding" : "/settings#connections"}
                />
                <button
                  className={`connection-action ${row ? "connection-action-reconnect" : "connection-action-connect"}`}
                  type="submit"
                >
                  {row ? (
                    <RotateCw size={16} aria-hidden="true" />
                  ) : (
                    <ArrowUpRight size={16} aria-hidden="true" />
                  )}
                  {row ? "Reconfigure GitHub" : "Connect GitHub"}
                </button>
                <p className="connection-hint">
                  Choose repositories on GitHub. We handle the rest.
                </p>
              </form>
            ) : (
              <div className="connection-card-footer">
                <button
                  className="connection-action connection-action-unavailable"
                  type="button"
                  disabled
                  aria-describedby={`connection-hint-${kind}`}
                >
                  <LockKeyhole size={15} aria-hidden="true" />
                  Configuration Required
                </button>
                <p className="connection-hint" id={`connection-hint-${kind}`}>
                  {kind === "github"
                    ? "Add GitHub App settings to enable connection."
                    : "Connection setup is not available yet."}
                </p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
