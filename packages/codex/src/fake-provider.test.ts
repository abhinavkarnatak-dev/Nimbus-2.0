import { describe, expect, it } from "vitest";

import { FakeCodingAgentProvider, requireProductionProvider } from "./index.js";

describe("FakeCodingAgentProvider", () => {
  it("produces a deterministic officially-terminal-style completion", async () => {
    const provider = new FakeCodingAgentProvider();
    await provider.start();
    const threadId = await provider.startThread({
      workspacePath: "/workspace",
      model: "fake-codex-test-provider",
    });
    const events = [];
    for await (const event of provider.runTurn({ threadId, prompt: "Fix it" }))
      events.push(event);
    expect(events.at(-1)).toEqual({
      type: "turn_completed",
      turnId: "fake_turn_1",
      status: "completed",
    });
  });

  it("cannot be enabled in production", () => {
    expect(() =>
      requireProductionProvider(new FakeCodingAgentProvider(), "production"),
    ).toThrow("forbidden in production");
  });
});
