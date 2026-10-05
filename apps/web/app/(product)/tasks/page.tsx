import { requireIdentity } from "@/lib/auth";
import { listTasks } from "@/lib/task-data";
import Link from "next/link";

export default async function TasksPage() {
  const identity = await requireIdentity();
  const rows = await listTasks(identity.organizationId);
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Tasks</p>
          <h1>Every run, one durable record.</h1>
          <p className="lede">
            Concurrent tasks have separate workspaces, branches, Codex threads,
            and event histories.
          </p>
        </div>
        <Link className="button" href="/tasks/new">
          New task
        </Link>
      </div>
      <section className="card">
        <div className="task-list">
          {rows.map((task) => (
            <Link className="task-row" href={`/tasks/${task.id}`} key={task.id}>
              <div>
                <div className="task-title">{task.title}</div>
                <div className="task-sub">{task.objective}</div>
              </div>
              <span className="path muted">{task.repository}</span>
              <span className={`status ${task.status}`}>
                {task.status.replaceAll("_", " ")}
              </span>
              <time className="muted">
                {new Date(task.updatedAt).toLocaleDateString()}
              </time>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
