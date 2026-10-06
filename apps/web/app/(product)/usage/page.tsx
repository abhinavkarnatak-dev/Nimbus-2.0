import { requireIdentity } from "@/lib/auth";
import { CodexUsage } from "./codex-usage";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Usage",
  description: "Review limits and usage for your connected Codex account.",
};

export default async function UsagePage() {
  await requireIdentity();
  return (
    <main className="page usage-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Usage</p>
          <h1>Usage and limits.</h1>
          <p className="lede">Check your connected Codex account limits.</p>
        </div>
      </div>
      <CodexUsage />
    </main>
  );
}
