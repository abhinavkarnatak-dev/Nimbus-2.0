import { describe, expect, it } from "vitest";
import {
  formatWorkDuration,
  workEventDuration,
  workEventTiming,
} from "./work-duration";
const event = (
  sequence: number,
  category: string,
  title: string,
  seconds: number,
  status = "succeeded",
) => ({
  id: `e${sequence}`,
  sequence,
  category,
  title,
  status,
  whatWasDone: "",
  timestamp: new Date(seconds * 1000).toISOString(),
});
describe("work durations", () => {
  it("ticks provisioning even when its start notification was recorded as succeeded", () => {
    const start = event(1, "lifecycle", "Workspace provisioning started", 10);
    expect(workEventTiming(start, [start], "provisioning", 22_000)).toEqual({
      running: true,
      durationMs: 12_000,
    });
    expect(workEventTiming(start, [start], "provisioning", 83_000)).toEqual({
      running: true,
      durationMs: 73_000,
    });
    const finish = event(2, "lifecycle", "Workspace ready", 62);
    expect(workEventTiming(start, [start, finish], "running", 100_000)).toEqual(
      { running: false, durationMs: 52_000 },
    );
  });
  it("ticks active commands, thinking, resume and checkout stages", () => {
    for (const entry of [
      event(1, "tool", "Running command", 10, "running"),
      event(1, "agent_state", "Thinking", 10, "running"),
      event(1, "lifecycle", "Workspace resume started", 10),
      event(1, "lifecycle", "Repository checkout started", 10),
    ]) {
      expect(workEventTiming(entry, [entry], "running", 23_000)).toEqual({
        running: true,
        durationMs: 13_000,
      });
    }
  });
  it("never ticks finished sessions, old turns or one-off recorded notifications", () => {
    const start = event(1, "lifecycle", "Workspace provisioning started", 10);
    for (const status of [
      "completed",
      "failed",
      "cancelled",
      "pr_open",
      "paused",
      "awaiting_user",
    ])
      expect(workEventTiming(start, [start], status, 99_000).running).toBe(
        false,
      );
    expect(
      workEventTiming(
        start,
        [start, event(2, "conversation", "Follow-up", 30)],
        "running",
        99_000,
      ).running,
    ).toBe(false);
    const recorded = event(1, "lifecycle", "Pull request ready", 10);
    expect(workEventTiming(recorded, [recorded], "running", 99_000)).toEqual({
      running: false,
      durationMs: null,
    });
  });
  it("formats seconds and minute boundaries", () => {
    expect(
      [0, 200, 59000, 60000, 73000, 125000].map(formatWorkDuration),
    ).toEqual(["0s", "<1s", "59s", "1m 0s", "1m 13s", "2m 5s"]);
  });
  it("pairs command events even though the displayed event is replaced by completion", () => {
    const start = {
      ...event(1, "tool", "Running command", 10, "running"),
      evidence: ["codex-item:a"],
    };
    const finish = {
      ...event(3, "tool", "Command passed", 83),
      evidence: ["codex-item:a"],
    };
    expect(
      workEventDuration(finish, [
        start,
        event(2, "protocol", "Codex activity", 50),
        finish,
      ]),
    ).toBe(73000);
  });
  it("times thinking until the next non-protocol event, not a later page reload", () => {
    const thinking = event(1, "agent_state", "Thinking", 10, "running");
    expect(
      workEventDuration(thinking, [
        thinking,
        event(2, "protocol", "Codex activity", 11),
        event(3, "tool", "Running command", 22),
      ]),
    ).toBe(12000);
  });
  it("pairs initial provisioning and resumed readiness independently", () => {
    const source = [
      event(1, "lifecycle", "Workspace provisioning started", 10),
      event(2, "lifecycle", "Workspace ready", 15),
      event(3, "conversation", "Follow-up", 100),
      event(4, "lifecycle", "Workspace resume started", 101),
      event(5, "lifecycle", "Workspace ready", 104),
    ];
    expect(workEventDuration(source[0]!, source)).toBe(5000);
    expect(workEventDuration(source[4]!, source)).toBe(3000);
  });
  it("does not invent missing durations or cross a follow-up during provisioning", () => {
    const thinking = event(1, "agent_state", "Thinking", 10, "running");
    expect(
      workEventDuration(thinking, [
        thinking,
        event(2, "conversation", "Follow-up", 3600),
      ]),
    ).toBeNull();
    const start = event(1, "lifecycle", "Workspace provisioning started", 10);
    expect(
      workEventDuration(start, [
        start,
        event(2, "conversation", "Follow-up", 100),
        event(3, "lifecycle", "Workspace ready", 105),
      ]),
    ).toBeNull();
    expect(
      workEventDuration(event(1, "tool", "Command passed", 1), []),
    ).toBeNull();
  });
});
