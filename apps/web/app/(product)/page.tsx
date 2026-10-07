import { currentIdentity, requireIdentity } from "@/lib/auth";
import { LandingPage } from "./landing-page";
import { RepositorySync } from "./repository-sync";
import { getSelectableCodexModels } from "@/lib/codex-models";
import { listTasks } from "@/lib/task-data";
import { SessionStatusChip, SessionStatusProvider } from "./session-status";
import { listAvailableRepositories } from "@/lib/available-repositories";
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
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ModelPicker } from "./model-picker";
import { RepositoryPicker } from "./repository-picker";
import { TaskLaunchButton, TaskLaunchForm } from "./task-launch-form";
import { SkillPrompt } from "./skill-prompt";
import { RunStateIcon } from "./run-state-icon";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cloud coding workspace",
  description:
    "Launch verified coding tasks in Nimbus, powered by your connected Codex account.",
};

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
  const publicIdentity = await currentIdentity();
  if (!publicIdentity) return <LandingPage />;
  const identity = publicIdentity ?? (await requireIdentity());
  if (identity.authProvider === "google" && !identity.onboardingCompletedAt)
    redirect("/onboarding");
  const [allTasks, repos, models] = await Promise.all([
    listTasks(identity.organizationId),
    listAvailableRepositories(identity.organizationId),
    getSelectableCodexModels(identity.userId, identity.organizationId),
  ]);
  const active = allTasks.filter((task) => activeStates.has(task.status));
  const delivered = allTasks.filter(
    (task) => task.status === "pr_open" || task.status === "completed",
  );
  const visibleRepositories = repos;

  return (
    <SessionStatusProvider tasks={allTasks}>
      <main className="dashboard-page">
        <header className="dashboard-heading">
          <div>
            <p className="overline">Dashboard</p>
            <h1>What can Nimbus help you with?</h1>
            <p>
              Chat with Nimbus, or select a repository to build, investigate,
              and verify changes in an isolated workspace.
            </p>
          </div>
        </header>

        <RepositorySync />
        <section className="launch-card" aria-label="Task composer">
          <div className="launch-accent">
            <Code2 size={19} />
          </div>
          <TaskLaunchForm initialModelAvailable={models.length > 0}>
            <SkillPrompt
              submitOnEnter
              id="task-objective"
              aria-label="Task request"
              name="objective"
              required
              minLength={1}
              maxLength={8000}
              rows={1}
              autoGrow
              placeholder="What should Nimbus build, fix, or investigate? Add any constraints or definition of done."
            />
            <div className="launch-footer">
              <RepositoryPicker repositories={visibleRepositories} />
              <ModelPicker initialModels={models} />
              <input
                type="hidden"
                name="idempotencyKey"
                value={`dashboard-${crypto.randomUUID()}`}
              />
              <TaskLaunchButton />
            </div>
          </TaskLaunchForm>
        </section>

        <section className="run-section">
          <div className="section-heading">
            <div>
              <h2>Recent History</h2>
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
                <CircleDot size={15} /> Codex chooses its next useful action
                from current evidence.
              </span>
              <span>
                <MessageSquareText size={15} /> Decisions, tools, and
                verification remain visible as durable events.
              </span>
              <span>
                <CheckCircle2 size={15} /> Completion requires a confirmed
                terminal result, not a generated message.
              </span>
            </div>
          </div>
        </section>
      </main>
    </SessionStatusProvider>
  );
}

function TaskRow({
  task,
}: {
  task: Awaited<ReturnType<typeof listTasks>>[number];
}) {
  return (
    <Link className="run-row" href={`/tasks/${task.id}`}>
      <span className="run-title">
        <RunStateIcon
          status={task.status}
          archivedAt={task.archivedAt}
          workspaceStatus={task.workspaceStatus}
        />
        <span>
          <strong>{task.title}</strong>
          <small>{task.objective}</small>
        </span>
      </span>
      <span className="run-repo">
        <GitBranch size={13} /> {task.repository ?? "General chat"}
      </span>
      <span>
        <SessionStatusChip task={task} />
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
