"use client";
import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import styles from "./changes-workbench.module.css";
import { PanelHeader } from "./workbench-panel-header";
type Change = {
  path: string;
  previousPath?: string;
  status: string;
  patch: string;
  additions: number;
  deletions: number;
  binary: boolean;
};
function diffLines(patch: string) {
  let inHunk = false;
  return patch.split("\n").map((line) => {
    if (line.startsWith("diff --git ")) inHunk = false;
    if (line.startsWith("@@")) {
      inHunk = true;
      return { line, className: styles.hunk };
    }
    return {
      line,
      className:
        inHunk && line.startsWith("+")
          ? styles.addition
          : inHunk && line.startsWith("-")
            ? styles.deletion
            : undefined,
    };
  });
}

export function ChangesWorkbench({
  taskId,
  refreshKey,
}: {
  taskId: string;
  refreshKey: number;
}) {
  const [files, setFiles] = useState<Change[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const requestKey = `${taskId}:${refreshKey}:${revision}`;
  const loading = loadedKey !== requestKey;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/tasks/${taskId}/files?operation=changes`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error ?? "Changes could not be loaded");
        if (!controller.signal.aborted) {
          setFiles(result.files);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Changes could not be loaded",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedKey(requestKey);
      });
    return () => controller.abort();
  }, [taskId, revision, refreshKey, requestKey]);
  return (
    <div className="workspace-panel">
      <PanelHeader
        eyebrow="Repository changes"
        title="Changes"
        detail="Session changes compared with the repository’s starting branch."
        action={
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh changes"
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={16} />
          </button>
        }
      />
      <div className={styles.body} data-workbench-content>
        {loading ? (
          <div className={styles.state} role="status" aria-live="polite">
            <LoaderCircle
              size={16}
              className={styles.spinner}
              aria-hidden="true"
            />
            <span>Loading changes…</span>
          </div>
        ) : error ? (
          <p className={`${styles.state} ${styles.error}`} role="alert">
            {error}
          </p>
        ) : files.length === 0 ? (
          <p className={styles.state}>No changes in this session.</p>
        ) : (
          <>
            <p className={styles.totals}>
              {files.length} {files.length === 1 ? "file" : "files"} changed{" "}
              <b>+{files.reduce((sum, file) => sum + file.additions, 0)}</b>{" "}
              <i>−{files.reduce((sum, file) => sum + file.deletions, 0)}</i>
            </p>
            {files.map((file) => (
              <details className={styles.file} key={file.path}>
                <summary>
                  <span className={styles.path}>
                    {file.previousPath
                      ? `${file.previousPath} → ${file.path}`
                      : file.path}
                  </span>
                  <span>{file.status}</span>
                  {file.binary ? (
                    <span>Binary</span>
                  ) : (
                    <>
                      <b>+{file.additions}</b>
                      <i>−{file.deletions}</i>
                    </>
                  )}
                </summary>
                <pre aria-label={`Diff for ${file.path}`}>
                  {diffLines(file.patch).map(({ line, className }, index) => (
                    <span className={className} key={index}>
                      {line}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              </details>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
