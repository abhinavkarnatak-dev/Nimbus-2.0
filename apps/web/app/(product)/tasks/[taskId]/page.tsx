import { requireIdentity } from "@/lib/auth";
import { getTaskDetail } from "@/lib/task-data";
import { activityEvents } from "@/lib/conversation-events";
import { ChangesWorkbench } from "./changes-workbench";
import prPanelStyles from "./pull-request-panel.module.css";
import { LiveAgentWorkspace } from "./live-agent-workspace";
import styles from "./conversation.module.css";
import { FilesWorkbench } from "./files-workbench";
import { ArtifactsWorkbench } from "./artifacts-workbench";
import { fileReferenceTarget } from "@/lib/chat-links";
import { isArtifactReference } from "@/lib/artifact-policy";
import { checkPresentation } from "@/lib/check-presentation";
import { sessionPresentation } from "@/lib/session-presentation";
import {
  AlertTriangle,
  Archive,
  Bot,
  Check,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  FileCode2,
  Files,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  History,
  Play,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { PullRequestActions } from "./pull-request-actions";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Task workspace",
  description:
    "Inspect a Nimbus task conversation, activity trail, changes, files, artifacts, and pull request status.",
};
import prStyles from "./pull-request-actions.module.css";
import { notFound, redirect } from "next/navigation";
import { EditTaskTitle } from "../edit-task-title";
import { PanelHeader } from "./workbench-panel-header";

const tabs = [
  { id: "process", label: "Activity", icon: History },
  { id: "files", label: "Files", icon: Files },
  { id: "changes", label: "Changes", icon: FileCode2 },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "checks", label: "Checks", icon: ClipboardCheck },
  { id: "pull-request", label: "Pull request", icon: GitPullRequest },
  { id: "artifacts", label: "Artifacts", icon: Archive },
] as const;

type Tab = (typeof tabs)[number]["id"];
type Detail = NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>;

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{
    tab?: string;
    file?: string;
    line?: string;
    revision?: string;
    historyFile?: string;
    artifactFile?: string;
  }>;
}) {
  const identity = await requireIdentity();
  const { taskId } = await params;
  const data = await getTaskDetail(identity.organizationId, taskId);
  if (!data) notFound();
  const query = await searchParams;
  const requested = query.tab;
  if (requested === "files" && query.file && isArtifactReference(query.file))
    redirect(`/tasks/${taskId}?${fileReferenceTarget(query.file)}`);
  const tab: Tab = tabs.some((item) => item.id === requested)
    ? (requested as Tab)
    : "process";
  const latestEvent = data.events.at(-1);
  const session = sessionPresentation(data.task.status, data.task.archivedAt);

  return (
    <main className="agent-page">
      <header className="agent-header">
        <div className="agent-breadcrumb">
          <Link href="/tasks">History</Link>
          <span>/</span>
          <span>{data.task.repository ?? "General chat"}</span>
          <span>/</span>
          <strong>{data.task.title}</strong>
        </div>
        <div className="agent-header-actions">
          <span className={`state-chip state-${session.state}`}>
            <span className="live-dot" /> {session.label}
          </span>
        </div>
      </header>

      <section className="agent-summary-bar">
        <div className="agent-title-block">
          <span className="agent-orb">
            <Bot size={19} />
          </span>
          <div>
            <EditTaskTitle
              key={data.task.title}
              taskId={taskId}
              title={data.task.title}
              heading
            />
            <p>
              {session.state === "idle"
                ? "Ready for your next request"
                : (latestEvent?.title ?? "Task accepted")}
            </p>
          </div>
        </div>
        <div className="agent-facts">
          {data.task.repository && (
            <span>
              <GitBranch size={14} />
              <small>Repository</small>
              <strong>{data.task.repository}</strong>
            </span>
          )}
          {data.task.repository && (
            <span>
              <GitCommitHorizontal size={14} />
              <small>Branch</small>
              <strong>{data.task.branchName ?? data.task.baseRef}</strong>
            </span>
          )}
          <span>
            <Clock3 size={14} />
            <small>Last activity</small>
            <strong>
              {new Date(data.task.updatedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </strong>
          </span>
        </div>
      </section>

      <LiveAgentWorkspace
        taskId={taskId}
        createdAt={data.task.createdAt}
        finishedAt={data.task.completedAt}
        objective={data.task.objective}
        model={data.task.requestedModel ?? data.thread?.model ?? "Codex"}
        initialStatus={data.task.status}
        initialRequestId={data.activeRequestId}
        initialSkillIds={data.task.selectedSkillIds}
        archivedAt={data.task.archivedAt}
        initialEvents={data.events}
        workbench={
          data.task.repository ? (
            <section className="workbench-pane">
              <nav className="workbench-tabs" aria-label="Task workspace">
                {tabs.map(({ id, label, icon: Icon }) => (
                  <Link
                    className={tab === id ? "active" : ""}
                    href={`/tasks/${taskId}?tab=${id}`}
                    key={id}
                  >
                    <Icon size={14} />
                    {label}
                  </Link>
                ))}
              </nav>
              <div className="workbench-body">
                {tab === "files" ? (
                  <FilesWorkbench
                    taskId={taskId}
                    path={query.file}
                    line={
                      query.line && /^\d+$/.test(query.line)
                        ? Number(query.line)
                        : undefined
                    }
                    revision={query.revision}
                    historyPath={query.historyFile}
                  />
                ) : (
                  <TaskPanel
                    tab={tab}
                    data={data}
                    artifactFile={query.artifactFile}
                  />
                )}
              </div>
            </section>
          ) : null
        }
      />
    </main>
  );
}

function TaskPanel({
  tab,
  data,
  artifactFile,
}: {
  tab: Tab;
  data: Detail;
  artifactFile?: string | undefined;
}) {
  if (tab === "process") return <ActivityPanel data={data} />;
  if (tab === "changes")
    return (
      <ChangesWorkbench
        taskId={data.task.id}
        refreshKey={data.events.at(-1)?.sequence ?? 0}
      />
    );
  if (tab === "terminal") return <TerminalPanel data={data} />;
  if (tab === "checks") return <ChecksPanel data={data} />;
  if (tab === "pull-request") return <PullRequestPanel data={data} />;
  if (tab === "artifacts")
    return (
      <ArtifactsWorkbench
        key={`${artifactFile ?? ""}:${data.artifacts.map((artifact) => artifact.id).join(",")}`}
        taskId={data.task.id}
        requestedPath={artifactFile}
        initialArtifacts={data.artifacts}
      />
    );
  return <ActivityPanel data={data} />;
}

function ActivityPanel({ data }: { data: Detail }) {
  const events = activityEvents(data.events);
  const completed = events.filter(
    (event) =>
      event.status === "succeeded" && event.category !== "agent_message",
  ).length;
  return (
    <div className="workspace-panel">
      <PanelHeader
        eyebrow="Live execution"
        title="Agent activity"
        detail="Every entry is persisted and replayable. Nimbus does not invent progress between confirmed events."
        action={
          <span className="stream-indicator">
            <span className="live-dot" /> Event stream
          </span>
        }
      />
      <div className="activity-overview">
        <div>
          <small>Current state</small>
          <strong>
            {sessionPresentation(data.task.status, data.task.archivedAt).label}
          </strong>
        </div>
        <div>
          <small>Confirmed events</small>
          <strong>{events.length}</strong>
        </div>
        <div>
          <small>Successful actions</small>
          <strong>{completed}</strong>
        </div>
        <div>
          <small>Workspace</small>
          <strong>{data.workspace?.status ?? "pending"}</strong>
        </div>
      </div>
      <div className="activity-feed">
        {events.map((event, index) => (
          <article className="activity-item" key={event.id}>
            <div className="activity-rail">
              <span className={`activity-icon ${event.status}`}>
                {event.category === "tool" ? (
                  <Wrench size={13} />
                ) : event.status === "failed" ? (
                  <AlertTriangle size={13} />
                ) : event.status === "succeeded" &&
                  event.category !== "agent_message" ? (
                  <Check size={13} />
                ) : event.category === "agent_message" ? (
                  <Bot size={13} />
                ) : (
                  <CircleDot size={13} />
                )}
              </span>
              {index < events.length - 1 && <i />}
            </div>
            <div className="activity-content">
              <details className={styles.activityDetails}>
                <summary>
                  <header>
                    <div>
                      <strong>{event.title}</strong>
                      {event.category !== "agent_message" && (
                        <span className="activity-phase">
                          {event.status === "succeeded"
                            ? "Finished"
                            : event.status}
                        </span>
                      )}
                    </div>
                    <time>
                      {new Date(event.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </time>
                  </header>
                </summary>
                {event.category === "tool" ? (
                  <pre>{event.whatWasDone}</pre>
                ) : (
                  <p>{event.whatWasDone}</p>
                )}
                {event.whyItWasDone && (
                  <div className="activity-rationale">
                    <CircleDot size={12} />
                    <span>{event.whyItWasDone}</span>
                  </div>
                )}
                {event.verification && (
                  <div className="verification-line">
                    <CheckCircle2 size={13} />
                    <span>{event.verification}</span>
                  </div>
                )}
              </details>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function TerminalPanel({ data }: { data: Detail }) {
  return (
    <div className="workspace-panel terminal-panel">
      <PanelHeader
        eyebrow="Sandbox shell"
        title="Terminal"
        detail="Command output is attached to bounded process records with confirmed exit status."
      />
      {data.commands.length === 0 ? (
        <EmptyState text="No commands have run yet." />
      ) : (
        <div className="terminal-window">
          <div className="terminal-titlebar">
            <span />
            <span />
            <span />
            <strong>nimbus-task-shell</strong>
          </div>
          {data.commands.map((command) => (
            <div className="command-block" key={command.id}>
              <div>
                <span className="terminal-prompt">nimbus</span>
                <span className="terminal-path">
                  :{command.workingDirectory}$
                </span>{" "}
                {command.command}
              </div>
              <p>
                Process {command.status}. Exit code{" "}
                {command.exitCode ?? "pending"}. Duration{" "}
                {command.durationMs ?? 0}ms.
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChecksPanel({ data }: { data: Detail }) {
  return (
    <div className="workspace-panel">
      <PanelHeader
        eyebrow="Verification evidence"
        title="Checks"
        detail="A check is successful only after its process exits successfully and the result is persisted."
      />
      <div className="check-list">
        {data.commands.length === 0 ? (
          <EmptyState text="No checks have been recorded yet." />
        ) : (
          data.commands.map((command) => {
            const presentation = checkPresentation(
              command.status,
              command.exitCode,
            );
            return (
              <div className="check-row" key={command.id}>
                <span className={`check-icon ${presentation.state}`}>
                  {presentation.passed ? (
                    <Check size={14} />
                  ) : presentation.failed ? (
                    <AlertTriangle size={14} />
                  ) : (
                    <Clock3 size={14} />
                  )}
                </span>
                <div>
                  <strong>{command.command}</strong>
                  <small>{command.workingDirectory}</small>
                </div>
                <span className="check-duration">
                  {command.durationMs ?? 0}ms
                </span>
                <span className={`state-chip state-${presentation.state}`}>
                  {presentation.label}
                </span>
                <span className="exit-code">
                  exit {command.exitCode ?? "-"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function PullRequestPanel({ data }: { data: Detail }) {
  const pr = data.pullRequest;
  if (!pr)
    return (
      <EmptyPanel
        icon={GitPullRequest}
        title="No pull requests created"
        text="Pull requests created for this session will appear here."
      />
    );
  return (
    <div className={prPanelStyles.list}>
      <section
        className="workspace-panel"
        aria-label={`Latest pull request #${pr.number}`}
      >
        <PanelHeader
          eyebrow={`${data.task.repository} #${pr.number}`}
          title={pr.title}
          detail="Latest pull request in this session"
          action={
            <a
              className="outline-button"
              href={pr.url ?? "#"}
              target="_blank"
              rel="noreferrer"
            >
              Open on GitHub <ExternalLink size={13} />
            </a>
          }
        />
        <div className="pr-overview">
          <div
            className={`pr-state-line ${pr.state === "merged" ? prStyles.statusMerged : pr.state === "closed" ? prStyles.statusClosed : prStyles.statusOpen}`}
          >
            <GitPullRequest size={24} />
            <div>
              <strong>Pull request {pr.state}</strong>
              <p>
                {pr.branchName} into {data.task.baseRef}
              </p>
            </div>
          </div>
          {pr.state === "open" && (
            <div className="pr-metrics">
              <span>
                <small>Checks</small>
                <strong>
                  {data.commands.length > 0 &&
                  data.commands.every(
                    (command) =>
                      checkPresentation(command.status, command.exitCode)
                        .passed,
                  )
                    ? "Passing"
                    : "Pending"}
                </strong>
              </span>
              <span>
                <small>Review</small>
                <strong>
                  {pr.reviewState?.replaceAll("_", " ") ?? "Not reviewed"}
                </strong>
              </span>
              <span>
                <small>Mergeability</small>
                <strong>{pr.mergeable ? "Ready" : "Unknown"}</strong>
              </span>
            </div>
          )}
          {pr.state === "open" && (
            <PullRequestActions
              key={`${pr.id}:${pr.headSha}`}
              taskId={data.task.id}
              number={pr.number}
              state={pr.state}
              headSha={pr.headSha}
            />
          )}
        </div>
      </section>
      {data.pullRequestHistory.length > 1 && (
        <section
          className={prPanelStyles.history}
          aria-label="Session pull request history"
        >
          <header className={prPanelStyles.historyHeading}>
            <h3>Previous pull requests</h3>
            <span>{data.pullRequestHistory.length - 1}</span>
          </header>
          {data.pullRequestHistory.slice(1).map((previous) => (
            <article
              className={prPanelStyles.card}
              key={previous.id}
              aria-label={`Previous pull request #${previous.number}`}
            >
              <div className={prPanelStyles.cardHeading}>
                <span className={prPanelStyles.number}>#{previous.number}</span>
                <span
                  className={`${prPanelStyles.badge} ${previous.state === "merged" ? prPanelStyles.merged : previous.state === "closed" ? prPanelStyles.closed : prPanelStyles.open}`}
                >
                  <GitPullRequest size={13} />
                  {previous.state}
                </span>
              </div>
              <h4>
                <a href={previous.url ?? "#"} target="_blank" rel="noreferrer">
                  {previous.title}
                </a>
              </h4>
              <div className={prPanelStyles.cardFooter}>
                <p title={`${previous.branchName} into ${data.task.baseRef}`}>
                  <GitBranch size={13} />
                  <span>
                    {previous.branchName} → {data.task.baseRef}
                  </span>
                </p>
                <a
                  className={prPanelStyles.github}
                  href={previous.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open PR #${previous.number} on GitHub`}
                >
                  GitHub <ExternalLink size={13} />
                </a>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function EmptyPanel({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Play;
  title: string;
  text: string;
}) {
  return (
    <div className="workspace-panel">
      <div className="large-empty">
        <span>
          <Icon size={22} />
        </span>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="inline-empty">
      <CircleDot size={16} />
      <span>{text}</span>
    </div>
  );
}
