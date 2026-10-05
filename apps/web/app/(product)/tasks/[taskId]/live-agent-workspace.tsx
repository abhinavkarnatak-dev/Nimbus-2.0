"use client";

import {
  AlertTriangle,
  Bot,
  Clock3,
  MessageSquareText,
  PanelRightClose,
  PanelRightOpen,
  Send,
  User,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

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
}

interface LiveAgentWorkspaceProps {
  taskId: string;
  createdAt: string;
  finishedAt: string | null;
  objective: string;
  model: string;
  initialStatus: string;
  initialEvents: LiveTaskEvent[];
  workbench: ReactNode;
}

const terminalStates = new Set(["completed", "failed", "cancelled", "pr_open"]);

export function LiveAgentWorkspace({
  taskId,
  createdAt,
  finishedAt,
  objective,
  model,
  initialStatus,
  initialEvents,
  workbench,
}: LiveAgentWorkspaceProps) {
  const [events, setEvents] = useState(initialEvents);
  const [status, setStatus] = useState(initialStatus);
  const [connection, setConnection] = useState<"live" | "reconnecting">("live");
  const [workbenchOpen, setWorkbenchOpen] = useState(true);
  const [now, setNow] = useState(() =>
    finishedAt ? new Date(finishedAt).getTime() : Date.now(),
  );
  const latestSequence = useRef(initialEvents.at(-1)?.sequence ?? 0);

  useEffect(() => {
    if (terminalStates.has(status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    const stream = new EventSource(
      `/api/tasks/${taskId}/events?after=${String(latestSequence.current)}`,
    );
    stream.onopen = () => setConnection("live");
    stream.onerror = () => setConnection("reconnecting");
    stream.addEventListener("task_state", (message) => {
      const value = JSON.parse((message as MessageEvent<string>).data) as {
        status?: string;
      };
      if (value.status) setStatus(value.status);
    });
    stream.addEventListener("task_event", (message) => {
      const event = JSON.parse(
        (message as MessageEvent<string>).data,
      ) as LiveTaskEvent;
      latestSequence.current = Math.max(latestSequence.current, event.sequence);
      setEvents((current) => {
        if (current.some((item) => item.id === event.id)) return current;
        return [...current, event].sort((a, b) => a.sequence - b.sequence);
      });
    });
    return () => stream.close();
  }, [taskId]);

  const latest = events.at(-1);
  const mode = activityMode(status, latest);
  const elapsed = useMemo(
    () => formatElapsed(Math.max(0, now - new Date(createdAt).getTime())),
    [createdAt, now],
  );

  const setPanelOpen = (open: boolean) => {
    setWorkbenchOpen(open);
  };

  return (
    <div className={`agent-workspace ${workbenchOpen ? "" : "panel-closed"}`}>
      <aside className="conversation-pane">
        <div className="pane-heading">
          <div>
            <MessageSquareText size={16} />
            <strong>Conversation</strong>
          </div>
          <span>{events.length} confirmed events</span>
        </div>
        <div className="conversation-scroll" aria-live="polite">
          <article className="message user-message">
            <span className="message-avatar user">
              <User size={14} />
            </span>
            <div>
              <header>
                <strong>You</strong>
                <time>{formatTime(createdAt)}</time>
              </header>
              <p>{objective}</p>
            </div>
          </article>
          <article className="message agent-message">
            <span className="message-avatar agent">
              <Bot size={15} />
            </span>
            <div>
              <header>
                <strong>Nimbus</strong>
                <span className="model-label">{model}</span>
              </header>
              <p>
                I accepted the outcome and created a durable run. I will report
                confirmed work here as it happens.
              </p>
              <div className="live-agent-presence">
                <div className="presence-heading">
                  <span
                    className={`presence-pulse ${terminalStates.has(status) ? "done" : ""}`}
                  />
                  <strong>{mode}</strong>
                  <span className={`stream-health ${connection}`}>
                    {connection === "live" ? "live" : "reconnecting"}
                  </span>
                </div>
                <div className="presence-facts">
                  <span>
                    <small>State</small>
                    <b>{status.replaceAll("_", " ")}</b>
                  </span>
                  <span>
                    <small>Elapsed</small>
                    <b>
                      <Clock3 size={11} /> {elapsed}
                    </b>
                  </span>
                  <span>
                    <small>Done so far</small>
                    <b>
                      {
                        events.filter((event) => event.status === "succeeded")
                          .length
                      }{" "}
                      actions
                    </b>
                  </span>
                </div>
                {latest && (
                  <p>
                    <strong>Now:</strong> {latest.title}. {latest.whatWasDone}
                  </p>
                )}
              </div>
            </div>
          </article>
          {events
            .filter((event) => event.sequence > 1)
            .map((event) => (
              <LiveConversationEvent event={event} key={event.id} />
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

      {workbenchOpen ? (
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
        >
          <PanelRightOpen size={16} />
          <span>Open workbench</span>
        </button>
      )}
    </div>
  );
}

function LiveConversationEvent({ event }: { event: LiveTaskEvent }) {
  const failed = event.status === "failed";
  return (
    <article className="message agent-message">
      <span className={`message-avatar ${failed ? "warning" : "agent"}`}>
        {failed ? <AlertTriangle size={14} /> : <Bot size={15} />}
      </span>
      <div>
        <header>
          <strong>Nimbus</strong>
          <time>{formatTime(event.timestamp)}</time>
        </header>
        <p>
          <strong>{event.title}.</strong> {event.whatWasDone}
        </p>
        {event.whyItWasDone && (
          <p className="decision-note">
            <span>Why</span>
            {event.whyItWasDone}
          </p>
        )}
      </div>
    </article>
  );
}

function activityMode(status: string, latest: LiveTaskEvent | undefined) {
  if (status === "queued") return "Waiting to start";
  if (status === "provisioning") return "Setting up workspace";
  if (status === "awaiting_user") return "Waiting for your input";
  if (status === "paused") return "Paused";
  if (status === "cancelling") return "Stopping safely";
  if (status === "failed") return "Run failed";
  if (status === "cancelled") return "Run cancelled";
  if (status === "completed" || status === "pr_open") return "Work complete";
  if (latest?.category === "plan") return "Planning next action";
  if (latest?.category === "check") return "Verifying changes";
  if (latest?.category === "delivery") return "Preparing delivery";
  return "Working in the repository";
}

function formatElapsed(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, "0")}m`
    : `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
