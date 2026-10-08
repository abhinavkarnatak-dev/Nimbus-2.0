"use client";

import { useEffect, useRef, useState } from "react";
import { diagramKind, diagramSourceProblem } from "@/lib/mermaid-source";
import { renderDiagram } from "@/lib/mermaid-renderer";
import styles from "./mermaid-diagram.module.css";

export function MermaidDiagram({
  source,
  complete,
}: {
  source: string;
  complete: boolean;
}) {
  const [result, setResult] = useState<{
    source: string;
    svg?: string;
    error?: string;
  } | null>(null);
  const [sourceView, setSourceView] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const problem = diagramSourceProblem(source);
  const current = result?.source === source ? result : null;
  const error = problem ?? current?.error;
  const svg = complete && !error ? current?.svg : undefined;
  useEffect(() => {
    if (!complete || problem) return;
    let cancelled = false;
    void renderDiagram(source).then(
      (svg) => {
        if (!cancelled) setResult({ source, svg });
      },
      () => {
        if (!cancelled)
          setResult({
            source,
            error:
              "This diagram could not be rendered. Its source is available below.",
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, complete, problem]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setActionMessage("Source copied");
    } catch {
      setActionMessage("Copy unavailable. You can select the source instead.");
      setSourceView(true);
    }
  };
  const download = () => {
    if (!svg) return;
    const url = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "nimbus-diagram.svg";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div ref={container} className={styles.card} data-mermaid-diagram>
      <div className={styles.heading}>
        <span>
          {diagramKind(source) === "sequence"
            ? "Sequence diagram"
            : "Flow diagram"}
        </span>
        <div className={styles.actions}>
          {svg && (
            <>
              <button
                type="button"
                onClick={() => setSourceView((value) => !value)}
              >
                {sourceView ? "Diagram" : "Source"}
              </button>
              <button type="button" onClick={download}>
                Download SVG
              </button>
              <button
                type="button"
                onClick={() => {
                  void container.current
                    ?.requestFullscreen?.()
                    .catch(() =>
                      setActionMessage(
                        "Fullscreen unavailable in this browser.",
                      ),
                    );
                }}
              >
                Fullscreen
              </button>
            </>
          )}
          <button type="button" onClick={() => void copy()}>
            Copy source
          </button>
        </div>
      </div>
      {!complete ? (
        <p className={styles.notice} role="status">
          Preview requires a complete diagram block. Source shown below.
        </p>
      ) : error ? (
        <p className={styles.notice} role="status">
          {error}
        </p>
      ) : !svg ? (
        <p className={styles.notice} role="status">
          Preparing diagram...
        </p>
      ) : null}
      {svg && !sourceView ? (
        <div
          className={styles.preview}
          role="img"
          aria-label={
            diagramKind(source) === "sequence"
              ? "Sequence diagram"
              : "Flowchart"
          }
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <pre className={styles.source}>
          <code>{source}</code>
        </pre>
      )}
      {actionMessage && (
        <p className={styles.notice} role="status">
          {actionMessage}
        </p>
      )}
    </div>
  );
}
