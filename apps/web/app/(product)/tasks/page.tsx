import { requireIdentity } from "@/lib/auth";
import { formatIstDate } from "@/lib/display-time";
import { listTasks } from "@/lib/task-data";
import Link from "next/link";
import { sessionPresentation } from "@/lib/session-presentation";
import { EditTaskTitle } from "./edit-task-title";
import styles from "./edit-task-title.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Task history",
  description:
    "Review durable Nimbus task sessions, statuses, repositories, and outcomes.",
};

export default async function TasksPage() {
  const identity = await requireIdentity();
  const rows = await listTasks(identity.organizationId);
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">History</p>
          <h1>Every run, one durable record.</h1>
          <p className="lede">
            Concurrent tasks have separate workspaces, branches, Codex threads,
            and event histories.
          </p>
        </div>
        <Link className="button" href="/">
          Open Dashboard
        </Link>
      </div>
      <section className="card">
        <div className={styles.tableScroll}>
          <table className={styles.historyTable} aria-label="Session history">
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">Repository</th>
                <th scope="col">Status</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((task) => (
                <tr key={task.id} data-task-id={task.id}>
                  <td>
                    <EditTaskTitle
                      key={task.title}
                      taskId={task.id}
                      title={task.title}
                      href={`/tasks/${task.id}`}
                    />
                    <Link
                      className={styles.objective}
                      href={`/tasks/${task.id}`}
                      title={task.objective}
                    >
                      {task.objective}
                    </Link>
                  </td>
                  <td>
                    <span className="path muted">
                      {task.repository ?? "General chat"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`state-chip state-${sessionPresentation(task.status, task.archivedAt).state}`}
                    >
                      {sessionPresentation(task.status, task.archivedAt).label}
                    </span>
                  </td>
                  <td>
                    <time className="muted">
                      {formatIstDate(task.updatedAt)}
                    </time>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4}>No sessions yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
