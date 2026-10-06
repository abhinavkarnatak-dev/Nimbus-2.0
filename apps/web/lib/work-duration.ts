import {
  isProtocolEvent,
  isWorkEventRunning,
  type ConversationEvent,
} from "./conversation-events";
type TimedEvent = ConversationEvent & { timestamp: string; phase?: string };

export function workEventTiming(
  event: TimedEvent,
  source: readonly TimedEvent[],
  taskStatus: string,
  now: number,
): { durationMs: number | null; running: boolean } {
  const finished = workEventDuration(event, source);
  if (finished !== null) return { durationMs: finished, running: false };
  const active = [
    "provisioning",
    "running",
    "preparing_pr",
    "pushing",
    "creating_pr",
  ].includes(taskStatus);
  const stageFinish = [
    "Workspace provisioning started",
    "Workspace resume started",
  ].includes(event.title)
    ? "Workspace ready"
    : event.title === "Repository checkout started"
      ? "Repository ready"
      : null;
  const blocked = source.some(
    (next) =>
      next.sequence > event.sequence &&
      (next.category === "conversation" ||
        ["completed", "failed", "cancelled", "pr_open"].includes(
          next.phase ?? "",
        ) ||
        (stageFinish &&
          (next.title === stageFinish || next.title === event.title))),
  );
  // Lifecycle start events are often recorded as succeeded: the notification was
  // persisted, not the provisioning/checkout operation itself completed.
  const running =
    active &&
    event.status !== "failed" &&
    !blocked &&
    (Boolean(stageFinish) ||
      isWorkEventRunning(
        { ...event, status: event.status ?? "" },
        source,
        "running",
      ));
  const elapsed = now - Date.parse(event.timestamp);
  return running && Number.isFinite(elapsed)
    ? { durationMs: Math.max(0, elapsed), running: true }
    : { durationMs: null, running: false };
}

export function formatWorkDuration(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  if (milliseconds > 0 && seconds === 0) return "<1s";
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// Use durable timestamps, not time since page load or the next user request.
export function workEventDuration(
  event: TimedEvent,
  source: readonly TimedEvent[],
): number | null {
  const events = [...source].sort((a, b) => a.sequence - b.sequence);
  const item = Array.isArray(event.evidence)
    ? event.evidence.find(
        (value) => typeof value === "string" && value.startsWith("codex-item:"),
      )
    : undefined;
  let start: TimedEvent | undefined;
  let end: TimedEvent | undefined;
  if (event.category === "tool" && item) {
    const matches = events.filter(
      (entry) =>
        entry.category === "tool" &&
        Array.isArray(entry.evidence) &&
        entry.evidence.includes(item),
    );
    start = matches.find((entry) => entry.status === "running");
    end = matches.find(
      (entry) =>
        entry.status !== "running" &&
        entry.sequence >= (start?.sequence ?? Infinity),
    );
  } else if (event.category === "agent_state") {
    start = event;
    end = events.find(
      (entry) => entry.sequence > event.sequence && !isProtocolEvent(entry),
    );
  } else {
    const stages: Array<[string[], string]> = [
      [
        ["Workspace provisioning started", "Workspace resume started"],
        "Workspace ready",
      ],
      [["Repository checkout started"], "Repository ready"],
    ];
    const stage = stages.find(
      ([starts, finish]) =>
        starts.includes(event.title) || finish === event.title,
    );
    if (stage) {
      if (stage[0].includes(event.title)) {
        start = event;
        // Do not cross a later turn or another stage attempt.
        const boundary = events.find(
          (entry) =>
            entry.sequence > event.sequence &&
            (entry.category === "conversation" ||
              stage[0].includes(entry.title) ||
              entry.title === stage[1]),
        );
        if (boundary?.title === stage[1]) end = boundary;
      } else {
        const previous = events
          .filter(
            (entry) =>
              entry.sequence < event.sequence &&
              (entry.category === "conversation" ||
                stage[0].includes(entry.title) ||
                entry.title === stage[1]),
          )
          .at(-1);
        if (previous && stage[0].includes(previous.title)) {
          start = previous;
          end = event;
        }
      }
    }
  }
  if (!start || !end || end.category === "conversation") return null;
  const elapsed = Date.parse(end.timestamp) - Date.parse(start.timestamp);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}
