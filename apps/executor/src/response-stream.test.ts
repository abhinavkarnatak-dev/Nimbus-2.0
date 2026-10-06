import { describe, expect, it } from "vitest";
import type { CodingAgentEvent } from "@nimbus/codex";
import { streamResponseBatches } from "./response-stream.js";

describe("response streaming", () => {
  it("propagates interrupted transport errors without inventing completion", async () => {
    async function* source(): AsyncIterable<CodingAgentEvent> {
      yield { type: "agent_message_delta", text: "Partial reply" };
      throw new Error("Stream disconnected");
    }
    const iterator = streamResponseBatches(source())[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({
      text: "Partial reply",
    });
    await expect(iterator.next()).rejects.toThrow("Stream disconnected");
  });
  it("publishes the first fragment and flushes buffered content while inference is still waiting", async () => {
    let release!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* source(): AsyncIterable<CodingAgentEvent> {
      yield { type: "agent_message_delta", text: "## Overview", itemId: "a" };
      yield {
        type: "agent_message_delta",
        text: "\nFirst findings",
        itemId: "a",
      };
      await pause;
      yield { type: "turn_completed", turnId: "t", status: "completed" };
    }
    const iterator = streamResponseBatches(source(), 10)[
      Symbol.asyncIterator
    ]();
    expect((await iterator.next()).value).toMatchObject({
      text: "## Overview",
    });
    expect((await iterator.next()).value).toMatchObject({
      text: "\nFirst findings",
    });
    release();
    expect((await iterator.next()).value).toMatchObject({
      type: "turn_completed",
    });
    await iterator.return?.();
  });
  it("preserves message boundaries, text, and failed terminal events", async () => {
    async function* source(): AsyncIterable<CodingAgentEvent> {
      yield { type: "agent_message_delta", text: "A", itemId: "a" };
      yield { type: "agent_message_delta", text: "B", itemId: "a" };
      yield { type: "agent_message_delta", text: "C", itemId: "b" };
      yield { type: "turn_completed", turnId: "t", status: "failed" };
    }
    const events = [];
    for await (const event of streamResponseBatches(source()))
      events.push(event);
    expect(
      events.map((event) =>
        event.type === "agent_message_delta" ? event.text : event.type,
      ),
    ).toEqual(["A", "B", "C", "turn_completed"]);
    expect(events.at(-1)).toMatchObject({ status: "failed" });
  });
});
