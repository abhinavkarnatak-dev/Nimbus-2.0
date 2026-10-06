import { ConnectionCards } from "./connection-cards";
import styles from "./connections.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connections",
  description:
    "Connect your Codex account and manage GitHub repository access for Nimbus.",
};

export default async function SettingsPage() {
  return (
    <main className="page connections-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Integrations</p>
          <h1>Connections</h1>
          <p className="lede">
            Manage GitHub repository access and your Codex coding account.
          </p>
        </div>
      </div>
      <section
        id="connections"
        className={styles.section}
        aria-label="Connections"
      >
        <ConnectionCards />
      </section>
    </main>
  );
}
