"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import styles from "./repository-sync.module.css";
import { notifyRepositoryUpdate } from "@/lib/repository-updates";
import { formatIstTime } from "@/lib/display-time";

export function RepositorySync({ manual = false }: { manual?: boolean }) {
  const router = useRouter();
  const busy = useRef(false);
  const mounted = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const sync = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      const response = await fetch("/api/github/sync", {
        method: "POST",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("sync failed");
      const result = (await response.json()) as {
        installations: number;
        repositories: number;
      };
      notifyRepositoryUpdate();
      if (!mounted.current) return;
      setMessage(
        result.installations > 0
          ? `Synced from GitHub: ${result.repositories} ${result.repositories === 1 ? "repository" : "repositories"}. Updated ${formatIstTime(new Date())}.`
          : "Connect GitHub in Settings to sync repositories.",
      );
      startTransition(() => router.refresh());
    } catch {
      if (mounted.current) {
        setMessage("");
      }
    } finally {
      busy.current = false;
      if (mounted.current) setSyncing(false);
    }
  }, [router]);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      if (document.visibilityState === "visible") void sync();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [sync]);
  if (!manual) return null;
  const loading = syncing || pending;
  return (
    <div className={styles.controls} aria-busy={loading}>
      <button
        type="button"
        className="button"
        aria-label="Refresh repositories"
        disabled={loading}
        onClick={() => {
          void sync();
        }}
      >
        <RefreshCw
          size={16}
          className={loading ? styles.spinning : undefined}
        />
        {loading ? "Refreshing..." : "Refresh repositories"}
      </button>
      {message && (
        <p role="status" className={styles.status}>
          {message}
        </p>
      )}
    </div>
  );
}
