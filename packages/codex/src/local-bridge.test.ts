import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: async () => "a".repeat(64),
}));
import {
  internalServiceUrl,
  localBridgeKey,
  LocalConnectedCodexProvider,
  validBridgeKey,
} from "./local-bridge.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("local Codex execution bridge", () => {
  it("returns a safely replaced thread id to the executor on resume", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ resumed: true, threadId: "replacement" }),
        ),
    );
    const provider = new LocalConnectedCodexProvider("task", ".");
    expect(await provider.resumeThread("original")).toBe("replacement");
  });
  it("requires a shared server credential in production instead of a local key file", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NIMBUS_EXECUTOR_SECRET", "");
    await expect(localBridgeKey("unused")).rejects.toThrow(
      "required in production",
    );
    vi.stubEnv("NIMBUS_EXECUTOR_SECRET", "b".repeat(64));
    expect(await localBridgeKey("unused")).toBe("b".repeat(64));
  });
  it("never sends a shared secret to insecure remote or credentialed URLs", () => {
    for (const value of [
      "http://remote.example",
      "https://user:password@remote.example",
      "https://remote.example/path",
      "https://remote.example/?secret=1",
    ]) {
      vi.stubEnv("NIMBUS_WEB_INTERNAL_URL", value);
      expect(() =>
        internalServiceUrl("NIMBUS_WEB_INTERNAL_URL", "http://127.0.0.1:3000"),
      ).toThrow();
    }
    vi.stubEnv("NIMBUS_WEB_INTERNAL_URL", "http://127.0.0.1:10000");
    expect(internalServiceUrl("NIMBUS_WEB_INTERNAL_URL", "unused")).toBe(
      "http://127.0.0.1:10000",
    );
  });
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
