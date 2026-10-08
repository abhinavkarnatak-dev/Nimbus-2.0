import React from "react";
import { webActivityEvent } from "@nimbus/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/use-codex-availability", () => ({
  useCodexModels: () => [
    {
      id: "model",
      label: "Model",
      isDefault: true,
      supportedReasoningEfforts: [
        { reasoningEffort: "medium" },
        { reasoningEffort: "high" },
      ],
    },
    { id: "other", label: "Other", isDefault: false },
  ],
}));
vi.mock("../../skill-prompt", () => ({
  SkillPrompt: () => React.createElement("textarea"),
}));
import { LiveAgentWorkspace } from "./live-agent-workspace";
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
  phase: "running",
  whatWasDone: `detail ${sequence}`,
  whyItWasDone: "",
  timestamp: new Date(sequence * 1000).toISOString(),
});
const props = {
  taskId: "task",
  createdAt: new Date(0).toISOString(),
  finishedAt: null,
  objective: "Hello",
  model: "model",
  reasoningEffort: "high",
  initialStatus: "completed",
  initialEvents: [],
  workbench: null,
};
beforeEach(() => vi.stubGlobal("React", React));
describe("inline chat progress", () => {
  it("offers model selection after completion and locks it during active work", () => {
    const idle = renderToStaticMarkup(<LiveAgentWorkspace {...props} />);
    expect(idle).toContain('aria-label="Follow-up model"');
    expect(idle).toContain('value="other"');
    expect(idle.match(/<select[^>]*>/)?.[0]).not.toContain("disabled");
    expect(idle).toContain('aria-label="Follow-up thinking effort"');
    expect(idle).toContain('type="range"');
    expect(idle).toContain('aria-valuetext="high"');
    expect(idle.match(/<select[^>]*>/g)).toHaveLength(1);
    expect(idle).toContain('aria-label="Follow-up model and thinking effort"');
    for (const initialStatus of [
      "queued",
      "provisioning",
      "running",
      "cancelling",
    ]) {
      const busy = renderToStaticMarkup(
        <LiveAgentWorkspace {...props} initialStatus={initialStatus} />,
      );
      expect(busy.match(/<select[^>]*>/)?.[0]).toContain("disabled");
      expect(busy.match(/<input[^>]*type="range"[^>]*>/)?.[0]).toContain(
        "disabled",
      );
    }
  });
  it("shows the actual website during search and retains results and search detail after completion", () => {
    const payload = {
      item: {
        type: "webSearch",
        id: "search",
        action: { type: "search", query: "site:linkedin.com/jobs internships" },
      },
    };
    const start = {
      ...event(2, "tool", ""),
      ...webActivityEvent("item/started", payload)!,
    };
    const active = renderToStaticMarkup(
      <LiveAgentWorkspace
        {...props}
        initialStatus="running"
        initialEvents={[event(1, "conversation", "Prompt"), start]}
      />,
    );
    expect(active).toContain("Searching LinkedIn");
    expect(active).toContain("Web research");
    expect(active).not.toContain("Commands");
    const end = {
      ...event(3, "tool", ""),
      ...webActivityEvent("item/completed", payload)!,
    };
    const reply = {
      ...event(4, "agent_message", "Reply"),
      whatWasDone: "[Job posting](https://www.linkedin.com/jobs/view/123)",
    };
    const completed = renderToStaticMarkup(
      <LiveAgentWorkspace
        {...props}
        initialEvents={[event(1, "conversation", "Prompt"), start, end, reply]}
      />,
    );
    expect(completed).toContain("Searched LinkedIn");
    expect(completed).toContain("site:linkedin.com/jobs internships");
    expect(completed).toContain(
      'href="https://www.linkedin.com/jobs/view/123"',
    );
    expect(completed).not.toContain("Searching LinkedIn");
  });
  it("renders grouped unboxed progress, flags failures, and keeps the permanent note", () => {
    const html = renderToStaticMarkup(
      <LiveAgentWorkspace
        {...props}
        initialEvents={[
          event(1, "conversation", "Prompt"),
          event(2, "agent_state", "Thinking"),
          event(3, "tool", "Command failed", "failed"),
          event(4, "agent_state", "Thinking"),
          event(5, "tool", "Command passed"),
          event(6, "agent_message", "Reply"),
        ]}
      />,
    );
    expect(html).not.toContain("Work log");
    expect(html).toContain("Worked for 4s");
    expect(html).toContain("Thinking (2)");
    expect(html).toContain("Commands (2)");
    expect(html).toContain("1 action failed");
    expect(html).toContain("detail 3");
    expect(html).toContain("Nimbus can make mistakes. Check important info.");
  });
  it("shows immediate feedback for a queued chat even without executor events", () => {
    const html = renderToStaticMarkup(
      <LiveAgentWorkspace {...props} initialStatus="queued" />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Thinking");
    expect(html).not.toContain("Worked for");
  });
});
