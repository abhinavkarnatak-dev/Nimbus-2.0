export function sessionTitlePrompt(
  objective: string,
  currentTitle: string,
  alreadyGenerated = false,
  mode: "repository" | "chat" = "repository",
): string {
  const presentation =
    "Nimbus presentation instruction: Answer directly. Do not add an opening heading, standalone response title, or repeated mini-title to your replies, including follow-ups. This replaces any earlier instruction to start replies with a Markdown heading. Keep useful paragraphs, lists, and code blocks.";
  if (alreadyGenerated) return `${objective}\n\n${presentation}`;
  return `${objective}\n\n${presentation}\nSession metadata instruction: At the very end of your final answer, emit exactly one <nimbus_session_title>JSON string</nimbus_session_title> block containing a concise 3-8 word session title (at most 80 characters). This block is hidden metadata, not part of the visible answer. Summarize the session's actual topic and work, not a generic heading or the user's wording. ${mode === "chat" ? "This is general chat with no repository selected. Name the actual conversation topic; never use Repository overview or invent repository work." : "Name the actual repository task."} Current placeholder: ${JSON.stringify(currentTitle)}. Keep the title descriptive without claiming unverified success. This instruction does not authorize additional repository changes.`;
}

const TITLE_OPEN = "<nimbus_session_title>";
const TITLE_CLOSE = "</nimbus_session_title>";

export function sessionTitleFromMetadata(response: string): string | null {
  const start = response.lastIndexOf(TITLE_OPEN);
  const end = response.indexOf(TITLE_CLOSE, start + TITLE_OPEN.length);
  if (start < 0 || end < 0) return null;
  try {
    const title: unknown = JSON.parse(
      response.slice(start + TITLE_OPEN.length, end).trim(),
    );
    return typeof title === "string" &&
      sessionTitleFromResponse(`## ${title}`) === title
      ? title
      : null;
  } catch {
    return null;
  }
}

export function sessionTitleFromResponse(response: string): string | null {
  const heading = response
    .trimStart()
    .split(/\r?\n/, 1)[0]
    ?.match(/^##\s+(.+?)\s*#*$/)?.[1]
    ?.trim();
  if (
    !heading ||
    heading.length < 3 ||
    heading.length > 80 ||
    /[<>`\[\]\\/:\u0000-\u001f\u2013\u2014]/.test(heading)
  )
    return null;
  return heading;
}

export class SessionTitleTracker {
  #published = false;
  constructor(
    private readonly enabled = true,
    private readonly mode: "repository" | "chat" = "repository",
  ) {}
  #text = "";
  #itemId: string | undefined;
  observe(update: {
    type: string;
    text?: string;
    itemId?: string;
    status?: string;
  }): string | null {
    if (!this.enabled || this.#published) return null;
    if (update.type === "agent_message_delta") {
      if (update.itemId !== this.#itemId) this.#text = "";
      this.#itemId = update.itemId;
      this.#text = (this.#text + (update.text ?? "")).slice(-4096);
    }
    const title =
      update.type === "turn_completed" && update.status === "completed"
        ? sessionTitleFromMetadata(this.#text)
        : null;
    if (title && this.mode === "chat" && /^repository overview$/i.test(title))
      return null;
    if (title) this.#published = true;
    return title;
  }
}

// Suppress reserved metadata before any delta reaches durable chat or the UI.
// Keep partial delimiters buffered so even character-by-character streams cannot leak it.
export async function* presentSessionTurn<
  T extends { type: string; text?: string; itemId?: string; status?: string },
>(
  source: AsyncIterable<T>,
  titleEnabled: boolean,
  onTitle: (title: string) => void | Promise<unknown>,
  mode: "repository" | "chat" = "repository",
): AsyncGenerator<T> {
  const tracker = new SessionTitleTracker(titleEnabled, mode);
  let pending = "";
  let hidden = false;
  let lastDelta: T | undefined;
  function visible(text: string) {
    pending += text;
    let output = "";
    while (pending) {
      if (hidden) {
        const end = pending.indexOf(TITLE_CLOSE);
        if (end < 0) {
          pending = pending.slice(-(TITLE_CLOSE.length - 1));
          break;
        }
        pending = pending.slice(end + TITLE_CLOSE.length);
        hidden = false;
      } else {
        const start = pending.indexOf(TITLE_OPEN);
        if (start >= 0) {
          output += pending.slice(0, start);
          pending = pending.slice(start + TITLE_OPEN.length);
          hidden = true;
          continue;
        }
        let held = 0;
        for (let size = 1; size < TITLE_OPEN.length; size++)
          if (pending.endsWith(TITLE_OPEN.slice(0, size))) held = size;
        output += pending.slice(0, pending.length - held);
        pending = held ? pending.slice(-held) : "";
        break;
      }
    }
    return output;
  }
  for await (const update of source) {
    const title = tracker.observe(update);
    if (title) await onTitle(title);
    if (update.type === "agent_message_delta") {
      if (lastDelta && update.itemId !== lastDelta.itemId) {
        if (pending && !hidden && !TITLE_OPEN.startsWith(pending))
          yield { ...lastDelta, text: pending };
        pending = "";
        hidden = false;
      }
      lastDelta = update;
      const text = visible(update.text ?? "");
      if (text) yield { ...update, text };
    } else {
      if (update.type === "turn_completed") {
        if (lastDelta && pending && !hidden && !TITLE_OPEN.startsWith(pending))
          yield { ...lastDelta, text: pending };
        pending = "";
        hidden = false;
      }
      yield update;
    }
  }
}
