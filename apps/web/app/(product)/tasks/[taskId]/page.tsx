import { requireIdentity } from "@/lib/auth";
import { getTaskDetail } from "@/lib/task-data";
import {
  AlertTriangle,
  Archive,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Clock3,
  Code2,
  ExternalLink,
  FileCode2,
  Files,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  History,
  ListChecks,
  MessageSquareText,
  MoreHorizontal,
  Play,
  RefreshCw,
  Send,
  ServerCog,
  SquareTerminal,
  User,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

const tabs = [
  { id: "process", label: "Activity", icon: History },
  { id: "plan", label: "Plan", icon: ListChecks },
  { id: "files", label: "Files", icon: Files },
  { id: "changes", label: "Changes", icon: FileCode2 },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "checks", label: "Checks", icon: ClipboardCheck },
  { id: "pull-request", label: "Pull request", icon: GitPullRequest },
  { id: "artifacts", label: "Artifacts", icon: Archive },
  { id: "logs", label: "Runtime", icon: ServerCog },
] as const;

type Tab = (typeof tabs)[number]["id"];
type Detail = NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>;

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const identity = await requireIdentity();
  const { taskId } = await params;
  const data = await getTaskDetail(identity.organizationId, taskId);
  if (!data) notFound();
  const requested = (await searchParams).tab;
  const tab: Tab = tabs.some((item) => item.id === requested)
    ? (requested as Tab)
    : "process";
  const latestEvent = data.events.at(-1);

  return (
    <main className="agent-page">
      <header className="agent-header">
        <div className="agent-breadcrumb">
          <Link href="/tasks">Agent runs</Link>
          <span>/</span>
          <span>{data.task.repository}</span>
          <span>/</span>
          <strong>{data.task.title}</strong>
        </div>
        <div className="agent-header-actions">
          <span className={`state-chip state-${data.task.status}`}>
            <span className="live-dot" />{" "}
            {data.task.status.replaceAll("_", " ")}
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh task"
          >
            <RefreshCw size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="More task actions"
          >
            <MoreHorizontal size={17} />
          </button>
        </div>
      </header>

      <section className="agent-summary-bar">
        <div className="agent-title-block">
          <span className="agent-orb">
            <Bot size={19} />
          </span>
          <div>
            <h1>{data.task.title}</h1>
            <p>{latestEvent?.title ?? "Task accepted"}</p>
          </div>
        </div>
        <div className="agent-facts">
          <span>
            <GitBranch size={14} />
            <small>Repository</small>
            <strong>{data.task.repository}</strong>
          </span>
          <span>
            <GitCommitHorizontal size={14} />
            <small>Branch</small>
            <strong>{data.task.branchName ?? data.task.baseRef}</strong>
          </span>
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

      <div className="agent-workspace">
        <aside className="conversation-pane">
          <div className="pane-heading">
            <div>
              <MessageSquareText size={16} />
              <strong>Conversation</strong>
            </div>
            <span>{data.events.length} events</span>
          </div>
          <div className="conversation-scroll">
            <article className="message user-message">
              <span className="message-avatar user">
                <User size={14} />
              </span>
              <div>
                <header>
                  <strong>You</strong>
                  <time>
                    {new Date(data.task.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </header>
                <p>{data.task.objective}</p>
              </div>
            </article>
            <article className="message agent-message">
              <span className="message-avatar agent">
                <Bot size={15} />
              </span>
              <div>
                <header>
                  <strong>Nimbus</strong>
                  <span className="model-label">Codex</span>
                </header>
                <p>
                  I accepted the outcome and created a durable run. I will
                  inspect the repository, choose the next useful action from
                  evidence, and verify the result before delivery.
                </p>
              </div>
            </article>
            {data.events
              .filter((event) => event.sequence > 1)
              .map((event) => (
                <ConversationEvent event={event} key={event.id} />
              ))}
          </div>
          <div className="followup-box">
            <div>
              <span className="followup-icon">
                <Send size={14} />
              </span>
              <span>Send a follow-up or add context</span>
            </div>
            <button type="button" aria-label="Send follow-up" disabled>
              <Send size={14} />
            </button>
            <small>Follow-ups resume the same Codex thread</small>
          </div>
        </aside>

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
            <TaskPanel tab={tab} data={data} />
          </div>
        </section>
      </div>
    </main>
  );
}

function ConversationEvent({ event }: { event: Detail["events"][number] }) {
  const failed = event.status === "failed";
  return (
    <article className="message agent-message">
      <span className={`message-avatar ${failed ? "warning" : "agent"}`}>
        {failed ? <AlertTriangle size={14} /> : <Bot size={15} />}
      </span>
      <div>
        <header>
          <strong>Nimbus</strong>
          <time>
            {new Date(event.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </header>
        <p>{event.whatWasDone}</p>
        {event.whyItWasDone && (
          <p className="decision-note">
            <span>Decision</span>
            {event.whyItWasDone}
          </p>
        )}
      </div>
    </article>
  );
}

function TaskPanel({ tab, data }: { tab: Tab; data: Detail }) {
  if (tab === "process") return <ActivityPanel data={data} />;
  if (tab === "plan") return <PlanPanel data={data} />;
  if (tab === "files" || tab === "changes")
    return <ChangesPanel data={data} filesOnly={tab === "files"} />;
  if (tab === "terminal") return <TerminalPanel data={data} />;
  if (tab === "checks") return <ChecksPanel data={data} />;
  if (tab === "pull-request") return <PullRequestPanel data={data} />;
  if (tab === "artifacts") return <ArtifactsPanel data={data} />;
  return <RuntimePanel data={data} />;
}

function ActivityPanel({ data }: { data: Detail }) {
  const completed = data.events.filter(
    (event) => event.status === "succeeded",
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
          <strong>{data.task.status.replaceAll("_", " ")}</strong>
        </div>
        <div>
          <small>Confirmed events</small>
          <strong>{data.events.length}</strong>
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
        {data.events.map((event, index) => (
          <article className="activity-item" key={event.id}>
            <div className="activity-rail">
              <span className={`activity-icon ${event.status}`}>
                {event.category === "tool" ? (
                  <Wrench size={13} />
                ) : event.status === "failed" ? (
                  <AlertTriangle size={13} />
                ) : (
                  <Check size={13} />
                )}
              </span>
              {index < data.events.length - 1 && <i />}
            </div>
            <div className="activity-content">
              <header>
                <div>
                  <strong>{event.title}</strong>
                  <span className="activity-phase">{event.phase}</span>
                </div>
                <time>
                  {new Date(event.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
              </header>
              <p>{event.whatWasDone}</p>
              <div className="activity-rationale">
                <CircleDot size={12} />
                <span>{event.whyItWasDone}</span>
              </div>
              {event.verification && (
                <div className="verification-line">
                  <CheckCircle2 size={13} />
                  <span>{event.verification}</span>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function PlanPanel({ data }: { data: Detail }) {
  if (!data.plan)
    return (
      <EmptyPanel
        icon={ListChecks}
        title="No formal plan yet"
        text="Codex creates and revises a plan when the task benefits from one. Small tasks can proceed without ceremony."
      />
    );
  const items = data.plan.items as Array<{
    id: string;
    title: string;
    status: string;
  }>;
  return (
    <div className="workspace-panel">
      <PanelHeader
        eyebrow={`Revision ${data.plan.revision}`}
        title={data.plan.objective}
        detail={data.plan.changeReason}
      />
      <div className="plan-layout">
        <div className="plan-items">
          {items.map((item, index) => (
            <div className="plan-row" key={item.id}>
              <span className={`plan-index ${item.status}`}>
                {item.status === "completed" ? <Check size={13} /> : index + 1}
              </span>
              <div>
                <strong>{item.title}</strong>
                <small>{item.status}</small>
              </div>
            </div>
          ))}
        </div>
        <aside className="plan-context">
          <h3>Confirmed facts</h3>
          <ul>
            {(data.plan.confirmedFacts as string[]).map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
          <h3>Risks</h3>
          <ul>
            {(data.plan.risks as string[]).map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function ChangesPanel({
  data,
  filesOnly,
}: {
  data: Detail;
  filesOnly: boolean;
}) {
  return (
    <div className="workspace-panel">
      <PanelHeader
        eyebrow="Workspace changes"
        title={filesOnly ? "Changed files" : "Review changes"}
        detail="Recorded from the isolated task workspace and tied to durable file-change evidence."
        action={
          <span className="diff-summary">
            <b>+{data.files.reduce((sum, file) => sum + file.additions, 0)}</b>
            <i>-{data.files.reduce((sum, file) => sum + file.deletions, 0)}</i>
          </span>
        }
      />
      {data.files.length === 0 ? (
        <EmptyState text="No file changes have been recorded yet." />
      ) : (
        <div className="file-list">
          {data.files.map((file) => (
            <div className="file-row" key={file.id}>
              <span className={`file-status ${file.status}`}>
                {file.status.slice(0, 1).toUpperCase()}
              </span>
              <Code2 size={15} />
              <strong>{file.path}</strong>
              <span className="diff-count">
                <b>+{file.additions}</b>
                <i>-{file.deletions}</i>
              </span>
              <ChevronDown size={15} />
            </div>
          ))}
        </div>
      )}
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
          data.commands.map((command) => (
            <div className="check-row" key={command.id}>
              <span className={`check-icon ${command.status}`}>
                {command.status === "succeeded" ? (
                  <Check size={14} />
                ) : (
                  <AlertTriangle size={14} />
                )}
              </span>
              <div>
                <strong>{command.command}</strong>
                <small>{command.workingDirectory}</small>
              </div>
              <span className="check-duration">
                {command.durationMs ?? 0}ms
              </span>
              <span
                className={`state-chip state-${command.status === "succeeded" ? "completed" : "failed"}`}
              >
                {command.status}
              </span>
              <span className="exit-code">exit {command.exitCode ?? "-"}</span>
            </div>
          ))
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
        title="Pull request pending"
        text="Nimbus creates or updates a pull request automatically after the implementation reaches a coherent verified result."
      />
    );
  return (
    <div className="workspace-panel">
      <PanelHeader
        eyebrow={`${data.task.repository} #${pr.number}`}
        title={pr.title}
        detail="Delivery state comes from the trusted GitHub integration boundary."
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
        <div className="pr-state-line">
          <GitPullRequest size={24} />
          <div>
            <strong>Pull request {pr.state}</strong>
            <p>
              {data.task.branchName} into {data.task.baseRef}
            </p>
          </div>
        </div>
        <div className="pr-metrics">
          <span>
            <small>Checks</small>
            <strong>
              {data.commands.every((command) => command.status === "succeeded")
                ? "Passing"
                : "Pending"}
            </strong>
          </span>
          <span>
            <small>Review</small>
            <strong>{pr.reviewState?.replaceAll("_", " ")}</strong>
          </span>
          <span>
            <small>Mergeability</small>
            <strong>{pr.mergeable ? "Ready" : "Unknown"}</strong>
          </span>
        </div>
        <div className="pr-actions">
          <button type="button" disabled>
            Merge pull request
          </button>
          <button type="button" className="secondary" disabled>
            Close
          </button>
          <p>Merge and close always require an explicit user action.</p>
        </div>
      </div>
    </div>
  );
}

function ArtifactsPanel({ data }: { data: Detail }) {
  return (
    <div className="workspace-panel">
      <PanelHeader
        eyebrow="Preserved outputs"
        title="Artifacts"
        detail="Generated outputs are immutable, checksummed, and scoped to this task."
      />
      {data.artifacts.length === 0 ? (
        <EmptyState text="No artifacts have been generated." />
      ) : (
        <div className="artifact-grid">
          {data.artifacts.map((artifact) => (
            <div className="artifact-card" key={artifact.id}>
              <Archive size={18} />
              <div>
                <strong>{artifact.name}</strong>
                <small>
                  {artifact.mimeType} | {artifact.sizeBytes} bytes
                </small>
                <code>{artifact.checksum.slice(0, 20)}...</code>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RuntimePanel({ data }: { data: Detail }) {
  const rows = [
    ["Workspace provider", data.workspace?.provider ?? "pending"],
    ["Workspace status", data.workspace?.status ?? "pending"],
    ["Codex model", data.thread?.model ?? "pending"],
    [
      "Event sequence",
      String(
        data.thread?.lastProcessedEventSequence ??
          data.events.at(-1)?.sequence ??
          0,
      ),
    ],
    ["Completion", data.thread?.lastConfirmedCompletionStatus ?? "unconfirmed"],
  ];
  return (
    <div className="workspace-panel">
      <PanelHeader
        eyebrow="Redacted diagnostics"
        title="Runtime"
        detail="Operational metadata is visible without exposing credentials, prompts, source, or private reasoning."
      />
      <div className="runtime-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <code>{value}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelHeader({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="workspace-panel-header">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {action}
    </header>
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
