"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Upload } from "lucide-react";
import {
  agentInstructionsSchema,
  MAX_INSTRUCTION_LENGTH,
  MAX_INSTRUCTION_FILE_BYTES,
} from "@nimbus/shared";
import styles from "./instructions-editor.module.css";

export function InstructionsEditor({
  initialContent,
}: {
  initialContent: string;
}) {
  const [content, setContent] = useState(initialContent);
  const [saved, setSaved] = useState(initialContent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    try {
      if (!/\.(md|txt)$/i.test(file.name))
        throw new Error("Choose an MD or TXT file.");
      if (file.size > MAX_INSTRUCTION_FILE_BYTES)
        throw new Error("Choose a file smaller than 80 KB.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      const parsed = agentInstructionsSchema.safeParse({ content: text });
      if (!parsed.success)
        throw new Error("Use a plain UTF-8 text file up to 20,000 characters.");
      setContent(parsed.data.content);
      setNotice(`Loaded ${file.name}. Save to apply these instructions.`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not read that file.",
      );
    }
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/instructions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not save instructions.");
      setContent(result.content);
      setSaved(result.content);
      setNotice(
        result.content
          ? "Saved. Applies from your next message in any session."
          : "Saved. General instructions are now cleared.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save instructions.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.section} aria-label="Instructions">
      <div className={`card ${styles.card}`}>
        <label htmlFor="general-instructions">General instructions</label>
        <textarea
          id="general-instructions"
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setNotice("");
          }}
          maxLength={MAX_INSTRUCTION_LENGTH}
          disabled={busy}
          rows={6}
          placeholder="For example: use hyphens only, not en or em dashes. Keep replies concise."
        />
        <p className={styles.hint}>
          Type instructions or import an MD/TXT file, then save. Changes apply
          to new sessions and follow-ups, not a reply already running. Do not
          include secrets.
        </p>
        <div className={styles.actions}>
          <input
            ref={fileInput}
            type="file"
            accept=".md,.txt,text/plain,text/markdown"
            aria-label="Upload instructions file"
            onChange={(event) => void importFile(event)}
            hidden
          />
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={14} />
            Upload file
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy || !content}
            onClick={() => {
              setContent("");
              setNotice("Save to clear your instructions.");
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || content === saved}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save instructions"}
          </button>
          <span className={styles.count}>
            {content.length.toLocaleString()} / 20,000
          </span>
        </div>
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
