import { describe, expect, it } from "vitest";
import { isWebActivity, webActivityEvent } from "@nimbus/shared";
import { conversationEvents } from "./conversation-events";
import {
  groupedActivityEvents,
  needsPendingProgress,
  workGroups,
  workSummary,
} from "./progress-presentation";
const event = (
  sequence: number,
  category: string,
  title: string,
  status = "succeeded",
) => ({
  id: `e${sequence}`,
  sequence,
  category,
  title,
  status,
  whatWasDone: `detail ${sequence}`,
  evidence: [] as string[],
  timestamp: new Date(sequence * 1000).toISOString(),
});
describe("compact progress presentation", () => {
  it("projects real web lifecycle events into one research group, separate from commands", () => {
    const payload = {
      item: {
        type: "webSearch",
        id: "search",
        action: { type: "search", query: "site:linkedin.com jobs" },
      },
    };
    const start = {
      ...event(1, "tool", ""),
      ...webActivityEvent("item/started", payload)!,
    };
    const end = {
      ...event(2, "tool", ""),
      ...webActivityEvent("item/completed", payload)!,
    };
    const raw = [
      start,
      end,
      event(3, "tool", "Command passed"),
      event(4, "agent_message", "Reply"),
    ];
    const projected = conversationEvents(raw);
    expect(projected.filter(isWebActivity)).toHaveLength(1);
    expect(
      workGroups(projected.filter((item) => item.category === "tool")).map(
        (group) => group.label,
      ),
    ).toEqual(["Web research", "Commands"]);
    expect(workSummary([start], [start], "running", 10000).label).toBe(
      "Searching LinkedIn",
    );
    expect(workSummary([end], raw, "completed", 10000).webLabel).toBe(
      "Searched LinkedIn",
    );
    expect(projected.at(-1)!.whatWasDone).toBe(raw.at(-1)!.whatWasDone);
  });
  it("groups alternating thinking and commands, retaining failures and every detail", () => {
    const events = [
      event(1, "agent_state", "Thinking"),
      event(2, "tool", "Command failed", "failed"),
      event(3, "agent_state", "Thinking"),
      event(4, "tool", "Command passed"),
    ];
    const groups = workGroups(events);
    expect(groups.map((group) => group.label)).toEqual([
      "Thinking",
      "Commands",
    ]);
    expect(groups[1]!.events).toEqual([events[1], events[3]]);
    expect(
      workSummary(
        events,
        [...events, event(5, "agent_message", "Reply")],
        "completed",
        100000,
      ),
    ).toMatchObject({ active: false, durationMs: 4000, failures: 1 });
  });
  it("uses original command start timestamps and never double-counts overlapping work", () => {
    const start = {
      ...event(1, "tool", "Running command", "running"),
      evidence: ["codex-item:cmd"],
    };
    const end = {
      ...event(5, "tool", "Command passed"),
      evidence: ["codex-item:cmd"],
    };
    const thinking = event(2, "agent_state", "Thinking");
    expect(
      workSummary(
        [thinking, end],
        [start, thinking, end, event(6, "agent_message", "Reply")],
        "completed",
        99000,
      ).durationMs,
    ).toBe(5000);
  });
  it("does not count the time until the next user message as working", () => {
    const work = event(1, "tool", "Command passed");
    expect(
      workSummary(
        [work],
        [work, event(500, "conversation", "Follow-up")],
        "running",
        999000,
      ),
    ).toMatchObject({ active: false, durationMs: 0 });
  });
  it("groups repository reads within a turn but not across user turns or failures", () => {
    const events = [
      event(1, "repository", "Repository inspected"),
      event(2, "repository", "Repository inspected"),
      event(3, "conversation", "Follow-up"),
      event(4, "repository", "Repository inspected"),
      event(5, "repository", "Repository inspected", "failed"),
      event(6, "repository", "Repository inspected"),
    ];
    const before = JSON.stringify(events);
    const groups = groupedActivityEvents(events);
    expect(groups).toHaveLength(5);
    expect(groups[0]!.title).toBe("Repository inspected (2 actions)");
    expect(groups[0]!.whatWasDone).toContain("detail 2");
    expect(groups[3]!.status).toBe("failed");
    expect(JSON.stringify(events)).toBe(before);
  });
  it("shows local progress before acknowledgement and hands off to real events", () => {
    const old = event(1, "agent_message", "Reply");
    expect(needsPendingProgress([old], "completed", 1)).toBe(true);
    expect(
      needsPendingProgress(
        [old, event(2, "conversation", "Follow-up")],
        "queued",
        1,
      ),
    ).toBe(true);
    expect(
      needsPendingProgress(
        [
          old,
          event(2, "conversation", "Follow-up"),
          event(3, "agent_state", "Thinking", "running"),
        ],
        "running",
        1,
      ),
    ).toBe(false);
    expect(needsPendingProgress([old], "completed", null)).toBe(false);
    expect(needsPendingProgress([], "queued", null)).toBe(true);
  });
  it("animates only current work, never historical chunks", () => {
    const work = event(1, "agent_state", "Thinking", "running");
    expect(workSummary([work], [work], "running", 10000)).toMatchObject({
      active: true,
      label: "Thinking",
      durationMs: 9000,
    });
    expect(
      workSummary(
        [work],
        [work, event(2, "agent_message", "Reply")],
        "running",
        10000,
      ).active,
    ).toBe(false);
  });
});
