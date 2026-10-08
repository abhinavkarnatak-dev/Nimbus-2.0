import {
  activityEvents,
  isProtocolEvent,
  type ConversationEvent,
} from "./conversation-events";
import { isWebActivity } from "@nimbus/shared";

export function workGroups<T extends ConversationEvent>(events: readonly T[]) {
  const groups = new Map<string, { label: string; events: T[] }>();
  for (const event of events) {
    const key = isWebActivity(event)
      ? "web"
      : event.category === "agent_state"
        ? "thinking"
        : event.category === "tool"
          ? "commands"
          : `${event.category}:${event.title}`;
    const group = groups.get(key) ?? {
      label:
        key === "web"
          ? "Web research"
          : key === "thinking"
            ? "Thinking"
            : key === "commands"
              ? "Commands"
              : event.title,
      events: [],
    };
    group.events.push(event);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// Roll up repeated actions within one user turn. Originals remain available for
// replay/auditing; failed actions always keep their own visible entry.
export function groupedActivityEvents<T extends ConversationEvent>(
  source: readonly T[],
): T[] {
  const result: T[] = [];
  const positions = new Map<string, number>();
  const children = new Map<string, T[]>();
  for (const event of activityEvents(source)) {
    if (
      event.category === "conversation" ||
      event.status === "failed" ||
      event.category === "lifecycle"
    )
      positions.clear();
    const groupable =
      event.status !== "failed" &&
      (isWebActivity(event) ||
        event.title === "Repository inspected" ||
        (event.category === "agent_state" && event.title === "Active"));
    if (!groupable) {
      result.push(event);
      continue;
    }
    const key = isWebActivity(event)
      ? "web-research"
      : `${event.category}:${event.title}:${event.status}`;
    const index = positions.get(key);
    if (index === undefined) {
      positions.set(key, result.length);
      children.set(key, [event]);
      result.push(event);
    } else {
      const members = children.get(key)!;
      members.push(event);
      result[index] = {
        ...members[0]!,
        title: `${isWebActivity(event) ? "Web research" : event.title} (${members.length} actions)`,
        whatWasDone: members
          .map((item) => item.whatWasDone)
          .filter(Boolean)
          .join("\n\n"),
      };
    }
  }
  return result;
}

export function workSummary<
  T extends ConversationEvent & { timestamp: string; phase?: string },
>(events: readonly T[], source: readonly T[], status: string, now: number) {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const last = ordered.at(-1)!;
  const first = ordered[0]!;
  const next = source.find(
    (event) => event.sequence > last.sequence && !isProtocolEvent(event),
  );
  const active =
    [
      "queued",
      "provisioning",
      "running",
      "preparing_pr",
      "pushing",
      "creating_pr",
    ].includes(status) &&
    !next &&
    last.status !== "failed";
  // Tool completion replaces its start in the conversation projection. Recover
  // the earliest timestamp from the original event stream, not page-load time.
  const itemIds = events.flatMap((event) =>
    Array.isArray(event.evidence)
      ? event.evidence.filter(
          (value) =>
            typeof value === "string" && value.startsWith("codex-item:"),
        )
      : [],
  );
  const starts = source.filter(
    (event) =>
      event.id === first.id ||
      (Array.isArray(event.evidence) &&
        event.evidence.some((value) => itemIds.includes(value))),
  );
  const start = Math.min(
    Date.parse(first.timestamp),
    ...starts.map((event) => Date.parse(event.timestamp)),
  );
  const end = active
    ? now
    : next && next.category !== "conversation"
      ? Date.parse(next.timestamp)
      : Date.parse(last.timestamp);
  const failures = events.filter((event) => event.status === "failed").length;
  return {
    active,
    durationMs: Math.max(0, end - start),
    failures,
    webLabel: ordered.filter(isWebActivity).at(-1)?.title,
    label: isWebActivity(last)
      ? last.title
      : last.category === "agent_state"
        ? "Thinking"
        : "Working",
  };
}

export function needsPendingProgress(
  events: readonly ConversationEvent[],
  status: string,
  pendingAfter: number | null,
) {
  if (
    pendingAfter !== null &&
    !events.some(
      (event) =>
        event.sequence > pendingAfter &&
        !["conversation", "protocol"].includes(event.category),
    )
  )
    return true;
  if (
    ![
      "queued",
      "provisioning",
      "running",
      "preparing_pr",
      "pushing",
      "creating_pr",
    ].includes(status)
  )
    return false;
  const last = events.filter((event) => !isProtocolEvent(event)).at(-1);
  return !last || last.category === "conversation";
}
