import { requireIdentity } from "@/lib/auth";
import { getSelectableCodexModels } from "@/lib/codex-models";
import { listTasks } from "@/lib/task-data";
import { db, eq, repositories } from "@nimbus/database";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  GitBranch,
  GitPullRequest,
  LoaderCircle,
  MessageSquareText,
  Play,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import Link from "next/link";

const activeStates = new Set([
  "queued",
  "provisioning",
  "running",
  "awaiting_user",
  "preparing_pr",
  "pushing",
  "creating_pr",
]);

export default async function DashboardPage() {
  const identity = await requireIdentity();
  const [allTasks, repos, models] = await Promise.all([
    listTasks(identity.organizationId),
    db()
      .select()
      .from(repositories)
      .where(eq(repositories.organizationId, identity.organizationId)),
    getSelectableCodexModels(identity.userId),
  ]);
  const active = allTasks.filter((task) => activeStates.has(task.status));
  const delivered = allTasks.filter(
    (task) => task.status === "pr_open" || task.status === "completed",
  );
  const isLiveCodex = process.env.NIMBUS_CODING_PROVIDER === "codex";

  return (
    <main className="dashboard-page">
      <header className="dashboard-heading">
        <div>
          <p className="overline">Mission control</p>
          <h1>What should Nimbus ship next?</h1>
          <p>
            Delegate an outcome. Codex investigates, implements, verifies, and
            prepares the pull request in an isolated workspace.
          </p>
        </div>
        <div className="capacity-indicator">
          <span className="capacity-ring">
            {Math.max(0, 4 - active.length)}
          </span>
          <span>
            <strong>agents available</strong>
            <small>{active.length} running now</small>
          </span>
        </div>
      </header>

      <section className="launch-card" aria-labelledby="launch-title">
        <div className="launch-accent">
          <Code2 size={19} />
        </div>
        <form action="/api/tasks" method="post">
          <div className="launch-title-row">
            <label id="launch-title" htmlFor="task-objective">
              Start an agent run
            </label>
            <span>{isLiveCodex ? "Autonomous mode" : "Local simulation"}</span>
          </div>
          <textarea
            id="task-objective"
            name="objective"
            required
            minLength={10}
            maxLength={8000}
            rows={3}
            placeholder="Describe the outcome, constraints, and what success looks like. Nimbus will decide how to investigate and implement it."
          />
          <p className="launch-title-hint">
            Nimbus will name the session from your request.
          </p>
          <div className="launch-footer">
            <label className="repo-picker">
              <GitBranch size={15} />
              <select name="repositoryId" required aria-label="Repository">
                {repos.map((repo) => (
                  <option value={repo.id} key={repo.id}>
                    {repo.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="repo-picker">
              <CircleDot size={15} />
              <select name="model" required aria-label="Codex model">
                {models.length ? (
                  models.map((model) => (
                    <option value={model.id} key={model.id}>
                      {model.label}
                    </option>
                  ))
                ) : (
                  <option value="">Connect ChatGPT to load models</option>
                )}
              </select>
            </label>
            <div className="launch-capabilities">
              <span>
                <TerminalSquare size={14} /> Tools enabled
              </span>
              <span>
                <ShieldCheck size={14} /> Isolated workspace
              </span>
            </div>
            <input
              type="hidden"
              name="idempotencyKey"
              value={`dashboard-${crypto.randomUUID()}`}
            />
            <button
              type="submit"
              className="launch-button"
              disabled={!models.length}
            >
              <Play size={14} fill="currentColor" /> Run agent
            </button>
          </div>
        </form>
      </section>

      <section className="run-section">
        <div className="section-heading">
          <div>
            <h2>Agent runs</h2>
            <p>Live and recent work across your repositories</p>
          </div>
          <Link href="/tasks">
            View all <ArrowRight size={14} />
          </Link>
        </div>
        <div className="run-table">
          <div className="run-table-head">
            <span>Task</span>
            <span>Repository</span>
            <span>State</span>
            <span>Updated</span>
            <span />
          </div>
          {allTasks.length === 0 ? (
            <div className="run-empty">
              No agent runs yet. Start with an outcome above.
            </div>
          ) : (
            allTasks
              .slice(0, 8)
              .map((task) => <TaskRow task={task} key={task.id} />)
          )}
        </div>
      </section>

      <section className="dashboard-lower-grid">
        <div className="ops-card">
          <div className="section-heading compact">
            <div>
              <h2>Execution health</h2>
              <p>Confirmed control-plane state</p>
            </div>
            <span className="healthy-label">
              <span className="live-dot" /> Healthy
            </span>
          </div>
          <div className="health-grid">
            <HealthItem
              icon={LoaderCircle}
              label="Running"
              value={String(active.length)}
              detail="task workspaces"
            />
            <HealthItem
              icon={GitPullRequest}
              label="Delivered"
              value={String(delivered.length)}
              detail="verified outcomes"
            />
            <HealthItem
              icon={Clock3}
              label="Queue"
              value={String(
                allTasks.filter((task) => task.status === "queued").length,
              )}
              detail="waiting to start"
            />
          </div>
        </div>
        <div className="ops-card">
          <div className="section-heading compact">
            <div>
              <h2>How Nimbus works</h2>
              <p>Adaptive, not a fixed pipeline</p>
            </div>
          </div>
          <div className="agent-principles">
            <span>
              <CircleDot size={15} /> Codex chooses its next useful action from
              current evidence.
            </span>
            <span>
              <MessageSquareText size={15} /> Decisions, tools, and verification
              remain visible as durable events.
            </span>
            <span>
              <CheckCircle2 size={15} /> Completion requires a confirmed
              terminal result, not a generated message.
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}

function TaskRow({
  task,
}: {
  task: Awaited<ReturnType<typeof listTasks>>[number];
}) {
  const isActive = activeStates.has(task.status);
  return (
    <Link className="run-row" href={`/tasks/${task.id}`}>
      <span className="run-title">
        <span className={`run-icon ${isActive ? "active" : ""}`}>
          {isActive ? <LoaderCircle size={15} /> : <CheckCircle2 size={15} />}
        </span>
        <span>
          <strong>{task.title}</strong>
          <small>{task.objective}</small>
        </span>
      </span>
      <span className="run-repo">
        <GitBranch size={13} /> {task.repository}
      </span>
      <span>
        <span className={`state-chip state-${task.status}`}>
          {task.status.replaceAll("_", " ")}
        </span>
      </span>
      <time>{relativeTime(task.updatedAt)}</time>
      <ChevronRight size={16} />
    </Link>
  );
}

function HealthItem({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof LoaderCircle;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="health-item">
      <Icon size={17} />
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </span>
    </div>
  );
}

function relativeTime(value: string) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
