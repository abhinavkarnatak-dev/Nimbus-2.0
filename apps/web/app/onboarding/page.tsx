import { requireIdentity } from "@/lib/auth";
import { onboardingStatus } from "@/lib/onboarding";
import { ConnectionCards } from "../(product)/settings/connection-cards";
import { CompleteSetup } from "./complete-setup";
import { redirect } from "next/navigation";
import styles from "./onboarding.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect your workspace",
  description:
    "Connect your own Codex account to start using Nimbus, with optional GitHub repository access.",
  robots: { index: false, follow: false },
};

export default async function OnboardingPage() {
  const identity = await requireIdentity();
  if ((await onboardingStatus(identity)).completed) redirect("/");
  return (
    <main className={styles.page}>
      <section className={styles.content}>
        <p className="eyebrow">Welcome to Nimbus</p>
        <h1>Set up {identity.organizationName}.</h1>
        <p className="lede">
          Connect Codex to start chatting. GitHub is optional and only needed
          for repository work. Manage these accounts later in Connections.
        </p>
        <ConnectionCards onboarding />
        <CompleteSetup />
      </section>
    </main>
  );
}
