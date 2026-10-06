"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  FileCode2,
  Folder,
  History,
  RefreshCw,
  Download,
  LoaderCircle,
} from "lucide-react";
import styles from "./files-workbench.module.css";
import { fileReferenceTarget } from "@/lib/chat-links";

interface Entry {
  name: string;
  path: string;
  kind: string;
}
interface Commit {
  revision: string;
  date: string;
  author: string;
  subject: string;
  path: string;
}
async function request<T>(
  taskId: string,
  query: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `/api/tasks/${encodeURIComponent(taskId)}/files?${new URLSearchParams(query)}`,
    { cache: "no-store", ...(signal ? { signal } : {}) },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? "Files could not be loaded");
  return result as T;
}

export function FilesWorkbench({
  taskId,
  path = "",
  line,
  revision,
  historyPath,
}: {
  taskId: string;
  path?: string | undefined;
  line?: number | undefined;
  revision?: string | undefined;
  historyPath?: string | undefined;
}) {
  const router = useRouter();
  const [refresh, setRefresh] = useState(0);
  const navigate = (file: string, version?: string) => {
    const query = fileReferenceTarget(file);
    if (version) {
      query.set("revision", version);
      query.set("historyFile", historyPath ?? path);
    }
    router.push(`/tasks/${taskId}?${query}`, { scroll: false });
  };
  return (
    <section className={styles.browser} aria-label="Repository files">
      <header className={styles.header}>
        <strong>Repository files</strong>
        <button
          type="button"
          aria-label="Refresh workspace files"
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </header>
      <div className={styles.layout}>
        <nav className={styles.tree} aria-label="Repository file structure">
          <Directory
            key={refresh}
            taskId={taskId}
            path=""
            selected={path}
            onSelect={navigate}
          />
        </nav>
        {path ? (
          <FileInspector
            key={`${taskId}:${historyPath ?? path}:${refresh}`}
            taskId={taskId}
            path={path}
            historyPath={historyPath ?? path}
            line={line}
            revision={revision}
            refresh={refresh}
            onVersion={navigate}
          />
        ) : (
          <div className={styles.empty}>
            Choose a file from the repository tree or click a file reference in
            chat.
          </div>
        )}
      </div>
    </section>
  );
}

function Directory({
  taskId,
  path,
  selected,
  onSelect,
}: {
  taskId: string;
  path: string;
  selected: string;
  onSelect: (path: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    request<{ entries: Entry[] }>(
      taskId,
      { operation: "tree", path },
      controller.signal,
    )
      .then((result) => setEntries(result.entries))
      .catch((failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [taskId, path]);
  if (error)
    return (
      <p role="alert" className={styles.error}>
        {error}
      </p>
    );
  if (!entries)
    return (
      <p className={`${styles.empty} ${styles.loading}`} role="status">
        <LoaderCircle size={16} className={styles.spinner} aria-hidden="true" />
        <span>Loading files...</span>
      </p>
    );
  if (!entries.length) return <p className={styles.empty}>Empty directory</p>;
  return (
    <ul className={styles.entries}>
      {entries.map((entry) => (
        <li key={entry.path}>
          {entry.kind === "directory" ? (
            <DirectoryBranch
              entry={entry}
              taskId={taskId}
              selected={selected}
              onSelect={onSelect}
            />
          ) : (
            <button
              type="button"
              className={selected === entry.path ? styles.selected : ""}
              title={entry.path}
              disabled={entry.kind === "link"}
              aria-current={selected === entry.path ? "true" : undefined}
              onClick={() => onSelect(entry.path)}
            >
              <FileCode2 size={14} />
              <span>{entry.name}</span>
              {entry.kind === "link" && <small>Link</small>}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
function DirectoryBranch({
  entry,
  taskId,
  selected,
  onSelect,
}: {
  entry: Entry;
  taskId: string;
  selected: string;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(selected.startsWith(`${entry.path}/`));
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        title={entry.path}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          size={12}
          style={{ transform: open ? "rotate(90deg)" : undefined }}
        />
        <Folder size={14} />
        <span>{entry.name}</span>
      </button>
      {open && (
        <Directory
          taskId={taskId}
          path={entry.path}
          selected={selected}
          onSelect={onSelect}
        />
      )}
    </>
  );
}

function FileInspector({
  taskId,
  path,
  historyPath,
  line,
  revision,
  refresh,
  onVersion,
}: {
  taskId: string;
  path: string;
  historyPath: string;
  line?: number | undefined;
  revision?: string | undefined;
  refresh: number;
  onVersion: (path: string, revision?: string) => void;
}) {
  const key = `${path}:${revision ?? "working"}:${refresh}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    content: string | null;
    error: string;
  } | null>(null);
  const content = loaded?.key === key ? loaded.content : null;
  const error = loaded?.key === key ? loaded.error : "";
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Commit[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [next, setNext] = useState<number | null>(0);
  const activeLine = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    request<{ content: string }>(
      taskId,
      { operation: "read", path, ...(revision ? { revision } : {}) },
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setLoaded({ key, content: result.content, error: "" });
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) {
          setLoaded({ key, content: null, error: failure.message });
        }
      });
    return () => controller.abort();
  }, [taskId, path, revision, refresh, key]);
  useEffect(() => {
    activeLine.current?.scrollIntoView({ block: "nearest" });
  }, [content, line]);
  async function loadHistory() {
    if (historyBusy || next === null) return;
    setHistoryBusy(true);
    try {
      const result = await request<{
        entries: Commit[];
        nextOffset: number | null;
      }>(taskId, {
        operation: "history",
        path: historyPath,
        offset: String(next),
      });
      setHistory((current) => [...current, ...result.entries]);
      setNext(result.nextOffset);
      setHistoryError("");
    } catch (failure) {
      setHistoryError(
        failure instanceof Error ? failure.message : "History unavailable",
      );
    } finally {
      setHistoryBusy(false);
    }
  }
  return (
    <div className={styles.inspector}>
      <header className={styles.fileHeader}>
        <strong title={path}>{path}</strong>
        <small>{revision ? revision.slice(0, 8) : "Working tree"}</small>
        {!revision && (
          <Link
            href={`/tasks/${taskId}?${new URLSearchParams({ tab: "artifacts", artifactFile: path })}`}
          >
            <Download size={14} /> Download
          </Link>
        )}
        <button
          type="button"
          aria-expanded={historyOpen}
          onClick={() => {
            setHistoryOpen(!historyOpen);
            if (!historyOpen && !history.length) void loadHistory();
          }}
        >
          <History size={14} />
          History
        </button>
        {revision && (
          <button type="button" onClick={() => onVersion(historyPath)}>
            Current file
          </button>
        )}
      </header>
      {historyOpen && (
        <section className={styles.history} aria-label="File history">
          {history.map((commit) => (
            <button
              type="button"
              key={commit.revision}
              title={commit.revision}
              onClick={() => onVersion(commit.path, commit.revision)}
            >
              <strong>{commit.subject}</strong>
              <small>
                {commit.revision.slice(0, 8)} · {commit.author} ·{" "}
                {new Date(commit.date).toLocaleString()}
              </small>
            </button>
          ))}
          {historyError && <p role="alert">{historyError}</p>}
          {!historyBusy &&
            !historyError &&
            !history.length &&
            next === null && <p>No committed history for this file.</p>}
          {next !== null && (
            <button
              type="button"
              disabled={historyBusy}
              onClick={() => {
                void loadHistory();
              }}
            >
              {historyBusy
                ? "Loading history..."
                : historyError
                  ? "Retry history"
                  : "Load more history"}
            </button>
          )}
        </section>
      )}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : content === null ? (
        <p role="status" className={`${styles.empty} ${styles.loading}`}>
          <LoaderCircle
            size={16}
            className={styles.spinner}
            aria-hidden="true"
          />
          <span>Loading file...</span>
        </p>
      ) : (
        <div className={styles.code} aria-label={`Contents of ${path}`}>
          {content.split("\n").map((text, index) => (
            <div
              key={index}
              ref={index + 1 === line ? activeLine : undefined}
              className={index + 1 === line ? styles.highlight : ""}
            >
              <span aria-hidden="true">{index + 1}</span>
              <code>{text || " "}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
