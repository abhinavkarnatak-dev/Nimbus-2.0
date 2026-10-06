import { describe, expect, it } from "vitest";
import { prCardData } from "./pr-card";
import { conversationEvents } from "./conversation-events";
const data = {
  title: "Add greeting",
  repository: "test/repo",
  number: 16,
  url: "https://github.com/test/repo/pull/16",
  additions: 2,
  deletions: 1,
  changedFiles: 1,
  files: [{ path: "hello.py", additions: 2, deletions: 1 }],
};
describe("PR chat card", () => {
  it("reads a confirmed structured summary including zero counts", () => {
    expect(prCardData([`pr-card:${JSON.stringify(data)}`])).toEqual(data);
    expect(
      prCardData([`pr-card:${JSON.stringify({ ...data, additions: 0 })}`])
        ?.additions,
    ).toBe(0);
  });
  it("rejects unsafe links, malformed metadata and fabricated counts", () => {
    for (const value of [
      { ...data, url: "javascript:alert(1)" },
      { ...data, additions: -1 },
      { ...data, files: [{}] },
    ])
      expect(prCardData([`pr-card:${JSON.stringify(value)}`])).toBeNull();
    expect(prCardData(["pr-card:not json"])).toBeNull();
  });
  it("preserves a standalone card, hides only its duplicate confirmation, and leaves agent replies alone", () => {
    const event = {
      id: "1",
      sequence: 1,
      category: "agent_message",
      title: "Agent response",
      whatWasDone: "Done",
      evidence: ["codex-item:reply"],
    };
    const card = {
      ...event,
      id: "2",
      sequence: 2,
      title: "Pull request ready",
      evidence: [`pr-card:${JSON.stringify(data)}`],
    };
    const duplicate = {
      ...event,
      id: "3",
      sequence: 3,
      whatWasDone: `Pull request ready: [#16](${data.url})`,
      evidence: ["codex-item:nimbus-pr-turn"],
    };
    expect(conversationEvents([event, card, duplicate])).toHaveLength(2);
    expect(conversationEvents([duplicate])).toHaveLength(1);
  });
});
