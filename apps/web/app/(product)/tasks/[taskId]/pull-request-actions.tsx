"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import styles from "./pull-request-actions.module.css";
export function PullRequestActions({
  taskId,
  number,
  state,
  headSha,
}: {
  taskId: string;
  number: number | null;
  state: string;
  headSha: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resultState, setOutcome] = useState<string | null>(null);
  const outcome = resultState ?? state;
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"close" | "merge">("merge");
  const [method, setMethod] = useState("squash");
  async function act(action: "close" | "merge") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/pull-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          expectedHeadSha: headSha,
          mergeMethod: method,
          confirmed: true,
          number,
        }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "GitHub action failed");
      setOutcome(value.state);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "GitHub action failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`pr-actions ${styles.actions}`}>
      {outcome === "open" ? (
        <>
          <select
            aria-label="Merge method"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            disabled={busy}
          >
            <option value="squash">Squash and merge</option>
            <option value="merge">Merge commit</option>
            <option value="rebase">Rebase and merge</option>
          </select>
          <button
            type="button"
            className={styles.merge}
            disabled={busy || !headSha}
            onClick={() => {
              setAction("merge");
              setError("");
              setOpen(true);
            }}
          >
            {busy ? "Working…" : "Merge pull request"}
          </button>
          <button
            type="button"
            className={styles.danger}
            disabled={busy || !headSha}
            onClick={() => {
              setAction("close");
              setError("");
              setOpen(true);
            }}
          >
            Close pull request
          </button>
          <p>GitHub branch protection and required checks still apply.</p>
        </>
      ) : (
        <p
          role="status"
          className={
            outcome === "merged" ? styles.mergedResult : styles.closedResult
          }
        >
          Pull request {outcome}.
        </p>
      )}
      {error && !open && <p role="alert">{error}</p>}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content className={styles.modal}>
            <Dialog.Close
              className={styles.dismiss}
              aria-label="Dismiss confirmation"
            >
              <X size={18} />
            </Dialog.Close>
            <Dialog.Title
              className={`${styles.title} ${outcome === "merged" ? styles.mergedResult : outcome === "closed" ? styles.closedResult : ""}`}
            >
              {outcome !== "open"
                ? `Pull request ${outcome}`
                : action === "merge"
                  ? `Merge PR #${number}?`
                  : `Close PR #${number}?`}
            </Dialog.Title>
            <Dialog.Description className={styles.description}>
              {outcome !== "open"
                ? `GitHub confirmed that PR #${number} is ${outcome}.`
                : action === "merge"
                  ? "This merges the reviewed changes into the base branch. GitHub's required checks and branch protection still apply."
                  : "This closes the pull request without merging. Your session's files and branch will remain available."}
            </Dialog.Description>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <div className={styles.footer}>
              <Dialog.Close className={styles.cancel}>
                {outcome !== "open" ? "Done" : "Cancel"}
              </Dialog.Close>
              {outcome === "open" && (
                <button
                  type="button"
                  className={
                    action === "close"
                      ? styles.confirmDanger
                      : styles.confirmMerge
                  }
                  disabled={busy}
                  onClick={() => void act(action)}
                >
                  {busy
                    ? "Working…"
                    : action === "close"
                      ? "Close pull request"
                      : "Confirm merge"}
                </button>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
