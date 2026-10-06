import { listChatSkills } from "@nimbus/database";
import { requireIdentity } from "@/lib/auth";
import { SkillsManager } from "./skills-manager";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Skills",
  description: "Create, upload, edit, and manage reusable Nimbus skills.",
};

export default async function SkillsPage() {
  const identity = await requireIdentity();
  return (
    <main className="page">
      <SkillsManager
        initialSkills={await listChatSkills(
          identity.organizationId,
          identity.userId,
        )}
        readOnly={identity.role === "viewer"}
      />
    </main>
  );
}
