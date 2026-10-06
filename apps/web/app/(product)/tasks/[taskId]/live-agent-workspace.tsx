"use client";

import {
  AlertTriangle,
  ArrowDown,
  Bot,
  Clock3,
  MessageSquareText,
  PanelRightClose,
  PanelRightOpen,
  Send,
  Square,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  conversationEntries,
  conversationEvents,
  isProtocolEvent,
} from "@/lib/conversation-events";
import { MarkdownMessage } from "./markdown-message";
import styles from "./conversation.module.css";
import { useRouter } from "next/navigation";
import { fileReferenceTarget } from "@/lib/chat-links";
import { prCardData } from "@/lib/pr-card";
import { PullRequestChatCard } from "./pull-request-chat-card";
import { formatWorkDuration, workEventTiming } from "@/lib/work-duration";
import { SkillPrompt } from "../../skill-prompt";

interface LiveTaskEvent {
  id: string;
  sequence: number;
  timestamp: string;
  category: string;
  phase: string;
  status: string;
  title: string;
  whatWasDone: string;
  whyItWasDone: string;
  evidence?: unknown;
}

interface LiveAgentWorkspaceProps {
  taskId: string;
  createdAt: string;
  finishedAt: string | null;
  objective: string;
  model: string;
  initialStatus: string;
  initialRequestId?: string | null;
  initialSkillIds?: string[];
  archivedAt?: string | null;
  initialEvents: LiveTaskEvent[];
  workbench: ReactNode;
}

const terminalStates = new Set(["completed", "failed", "cancelled", "pr_open"]);

export function LiveAgentWorkspace({
  taskId,
  createdAt,
  finishedAt,
  objective,
  initialStatus,
  initialRequestId,
  initialSkillIds,
  archivedAt,
  initialEvents,
  workbench,
}: LiveAgentWorkspaceProps) {
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [status, setStatus] = useState(initialStatus);
  const [workbenchOpen, setWorkbenchOpen] = useState(Boolean(workbench));
  const [followup, setFollowup] = useState("");
  const [skillIds, setSkillIds] = useState(initialSkillIds ?? []);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [requestId, setRequestId] = useState(initialRequestId ?? null);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState("");
  const submission = useRef<{
    content: string;
    skills: string;
    key: string;
  } | null>(null);
  const [now, setNow] = useState(() =>
    new Date(
      finishedAt ?? initialEvents.at(-1)?.timestamp ?? createdAt,
    ).getTime(),
  );
  const latestSequence = useRef(initialEvents.at(-1)?.sequence ?? 0);
  const chatScroll = useRef<HTMLDivElement>(null);
  const [promptMenuOpen, setPromptMenuOpen] = useState(false);
  const [activePromptId, setActivePromptId] = useState(
    `prompt-initial-${taskId}`,
  );
  const promptMenu = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  useLayoutEffect(() => {
    if (followBottom.current && chatScroll.current)
      chatScroll.current.scrollTop = chatScroll.current.scrollHeight;
  }, [events]);
  useEffect(() => {
    if (!promptMenuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!promptMenu.current?.contains(event.target as Node))
        setPromptMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPromptMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [promptMenuOpen]);

  useEffect(() => {
    if (terminalStates.has(status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    const stream = new EventSource(
      `/api/tasks/${taskId}/events?after=${String(latestSequence.current)}`,
    );
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshWorkbench = () => {
      refreshTimer ??= setTimeout(() => {
        refreshTimer = undefined;
        router.refresh();
      }, 1500);
    };
    stream.addEventListener("task_state", (message) => {
      const value = JSON.parse((message as MessageEvent<string>).data) as {
        status?: string;
        messageId?: string | null;
      };
      if (value.status) {
        setStatus(value.status);
        if ("messageId" in value) setRequestId(value.messageId ?? null);
        if (value.status !== "cancelling") setStopping(false);
        refreshWorkbench();
      }
    });
    stream.addEventListener("task_event", (message) => {
      const event = JSON.parse(
        (message as MessageEvent<string>).data,
      ) as LiveTaskEvent;
      latestSequence.current = Math.max(latestSequence.current, event.sequence);
      if (!isProtocolEvent(event) && event.category !== "agent_message")
        refreshWorkbench();
      setEvents((current) => {
        if (current.some((item) => item.id === event.id)) return current;
        return [...current, event].sort((a, b) => a.sequence - b.sequence);
      });
    });
    return () => {
      stream.close();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [taskId, router]);

  const meaningfulEvents = useMemo(() => conversationEvents(events), [events]);
  const initialPromptId = `prompt-initial-${taskId}`;
  const prompts = useMemo(
    () => [
      { id: initialPromptId, text: objective },
      ...meaningfulEvents
        .filter((event) => event.category === "conversation")
        .map((event) => ({
          id: `prompt-${event.id}`,
          text: event.whatWasDone,
        })),
    ],
    [initialPromptId, objective, meaningfulEvents],
  );
  useEffect(() => {
    const scroll = chatScroll.current;
    if (!scroll) return;
    const updateActivePrompt = () => {
      const top = scroll.getBoundingClientRect().top + 40;
      let current = prompts[0]?.id ?? initialPromptId;
      for (const prompt of prompts) {
        const element = document.getElementById(prompt.id);
        if (element && element.getBoundingClientRect().top <= top)
          current = prompt.id;
      }
      setActivePromptId(current);
    };
    const frame = requestAnimationFrame(updateActivePrompt);
    scroll.addEventListener("scroll", updateActivePrompt, { passive: true });
    const observer = new ResizeObserver(updateActivePrompt);
    observer.observe(scroll);
    return () => {
      cancelAnimationFrame(frame);
      scroll.removeEventListener("scroll", updateActivePrompt);
      observer.disconnect();
    };
  }, [prompts, initialPromptId]);
  const entries = conversationEntries(
    meaningfulEvents.filter((event) => event.sequence > 1),
  );
  const jumpToPrompt = (id: string) => {
    const target = document.getElementById(id),
      scroll = chatScroll.current;
    if (target && scroll) {
      followBottom.current = false;
      setShowLatest(true);
      scroll.scrollTo({
        top:
          scroll.scrollTop +
          target.getBoundingClientRect().top -
          scroll.getBoundingClientRect().top -
          12,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      target.focus({ preventScroll: true });
    }
    setPromptMenuOpen(false);
  };
  const jumpToLatest = () => {
    const scroll = chatScroll.current;
    if (scroll)
      scroll.scrollTo({
        top: scroll.scrollHeight,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    followBottom.current = true;
  };
  const canStop =
    !archivedAt &&
    Boolean(requestId) &&
    [
      "queued",
      "provisioning",
      "running",
      "preparing_pr",
      "pushing",
      "creating_pr",
      "cancelling",
    ].includes(status);
  const stopCurrentRequest = async () => {
    if (!requestId || stopping || status === "cancelling") return;
    setStopping(true);
    setStopError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/stop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: requestId }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Could not stop this request");
      router.refresh();
    } catch (error) {
      setStopError(
        error instanceof Error ? error.message : "Could not stop this request",
      );
      setStopping(false);
    }
  };

  const setPanelOpen = (open: boolean) => {
    setWorkbenchOpen(open);
  };
  const openFile = (reference: string) => {
    const query = fileReferenceTarget(reference);
    setWorkbenchOpen(true);
    router.push(`/tasks/${taskId}?${query}`, { scroll: false });
  };

  const sendFollowup = async () => {
    const content = followup.trim();
    if (!content || sending) return;
    if (
      submission.current?.content !== content ||
      submission.current.skills !== JSON.stringify(skillIds)
    )
      submission.current = {
        content,
        skills: JSON.stringify(skillIds),
        key: crypto.randomUUID(),
      };
    setSending(true);
    setSendError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content,
          idempotencyKey: submission.current.key,
          skillIds,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Could not send your follow-up");
      setFollowup("");
      submission.current = null;
    } catch (error) {
      setSendError(
        error instanceof Error
          ? error.message
          : "Could not send your follow-up. Try again.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={`agent-workspace ${styles.workspace} ${workbenchOpen ? "" : "panel-closed"}`}
    >
      <aside className={`conversation-pane ${styles.conversation}`}>
        <div className="pane-heading">
          <div>
            <MessageSquareText size={16} />
            <strong>Conversation</strong>
          </div>
          <div className={styles.headerActions}>
            <span>{meaningfulEvents.length} updates</span>
            <div
              className={styles.promptNavigator}
              ref={promptMenu}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") setPromptMenuOpen(true);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") setPromptMenuOpen(false);
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setPromptMenuOpen(false);
              }}
            >
              <nav className={styles.promptBars} aria-label="Prompt history">
                {prompts.map((prompt, index) => (
                  <button
                    type="button"
                    key={prompt.id}
                    className={styles.promptBar}
                    aria-label={`Go to prompt ${index + 1}`}
                    aria-current={
                      activePromptId === prompt.id ? "step" : undefined
                    }
                    aria-haspopup="menu"
                    aria-expanded={promptMenuOpen}
                    onFocus={() => setPromptMenuOpen(true)}
                    onClick={() => setPromptMenuOpen(true)}
                  >
                    <span />
                  </button>
                ))}
              </nav>
              {promptMenuOpen && (
                <div
                  className={styles.promptMenu}
                  role="menu"
                  aria-label="User prompts"
                >
                  {prompts.map((prompt) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={prompt.id}
                      onClick={() => jumpToPrompt(prompt.id)}
                      title={prompt.text}
                      data-active={activePromptId === prompt.id}
                    >
                      <span>{prompt.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div
          className="conversation-scroll"
          aria-live="polite"
          ref={chatScroll}
          onScroll={() => {
            const scroll = chatScroll.current;
            if (scroll) {
              const atBottom =
                scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <
                80;
              followBottom.current = atBottom;
              setShowLatest(!atBottom);
            }
          }}
        >
          <article
            className="message user-message"
            id={initialPromptId}
            tabIndex={-1}
          >
            <div>
              <p>{objective}</p>
              <header>
                <LocalTime value={createdAt} />
              </header>
            </div>
          </article>
          {entries.map((entry) =>
            entry.kind === "message" ? (
              <LiveConversationEvent
                event={entry.event}
                onOpenFile={openFile}
                taskId={taskId}
                active={!terminalStates.has(status)}
                key={entry.event.id}
              />
            ) : entry.events.length === 1 &&
              entry.events[0]?.title === "Request stopped" ? (
              <div
                className={styles.stoppedRequest}
                role="status"
                key={entry.events[0].id}
              >
                <div>
                  <strong>Request stopped</strong>
                  <span>You can continue with a new message below.</span>
                </div>
              </div>
            ) : (
              <section
                className={styles.workLog}
                aria-label="Work log"
                key={entry.events[0]!.id}
              >
                <div className={styles.workLogHeading}>
                  <Clock3 size={13} />
                  <strong>Work log</strong>
                  <span>
                    {groupRepeatedWorkEvents(entry.events).length}{" "}
                    {groupRepeatedWorkEvents(entry.events).length === 1
                      ? "update"
                      : "updates"}
                  </span>
                </div>
                {groupRepeatedWorkEvents(entry.events).map((group) => {
                  const timing = groupTiming(group, events, status, now);
                  return (
                    <LiveConversationEvent
                      event={group.event}
                      onOpenFile={openFile}
                      taskId={taskId}
                      active={timing.running}
                      durationMs={timing.durationMs}
                      key={group.event.id}
                    />
                  );
                })}
              </section>
            ),
          )}
        </div>
        <div className={styles.composer}>
          {showLatest && (
            <button
              type="button"
              className={styles.latestButton}
              onClick={jumpToLatest}
              aria-label="Jump to latest message"
              title="Jump to latest message"
            >
              <ArrowDown size={18} />
            </button>
          )}
          <form
            className="followup-box"
            onSubmit={(event) => {
              event.preventDefault();
              void sendFollowup();
            }}
          >
            {stopError && <p role="alert">{stopError}</p>}
            <SkillPrompt
              aria-label="Follow-up message"
              placeholder={
                workbench
                  ? "Session stays open. Continue in the same workspace and thread."
                  : "Continue in the same conversation."
              }
              value={followup}
              onValueChange={setFollowup}
              skillIds={skillIds}
              onSkillsChange={setSkillIds}
              maxLength={8000}
              disabled={sending || status === "cancelling"}
              rows={3}
            />
            {canStop ? (
              <button
                type="button"
                className={styles.stopButton}
                onClick={() => void stopCurrentRequest()}
                disabled={stopping || status === "cancelling"}
                aria-label="Stop current request"
                title={
                  stopping || status === "cancelling"
                    ? "Stopping request..."
                    : "Stop current request"
                }
                aria-busy={stopping || status === "cancelling"}
              >
                <Square size={14} strokeWidth={2.2} />
              </button>
            ) : (
              <button
                type="submit"
                className={sending ? styles.sendingButton : undefined}
                aria-label="Send follow-up"
                disabled={
                  sending || !followup.trim() || status === "cancelling"
                }
              >
                {sending ? "Sending..." : <Send size={14} />}
              </button>
            )}
            {sendError && <p role="alert">{sendError}</p>}
          </form>
        </div>
      </aside>

      {workbench &&
        (workbenchOpen ? (
          <div className="workbench-shell">
            <button
              className="workbench-toggle close"
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label="Close task workbench"
              title="Close workbench"
            >
              <PanelRightClose size={15} />
            </button>
            {workbench}
          </div>
        ) : (
          <button
            className="workbench-toggle reopen"
            type="button"
            onClick={() => setPanelOpen(true)}
            aria-label="Open task workbench"
            title="Open workbench"
          >
            <PanelRightOpen size={15} />
          </button>
        ))}
    </div>
  );
}

function LiveConversationEvent({
  event,
  active,
  taskId,
  onOpenFile,
  durationMs = null,
}: {
  event: LiveTaskEvent;
  active: boolean;
  taskId: string;
  onOpenFile: (reference: string) => void;
  durationMs?: number | null;
}) {
  const failed = event.status === "failed";
  const user = event.category === "conversation";
  const running = active;
  const card = prCardData(event.evidence);
  if (card) return <PullRequestChatCard data={card} onOpenFile={onOpenFile} />;
  if (!["conversation", "agent_message", "message"].includes(event.category))
    return (
      <details className={styles.work} open={event.status === "failed"}>
        <summary>
          <span className={`${styles.dot} ${running ? styles.running : ""}`} />
          <strong>{event.title}</strong>
          <span>
            {running
              ? durationMs === null
                ? "Working"
                : `Working (${formatWorkDuration(durationMs)})`
              : event.status === "failed"
                ? "Failed"
                : durationMs === null
                  ? "Recorded"
                  : `Worked for ${formatWorkDuration(durationMs)}`}
          </span>
          <LocalTime value={event.timestamp} />
        </summary>
        {event.category === "tool" ? (
          <pre>{event.whatWasDone}</pre>
        ) : (
          <p>{event.whatWasDone}</p>
        )}
        {event.whyItWasDone && <p>{event.whyItWasDone}</p>}
      </details>
    );
  return (
    <article
      className={`message ${user ? "user-message" : "agent-message"}`}
      id={user ? `prompt-${event.id}` : undefined}
      tabIndex={user ? -1 : undefined}
    >
      {!user && (
        <span className={`message-avatar ${failed ? "warning" : "agent"}`}>
          {failed ? <AlertTriangle size={14} /> : <Bot size={15} />}
        </span>
      )}
      <div>
        {user ? (
          <p className={styles.response}>{event.whatWasDone}</p>
        ) : (
          <MarkdownMessage
            text={event.whatWasDone}
            taskId={taskId}
            onOpenFile={onOpenFile}
          />
        )}
        {!user && event.whyItWasDone && (
          <p className="decision-note">
            <span>Why</span>
            {event.whyItWasDone}
          </p>
        )}
        <header>
          <LocalTime value={event.timestamp} />
        </header>
      </div>
    </article>
  );
}

function groupRepeatedWorkEvents(events: LiveTaskEvent[]) {
  const groups: LiveTaskEvent[][] = [];
  for (const event of events) {
    const previous = groups.at(-1);
    if (
      previous &&
      previous[0]?.title === event.title &&
      previous[0]?.category === event.category
    ) {
      previous.push(event);
    } else {
      groups.push([event]);
    }
  }
  return groups.map((group) => ({ event: group[0]!, events: group }));
}

function groupTiming(
  group: { event: LiveTaskEvent; events: LiveTaskEvent[] },
  source: LiveTaskEvent[],
  status: string,
  now: number,
) {
  let durationMs = 0;
  let hasDuration = false;
  let running = false;
  for (const event of group.events) {
    const timing = workEventTiming(event, source, status, now);
    running ||= timing.running;
    if (timing.durationMs !== null) {
      durationMs += timing.durationMs;
      hasDuration = true;
    }
  }
  return {
    durationMs: hasDuration ? durationMs : null,
    running,
  };
}

function LocalTime({ value }: { value: string }) {
  const label = useSyncExternalStore(
    subscribeTimezone,
    () => {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return new Date(value).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: zone,
      });
    },
    () => "...",
  );
  return (
    <time dateTime={value} title={new Date(value).toISOString()}>
      {label || "..."}
    </time>
  );
}
function subscribeTimezone() {
  return () => {};
}
