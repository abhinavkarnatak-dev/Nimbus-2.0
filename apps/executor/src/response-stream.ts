import type { CodingAgentEvent } from "@nimbus/codex";

export async function* streamResponseBatches(
  source: AsyncIterable<CodingAgentEvent>,
  intervalMs = 100,
): AsyncIterable<CodingAgentEvent> {
  const iterator = source[Symbol.asyncIterator]();
  const next = () => {
    const result = iterator.next();
    void result.catch(() => {});
    return result;
  };
  let pending = next();
  let buffered:
    | Extract<CodingAgentEvent, { type: "agent_message_delta" }>
    | undefined;
  let itemId: string | undefined;
  let published = false;
  let deadline = 0;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        pending.then((value) => ({ kind: "next" as const, value })),
        ...(buffered
          ? [
              new Promise<{ kind: "flush" }>((resolve) => {
                timer = setTimeout(
                  () => resolve({ kind: "flush" }),
                  Math.max(0, deadline - Date.now()),
                );
              }),
            ]
          : []),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (outcome.kind === "flush") {
        if (buffered) yield buffered;
        buffered = undefined;
        continue;
      }
      if (outcome.value.done) break;
      const event = outcome.value.value;
      pending = next();
      if (event.type !== "agent_message_delta") {
        if (buffered) yield buffered;
        buffered = undefined;
        yield event;
        continue;
      }
      if (event.itemId !== itemId) {
        if (buffered) yield buffered;
        buffered = undefined;
        itemId = event.itemId;
        published = false;
      }
      if (!published) {
        published = true;
        yield event;
      } else {
        if (!buffered) {
          buffered = { ...event };
          deadline = Date.now() + intervalMs;
        } else buffered.text += event.text;
        if (buffered.text.length >= 1000) {
          yield buffered;
          buffered = undefined;
        }
      }
    }
    if (buffered) yield buffered;
  } finally {
    await iterator.return?.();
  }
}
