"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./onboarding.module.css";

export function CompleteSetup() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [continueError, setContinueError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let checking = false;
    async function check() {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch("/api/onboarding", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8000),
          ]),
        });
        if (!response.ok)
          throw new Error("Could not confirm connection status");
        const status = (await response.json()) as {
          ready: boolean;
          completed: boolean;
        };
        if (!controller.signal.aborted) {
          setReady(status.completed || status.ready);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Could not confirm your connections. Check again to continue.",
          );
      } finally {
        checking = false;
      }
    }
    void check();
    const timer = window.setInterval(() => void check(), 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refreshKey]);

  async function continueToDashboard() {
    setBusy(true);
    setContinueError("");
    try {
      const result = await fetch("/api/onboarding", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
      });
      if (!result.ok) {
        const body = (await result.json()) as { error?: string };
        throw new Error(
          body.error ?? "Could not finish setup. Please try again.",
        );
      }
      router.replace("/");
      router.refresh();
    } catch (failure) {
      setContinueError(
        failure instanceof Error && failure.name !== "TimeoutError"
          ? failure.message
          : "Could not finish setup. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div className={styles.footer}>
      <p role="status">
        {ready
          ? "Codex is connected. You're ready to go."
          : "Connect Codex to continue. GitHub is optional for repository work."}
      </p>
      <button
        className="button"
        type="button"
        disabled={!ready || busy}
        onClick={() => void continueToDashboard()}
      >
        {busy ? "Continuing..." : "Continue"}
      </button>
      {(error || continueError) && (
        <div>
          <p role="alert">{continueError || error}</p>
          <button
            className="button secondary"
            type="button"
            onClick={() => setRefreshKey((key) => key + 1)}
          >
            Check connections again
          </button>
        </div>
      )}
    </div>
  );
}
