import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: async () => "a".repeat(64),
}));
import { LocalConnectedCodexProvider, validBridgeKey } from "./local-bridge.js";
afterEach(() => vi.unstubAllGlobals());
describe("local Codex execution bridge", () => {
  it("rejects invalid, unequal, and non-ASCII credentials", () => {
    expect(validBridgeKey("a".repeat(64), "a".repeat(64))).toBe(true);
    expect(validBridgeKey("b".repeat(64), "a".repeat(64))).toBe(false);
    expect(validBridgeKey("", "a".repeat(64))).toBe(false);
    expect(validBridgeKey("é".repeat(64), "a".repeat(64))).toBe(false);
  });
  it("replays partial streamed events and the official terminal status", async () => {
    const bytes = new TextEncoder().encode(
      '{"type":"agent_message_delta","text":"Hello"}\n{"type":"turn_completed","turnId":"t1","status":"completed"}\n',
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(bytes.slice(0, 17));
                controller.enqueue(bytes.slice(17));
                controller.close();
              },
            }),
          ),
      ),
    );
    const provider = new LocalConnectedCodexProvider("task-a", "C:/workspace");
    const events = [];
    for await (const event of provider.runTurn({
      threadId: "thread-a",
      prompt: "ignored; loaded from durable task",
    }))
      events.push(event);
    expect(events).toEqual([
      { type: "agent_message_delta", text: "Hello" },
      { type: "turn_completed", turnId: "t1", status: "completed" },
    ]);
  });
  it("does not report a disconnected stream as successful", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"type":"agent_message_delta","text":"Hello"}\n'),
      ),
    );
    const provider = new LocalConnectedCodexProvider("task-a", "C:/workspace");
    await expect(
      (async () => {
        for await (const _event of provider.runTurn({
          threadId: "thread-a",
          prompt: "test",
        })) {
        }
      })(),
    ).rejects.toThrow("without a terminal");
  });
});
