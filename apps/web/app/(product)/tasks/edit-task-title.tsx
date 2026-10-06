"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Pencil, X } from "lucide-react";
import styles from "./edit-task-title.module.css";

export function EditTaskTitle({
  taskId,
  title,
  heading = false,
  href,
}: {
  taskId: string;
  title: string;
  heading?: boolean;
  href?: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState(title);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = saved ?? title;
  if (editing)
    return (
      <form
        className={styles.editor}
        aria-label="Edit session title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            setEditing(false);
          }
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const response = await fetch(`/api/tasks/${taskId}/title`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title: draft }),
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(result.error ?? "Could not save title");
            setSaved(result.title);
            setEditing(false);
            router.refresh();
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not save title",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className={styles.inputRow}>
          <input
            aria-label="Session title"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={120}
            required
            autoFocus
            disabled={busy}
          />
          <button
            className={styles.edit}
            type="submit"
            aria-label="Save title"
            title="Save title"
            disabled={busy || !draft.trim()}
          >
            <Check size={16} />
          </button>
          <button
            className={styles.edit}
            type="button"
            aria-label="Cancel title edit"
            title="Cancel"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            <X size={16} />
          </button>
        </div>
        {busy && <span role="status">Saving…</span>}
        {error && (
          <span role="alert" className={styles.error}>
            {error}
          </span>
        )}
      </form>
    );
  return (
    <div className={styles.title}>
      {heading ? (
        <h1>{current}</h1>
      ) : href ? (
        <Link className="task-title" href={href}>
          {current}
        </Link>
      ) : (
        <span>{current}</span>
      )}
      <button
        type="button"
        className={styles.edit}
        aria-label={`Edit title: ${current}`}
        title="Edit title"
        onClick={() => {
          setDraft(current);
          setError("");
          setEditing(true);
        }}
      >
        <Pencil size={14} />
      </button>
    </div>
  );
}
