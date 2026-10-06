"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { CodexRateLimit } from "@nimbus/codex/rate-limits";
import { codexLimitWarning } from "@/lib/codex-limit-warning";

export function CodexLimitNotice() {
  const [warning, setWarning] =
    useState<ReturnType<typeof codexLimitWarning>>(null);
  useEffect(() => {
    const controller = new AbortController();
    let inflight = false;
    async function refresh() {
      if (inflight) return;
      inflight = true;
      try {
        const response = await fetch("/api/codex/usage", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Limits unavailable");
        const usage = (await response.json()) as {
          status: string;
          limits?: CodexRateLimit[];
        };
        if (!controller.signal.aborted)
          setWarning(
            usage.status === "available"
              ? codexLimitWarning(usage.limits ?? [])
              : null,
          );
      } catch {
        if (!controller.signal.aborted) setWarning(null);
      } finally {
        inflight = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  if (!warning) return null;
  return (
    <span role="status" aria-live="polite">
      <Link
        href="/usage"
        className={`topbar-limit-notice ${warning.severity}`}
        title="View account limit windows and reset times"
      >
        <TriangleAlert size={14} />
        <span>{warning.label}</span>
      </Link>
    </span>
  );
}
