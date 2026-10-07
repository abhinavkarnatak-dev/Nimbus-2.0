"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatIstDateTime } from "@/lib/display-time";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import {
  codexLimitReached,
  orderCodexRateLimits,
  type CodexRateLimit,
  type CodexRateWindow,
} from "@nimbus/codex/rate-limits";

interface UsageState {
  status: "loading" | "available" | "unavailable" | "disconnected";
  limits?: CodexRateLimit[];
  updatedAt?: string;
  error?: string;
}
export function CodexUsage() {
  const [usage, setUsage] = useState<UsageState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let inflight = false;
    async function refresh() {
      if (inflight) return;
      inflight = true;
      setRefreshing(true);
      try {
        const response = await fetch("/api/codex/usage", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Could not load usage");
        const next = (await response.json()) as UsageState;
        if (!controller.signal.aborted)
          setUsage((previous) =>
            next.status === "unavailable" && previous.limits
              ? {
                  ...previous,
                  status: "unavailable",
                  error: next.error ?? "Could not refresh account limits.",
                }
              : next,
          );
      } catch {
        if (!controller.signal.aborted)
          setUsage((previous) => ({
            ...previous,
            status: "unavailable",
            error:
              "Could not refresh usage. Showing the last confirmed data, if available.",
          }));
      } finally {
        inflight = false;
        if (!controller.signal.aborted) setRefreshing(false);
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
  }, [revision]);
  const exhausted = usage.limits?.some(codexLimitReached);
  return (
    <section
      className="card codex-usage-card"
      aria-labelledby="codex-limits-heading"
    >
      <header className="codex-usage-heading">
        <div>
          <p className="eyebrow">Connected account</p>
          <h2 id="codex-limits-heading">Codex limits</h2>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={refreshing}
          onClick={() => setRevision(revision + 1)}
        >
          <RefreshCw size={15} /> Refresh limits
        </button>
      </header>
      {usage.status === "loading" && (
        <p role="status">Fetching limits from Codex...</p>
      )}
      {usage.status === "disconnected" && (
        <p>
          Connect your Codex account to see its live limits.{" "}
          <Link href="/settings#connections">Connect Codex</Link>
        </p>
      )}
      {usage.status === "unavailable" && (
        <p role="status" className="usage-limit-alert">
          {usage.error} These limits are not confirmed current.{" "}
          <Link href="/settings#connections">Manage connections</Link>
        </p>
      )}
      {exhausted && (
        <p className="usage-limit-alert" role="status">
          Codex limit reached. New tasks may be blocked until a window resets or
          account credits become available.
        </p>
      )}
      {usage.status === "available" && !usage.limits?.length && (
        <p>
          Codex did not return limit windows for this account. Nimbus cannot
          infer a quota.
        </p>
      )}
      <div className="codex-limits-grid">
        {orderCodexRateLimits(usage.limits ?? []).map((limit) => (
          <article className="codex-limit-bucket" key={limit.id}>
            <div className="codex-limit-title">
              <h3>{limit.name}</h3>
              <span
                className={`connection-status connection-status-${codexLimitReached(limit) ? "disconnected" : "connected"}`}
              >
                {codexLimitReached(limit) ? "Limit reached" : "Available"}
              </span>
            </div>
            {limit.planType && (
              <p className="usage-plan">Plan: {limit.planType}</p>
            )}
            {limit.primary && (
              <LimitWindow label="Primary window" value={limit.primary} />
            )}
            {limit.secondary && (
              <LimitWindow label="Secondary window" value={limit.secondary} />
            )}
            {!limit.primary && !limit.secondary && (
              <p>No percentage windows returned.</p>
            )}
            {limit.credits && (
              <p>
                Credits:{" "}
                {limit.credits.unlimited
                  ? "Unlimited"
                  : (limit.credits.balance ??
                    (limit.credits.hasCredits
                      ? "Available; balance not supplied"
                      : "None available"))}
              </p>
            )}
          </article>
        ))}
      </div>
      <footer className="codex-usage-footer">
        <span>
          {usage.updatedAt
            ? `Last checked: ${formatIstDateTime(usage.updatedAt)}`
            : "Limits are provided by your connected Codex account."}
        </span>
        <a
          href="https://chatgpt.com/codex/settings/usage"
          target="_blank"
          rel="noopener noreferrer"
        >
          Manage Codex usage <ArrowUpRight size={14} />
        </a>
      </footer>
    </section>
  );
}
function LimitWindow({
  label,
  value,
}: {
  label: string;
  value: CodexRateWindow;
}) {
  const used = Math.min(100, Math.max(0, value.usedPercent));
  const minutes = value.windowDurationMins;
  const duration =
    minutes === null
      ? ""
      : minutes >= 1440 && minutes % 1440 === 0
        ? `${minutes / 1440}-day`
        : minutes >= 60 && minutes % 60 === 0
          ? `${minutes / 60}-hour`
          : `${minutes}-minute`;
  return (
    <div className="codex-limit-window">
      <div>
        <strong>{duration ? `${duration} window` : label}</strong>
        <span>
          {Math.round(value.usedPercent)}% used / {Math.round(100 - used)}%
          remaining
        </span>
      </div>
      <progress
        max={100}
        value={used}
        data-exhausted={used >= 100}
        aria-label={`${label} usage`}
      />
      <p>
        {value.resetsAt
          ? `Resets ${formatIstDateTime(value.resetsAt * 1000)}`
          : "Reset time not provided by Codex"}
      </p>
    </div>
  );
}
