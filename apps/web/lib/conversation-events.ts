import { prCardData } from "./pr-card";

export interface ConversationEvent {
  id: string;
  sequence: number;
  category: string;
  title: string;
  whatWasDone: string;
  whyItWasDone?: string;
  status?: string;
  evidence?: unknown;
}

export function isProtocolEvent(event: ConversationEvent): boolean {
  return event.category === "protocol" || event.title === "Codex activity";
}

export function conversationEvents<T extends ConversationEvent>(
  events: readonly T[],
): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  for (const original of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const event = presentAgentEvent(original);
    // Stop-in-progress is already shown on the composer button. Inserting it
    // between streamed deltas splits a single partial reply into two bubbles.
    if (event.category === "lifecycle" && event.title === "Stopping request")
      continue;
    if (
      event.category === "agent_message" &&
      event.whatWasDone.startsWith("Pull request ready:") &&
      Array.isArray(event.evidence) &&
      event.evidence.some(
        (value) =>
          typeof value === "string" &&
          value.startsWith("codex-item:nimbus-pr-"),
      ) &&
      events.some(
        (candidate) =>
          prCardData(candidate.evidence)?.url &&
          event.whatWasDone.includes(prCardData(candidate.evidence)!.url),
      )
    )
      continue;
    if (seen.has(event.id) || isProtocolEvent(event)) continue;
    seen.add(event.id);
    const toolId = event.category === "tool" ? itemId(event) : undefined;
    const toolIndex = toolId
      ? result.findIndex(
          (previous) =>
            previous.category === "tool" && itemId(previous) === toolId,
        )
      : -1;
    if (toolIndex >= 0) {
      result[toolIndex] = { ...event };
      continue;
    }
    const previous = result.at(-1);
    if (
      event.category === "agent_message" &&
      previous?.category === "agent_message" &&
      !prCardData(event.evidence) &&
      !prCardData(previous.evidence) &&
      itemId(event) === itemId(previous)
    ) {
      result[result.length - 1] = {
        ...previous,
        whatWasDone: previous.whatWasDone + event.whatWasDone,
      };
    } else
      result.push(
        event.title === "Run completed"
          ? {
              ...event,
              title: "Response finished",
              whatWasDone:
                "Codex finished this response. This is not confirmation that repository changes or tests were verified.",
            }
          : { ...event },
      );
  }
  return result;
}

// Only translate known system-authored copy. Never rewrite agent replies, user
// messages, code, command output, or the persisted audit record.
export function presentAgentEvent<T extends ConversationEvent>(event: T): T {
  if (event.category === "lifecycle" && event.title === "Sandbox paused")
    return {
      ...event,
      title: "Nimbus in sleep mode",
      whatWasDone: "Your session is sleeping. Repository changes are saved.",
      whyItWasDone:
        "Send another message to wake Nimbus and continue the same conversation.",
    };
  if (!["agent_state", "tool"].includes(event.category)) return event;
  const copy = (value: string) =>
    value === "Codex is deciding its next action."
      ? "Nimbus is deciding its next action."
      : value ===
          "Codex ran this command to investigate or verify the requested outcome."
        ? "Nimbus ran this command to investigate or verify the requested outcome."
        : value;
  return {
    ...event,
    whatWasDone: copy(event.whatWasDone),
    ...(event.whyItWasDone !== undefined
      ? { whyItWasDone: copy(event.whyItWasDone) }
      : {}),
  };
}

function itemId(event: ConversationEvent): string | undefined {
  return Array.isArray(event.evidence)
    ? event.evidence.find(
        (value) => typeof value === "string" && value.startsWith("codex-item:"),
      )
    : undefined;
}

export function conversationEntries<T extends ConversationEvent>(
  events: readonly T[],
) {
  const result: Array<
    { kind: "message"; event: T } | { kind: "work"; events: T[] }
  > = [];
  let followUp = false;
  for (const event of events) {
    if (
      event.status !== "failed" &&
      ["Response finished", "Run completed"].includes(event.title)
    )
      continue;
    if (event.category === "conversation") followUp = true;
    if (
      followUp &&
      event.status !== "failed" &&
      [
        "Workspace ready",
        "Repository checkout started",
        "Repository ready",
      ].includes(event.title)
    )
      continue;
    if (["conversation", "agent_message", "message"].includes(event.category))
      result.push({ kind: "message", event });
    else {
      const previous = result.at(-1);
      if (
        previous?.kind === "work" &&
        event.title !== "Request stopped" &&
        !previous.events.some((item) => item.title === "Request stopped")
      )
        previous.events.push(event);
      else result.push({ kind: "work", events: [event] });
    }
  }
  return result;
}

// Keep Activity concise without deleting durable events or hiding failures.
export function activityEvents<T extends ConversationEvent>(
  events: readonly T[],
): T[] {
  let resumed = false;
  const seenSetup = new Set<string>();
  const setupTitles = new Set([
    "Workspace ready",
    "Repository checkout started",
    "Repository ready",
  ]);
  return conversationEvents(events).filter((event) => {
    if (
      event.title === "Workspace resume started" &&
      event.category === "lifecycle"
    )
      resumed = true;
    if (event.status === "failed") return true;
    if (event.category === "agent_state" && event.title === "Thinking")
      return false;
    if (
      ["lifecycle", "repository"].includes(event.category) &&
      setupTitles.has(event.title)
    ) {
      const repeated = resumed || seenSetup.has(event.title);
      seenSetup.add(event.title);
      return !repeated;
    }
    return true;
  });
}

export function isWorkEventRunning(
  event: ConversationEvent & { status: string },
  events: readonly (ConversationEvent & { phase?: string })[],
  taskStatus: string,
): boolean {
  return (
    taskStatus === "running" &&
    event.status === "running" &&
    !events.some(
      (next) =>
        next.sequence > event.sequence &&
        (next.category === "conversation" ||
          ["completed", "failed", "cancelled", "pr_open"].includes(
            next.phase ?? "",
          ) ||
          (event.category === "agent_state" && !isProtocolEvent(next))),
    )
  );
}
