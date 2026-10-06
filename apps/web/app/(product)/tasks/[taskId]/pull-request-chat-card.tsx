import { ExternalLink, GitPullRequest } from "lucide-react";
import type { PrCardData } from "@/lib/pr-card";
import styles from "./pull-request-chat-card.module.css";

export function PullRequestChatCard({
  data,
  onOpenFile,
}: {
  data: PrCardData;
  onOpenFile: (reference: string) => void;
}) {
  const stats =
    data.additions !== undefined &&
    data.deletions !== undefined &&
    data.changedFiles !== undefined;
  return (
    <section
      className={styles.card}
      aria-label={`Pull request #${data.number}`}
    >
      <a
        className={styles.title}
        href={data.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {data.title}
        <ExternalLink size={16} aria-hidden="true" />
      </a>
      <div className={styles.meta}>
        <a href={data.url} target="_blank" rel="noopener noreferrer">
          <GitPullRequest size={16} aria-hidden="true" />
          {data.repository} #{data.number}
        </a>
        {stats ? (
          <>
            <span>
              {data.changedFiles} {data.changedFiles === 1 ? "file" : "files"}{" "}
              changed
            </span>
            <span className={styles.added}>+{data.additions} added</span>
            <span className={styles.deleted}>−{data.deletions} deleted</span>
          </>
        ) : (
          <span>Change statistics unavailable</span>
        )}
      </div>
      {data.files && data.files.length > 0 && (
        <details className={styles.files}>
          <summary>Changed files</summary>
          <ul>
            {data.files.map((file) => (
              <li key={file.path}>
                <button type="button" onClick={() => onOpenFile(file.path)}>
                  {file.path}
                </button>
                <span className={styles.added}>+{file.additions}</span>
                <span className={styles.deleted}>−{file.deletions}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
