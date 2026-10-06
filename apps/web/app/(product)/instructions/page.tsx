import { requireIdentity } from "@/lib/auth";
import { readAgentInstructions } from "@nimbus/database";
import { InstructionsEditor } from "./instructions-editor";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Instructions",
  description:
    "Manage the instructions Nimbus follows across your workspace sessions.",
};

export default async function InstructionsPage() {
  const identity = await requireIdentity();
  const instructions = await readAgentInstructions(
    identity.organizationId,
    identity.userId,
  );
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Preferences</p>
          <h1>Instructions</h1>
          <p className="lede">
            Your preferences for Nimbus across all your sessions in this
            workspace.
          </p>
        </div>
      </div>
      <InstructionsEditor initialContent={instructions} />
    </main>
  );
}
