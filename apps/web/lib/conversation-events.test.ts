import { describe, expect, it } from "vitest";
import {
  conversationEntries,
  activityEvents,
  conversationEvents,
  isWorkEventRunning,
  type ConversationEvent,
} from "./conversation-events";
const event = (sequence: number, category: string, text = "update") => ({
  id: `event-${sequence}`,
  sequence,
  category,
  title: category,
  whatWasDone: text,
});
describe("conversation event presentation", () => {
  it.each(["Sandbox paused", "Nimbus in sleep mode", "Nimbus is sleeping 💤"])(
    "places %s outside work logs",
    (title) => {
      const entries = conversationEntries(
        conversationEvents([
          event(1, "tool"),
          { ...event(2, "lifecycle"), title },
          event(3, "agent_message", "Hello again"),
        ]),
      );
      expect(entries.map((entry) => entry.kind)).toEqual([
        "work",
        "notice",
        "message",
      ]);
      const notice = entries[1];
      expect(notice && notice.kind !== "work" && notice.event.title).toBe(
        "Nimbus is sleeping 💤",
      );
    },
  );
  it("keeps an interrupted partial reply together and shows just one final stop event", () => {
    const events = [
      { ...event(1, "agent_message", "H"), evidence: ["codex-item:reply"] },
      { ...event(2, "lifecycle"), title: "Stopping request" },
      {
        ...event(3, "agent_message", "aan bhai"),
        evidence: ["codex-item:reply"],
      },
      { ...event(4, "lifecycle"), title: "Request stopped" },
    ];
    const presented = conversationEvents(events);
    expect(presented.map((e) => e.whatWasDone)).toEqual([
      "Haan bhai",
      "update",
    ]);
    expect(presented.map((e) => e.title)).not.toContain("Stopping request");
    expect(events).toHaveLength(4);
  });
  it("Activity omits thinking and repeated setup but preserves resume, commands and failures", () => {
    const events = [
      { ...event(1, "lifecycle"), title: "Workspace provisioning started" },
      { ...event(2, "lifecycle"), title: "Workspace ready" },
      { ...event(3, "repository"), title: "Repository checkout started" },
      { ...event(4, "repository"), title: "Repository ready" },
      { ...event(5, "agent_state"), title: "Thinking" },
      event(6, "tool"),
      { ...event(7, "lifecycle"), title: "Workspace resume started" },
      { ...event(8, "lifecycle"), title: "Workspace ready" },
      { ...event(9, "repository"), title: "Repository checkout started" },
      { ...event(10, "repository"), title: "Repository ready" },
      { ...event(11, "agent_state"), title: "Thinking" },
      {
        ...event(12, "repository"),
        title: "Repository ready",
        status: "failed",
      },
      { ...event(13, "agent_state"), title: "Thinking", status: "failed" },
      event(14, "recovery"),
      { ...event(15, "lifecycle"), title: "Workspace resume started" },
    ];
    expect(activityEvents(events).map((entry) => entry.sequence)).toEqual([
      1, 2, 3, 4, 6, 7, 12, 13, 14, 15,
    ]);
    expect(
      conversationEvents(events).filter((entry) => entry.title === "Thinking"),
    ).toHaveLength(3);
    expect(events).toHaveLength(15);
  });
  it("brands known thinking and command rationale copy without rewriting audit or replies", () => {
    const thinking = event(
      1,
      "agent_state",
      "Codex is deciding its next action.",
    );
    const command = {
      ...event(2, "tool", "echo Codex"),
      whyItWasDone:
        "Codex ran this command to investigate or verify the requested outcome.",
    };
    const reply = event(
      3,
      "agent_message",
      "Codex is deciding its next action.",
    );
    const result = conversationEvents<ConversationEvent>([
      thinking,
      command,
      reply,
    ]);
    expect(result[0]?.whatWasDone).toBe("Nimbus is deciding its next action.");
    expect(result[1]?.whatWasDone).toBe("echo Codex");
    expect(result[1]?.whyItWasDone).toBe(
      "Nimbus ran this command to investigate or verify the requested outcome.",
    );
    expect(result[2]?.whatWasDone).toBe(reply.whatWasDone);
    expect(thinking.whatWasDone).toBe("Codex is deciding its next action.");
    expect(command.whyItWasDone).toContain("Codex");
  });
  it("omits routine terminal chat blocks without hiding failures or changing audit events", () => {
    const events = [
      event(1, "agent_message", "Answer"),
      {
        ...event(2, "lifecycle"),
        title: "Response finished",
        status: "succeeded",
      },
      { ...event(3, "lifecycle"), title: "Run completed", status: "succeeded" },
      {
        ...event(4, "lifecycle"),
        title: "Response finished",
        status: "failed",
      },
    ];
    expect(
      conversationEntries(events).flatMap((entry) =>
        entry.kind !== "work"
          ? [entry.event.sequence]
          : entry.events.map((event) => event.sequence),
      ),
    ).toEqual([1, 4]);
    expect(events).toHaveLength(4);
  });
  it("shows startup once and keeps follow-up work and recovery visible", () => {
    const events = [
      { ...event(1, "lifecycle"), title: "Workspace ready" },
      event(2, "agent_message"),
      event(3, "conversation"),
      { ...event(4, "lifecycle"), title: "Workspace resume started" },
      { ...event(5, "lifecycle"), title: "Workspace ready" },
      { ...event(6, "repository"), title: "Repository checkout started" },
      { ...event(7, "repository"), title: "Repository ready" },
      event(8, "tool"),
      event(9, "recovery"),
      event(10, "agent_message"),
      {
        ...event(11, "repository"),
        title: "Repository ready",
        status: "failed",
      },
    ];
    expect(
      conversationEntries(events).flatMap((entry) =>
        entry.kind !== "work"
          ? [entry.event.sequence]
          : entry.events.map((event) => event.sequence),
      ),
    ).toEqual([1, 2, 3, 4, 8, 9, 10, 11]);
    expect(events).toHaveLength(11);
  });
  it("stops completed, superseded, and previous-turn activity animations", () => {
    const thinking = { ...event(1, "agent_state"), status: "running" };
    expect(isWorkEventRunning(thinking, [thinking], "running")).toBe(true);
    expect(isWorkEventRunning(thinking, [thinking], "completed")).toBe(false);
    expect(
      isWorkEventRunning(
        { ...thinking, status: "succeeded" },
        [thinking],
        "running",
      ),
    ).toBe(false);
    expect(
      isWorkEventRunning(thinking, [thinking, event(2, "tool")], "running"),
    ).toBe(false);
    expect(
      isWorkEventRunning(thinking, [thinking, event(2, "protocol")], "running"),
    ).toBe(true);
    expect(
      isWorkEventRunning(
        thinking,
        [thinking, { ...event(2, "lifecycle"), phase: "completed" }],
        "running",
      ),
    ).toBe(false);
    expect(
      isWorkEventRunning(
        thinking,
        [thinking, event(2, "conversation")],
        "running",
      ),
    ).toBe(false);
  });
  it("groups adjacent lifecycle and tool activity without grouping actual replies or user turns", () => {
    const events = [
      event(1, "lifecycle"),
      event(2, "repository"),
      event(3, "agent_message", "Inspecting"),
      event(4, "tool"),
      event(5, "agent_state"),
      event(6, "agent_message", "Report"),
      event(7, "conversation"),
    ];
    const groups = conversationEntries(events);
    expect(groups.map((group) => group.kind)).toEqual([
      "work",
      "message",
      "work",
      "message",
      "message",
    ]);
    expect(groups[0]).toEqual({ kind: "work", events: events.slice(0, 2) });
    expect(events).toHaveLength(7);
  });
  it("updates a command in place rather than duplicating start and completion", () => {
    const result = conversationEvents([
      { ...event(1, "tool", "git status"), evidence: ["codex-item:command-a"] },
      event(2, "agent_message", "Reviewing"),
      {
        ...event(3, "tool", "git status\nExit code: 0"),
        evidence: ["codex-item:command-a"],
      },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.whatWasDone).toBe("git status\nExit code: 0");
  });
  it("hides both new and previously persisted protocol chatter", () => {
    expect(
      conversationEvents([
        event(1, "protocol"),
        { ...event(2, "lifecycle"), title: "Codex activity" },
        event(3, "recovery"),
      ]),
    ).toEqual([event(3, "recovery")]);
  });
  it("groups message deltas while retaining distinct user turns and failures", () => {
    const events = [
      event(1, "agent_message", "Hello"),
      event(2, "protocol"),
      event(3, "agent_message", " world"),
      event(4, "conversation"),
      event(5, "agent_message", "Next"),
      event(6, "lifecycle", "Failed"),
    ];
    expect(
      conversationEvents(events).map((event) => event.whatWasDone),
    ).toEqual(["Hello world", "update", "Next", "Failed"]);
    expect(events[0]?.whatWasDone).toBe("Hello");
  });
  it("deduplicates replay by event ID and preserves sequence order", () => {
    expect(
      conversationEvents([
        event(2, "agent_message", "B"),
        event(1, "agent_message", "A"),
        event(1, "agent_message", "A"),
      ])[0]?.whatWasDone,
    ).toBe("AB");
  });
  it("keeps distinct Codex messages separate despite interleaved protocol events", () => {
    expect(
      conversationEvents([
        {
          ...event(1, "agent_message", "Inspecting"),
          evidence: ["codex-item:a"],
        },
        event(2, "protocol"),
        {
          ...event(3, "agent_message", " the repo"),
          evidence: ["codex-item:a"],
        },
        {
          ...event(4, "agent_message", "The repository contains"),
          evidence: ["codex-item:b"],
        },
      ]).map((item) => item.whatWasDone),
    ).toEqual(["Inspecting the repo", "The repository contains"]);
  });
  it("does not present legacy terminal status as verified completion", () => {
    const result = conversationEvents([
      { ...event(1, "lifecycle"), title: "Run completed" },
    ]);
    expect(result[0]?.title).toBe("Response finished");
    expect(result[0]?.whatWasDone).toContain("not confirmation");
  });
});
