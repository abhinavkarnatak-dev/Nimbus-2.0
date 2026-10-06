"use client";
import { useEffect, useState } from "react";
import { Download, FileText, LoaderCircle, RefreshCw } from "lucide-react";
import styles from "./artifacts-workbench.module.css";
import { PanelHeader } from "./workbench-panel-header";
interface Artifact {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
}
export function ArtifactsWorkbench({
  taskId,
  requestedPath,
  initialArtifacts,
}: {
  taskId: string;
  requestedPath?: string | undefined;
  initialArtifacts: Artifact[];
}) {
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState("Preparing downloads...");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  async function downloadArtifact(artifact: Artifact) {
    setDownloading(artifact.id);
    setError("");
    try {
      const response = await fetch(
        `/api/tasks/${taskId}/artifacts?download=${encodeURIComponent(artifact.id)}`,
        { cache: "no-store" },
      );
      if (
        !response.ok ||
        response.headers.get("content-type") !== artifact.mimeType
      )
        throw new Error("Could not download this file. Please retry.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = artifact.name.split("/").pop() || "artifact";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const url = `/api/tasks/${taskId}/artifacts`;
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestedPath ? { path: requestedPath } : {}),
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) {
          const saved = await fetch(url, {
            signal: controller.signal,
            cache: "no-store",
          });
          if (saved.ok) setArtifacts((await saved.json()).artifacts);
          throw new Error(result.error ?? "Could not prepare downloads");
        }
        if (!controller.signal.aborted) {
          setArtifacts(result.artifacts);
          setState("");
          setError("");
        }
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) {
          setError(failure.message);
          setState("");
        }
      });
    return () => controller.abort();
  }, [taskId, requestedPath, refresh]);
  return (
    <section className="workspace-panel" aria-label="Task artifacts">
      <PanelHeader
        eyebrow="Task outputs"
        title="Artifacts"
        detail="Preserved task outputs, ready to download."
        action={
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh artifacts"
            disabled={Boolean(state)}
            onClick={() => {
              setState("Preparing downloads...");
              setRefresh((value) => value + 1);
            }}
          >
            <RefreshCw size={15} />
          </button>
        }
      />
      <div className={styles.body} data-workbench-content>
        {state && (
          <p className={`${styles.state} ${styles.loading}`} role="status">
            <LoaderCircle
              size={16}
              className={styles.spinner}
              aria-hidden="true"
            />
            <span>{state}</span>
          </p>
        )}
        {error && (
          <p className={`${styles.state} ${styles.error}`} role="alert">
            {error}
          </p>
        )}
        {!state && !error && !artifacts.length && (
          <p className={styles.state}>No downloadable outputs yet.</p>
        )}
        <div className={styles.list}>
          {!state &&
            artifacts.map((artifact) => (
              <article
                key={artifact.id}
                className={
                  artifact.name === requestedPath ? styles.selected : ""
                }
              >
                <FileText size={22} />
                <div>
                  <div className={styles.fileTitle}>
                    <strong>{artifact.name}</strong>
                    <span className={styles.fileSize}>
                      (
                      {artifact.sizeBytes < 1024
                        ? `${artifact.sizeBytes} B`
                        : artifact.sizeBytes >= 1024 * 1024
                          ? `${(artifact.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
                          : `${(artifact.sizeBytes / 1024).toFixed(1)} KB`}
                      )
                    </span>
                  </div>
                  <small>
                    <time dateTime={artifact.createdAt}>
                      {new Date(artifact.createdAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}
                    </time>
                  </small>
                </div>
                <button
                  type="button"
                  onClick={() => void downloadArtifact(artifact)}
                  disabled={downloading !== null}
                  aria-label={`Download ${artifact.name}`}
                >
                  <Download size={15} />
                  {downloading === artifact.id ? "Downloading..." : "Download"}
                </button>
              </article>
            ))}
        </div>
      </div>
    </section>
  );
}
