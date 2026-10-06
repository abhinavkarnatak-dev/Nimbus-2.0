import { expect, test } from "@playwright/test";

test("simulated incremental replies display Markdown and partial code before completion", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const streams: EventTarget[] = [];
    class TestEventSource extends EventTarget {
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor() {
        super();
        streams.push(this);
        queueMicrotask(() => this.onopen?.(new Event("open")));
      }
      close() {
        streams.splice(streams.indexOf(this), 1);
      }
    }
    Object.defineProperty(window, "EventSource", { value: TestEventSource });
    Object.defineProperty(window, "testStreamCount", {
      get: () => streams.length,
    });
    Object.defineProperty(window, "emitTestStream", {
      value: (type: string, data: unknown) => {
        for (const stream of streams)
          stream.dispatchEvent(
            new MessageEvent(type, { data: JSON.stringify(data) }),
          );
      },
    });
  });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/tasks/task_b5226f5fb0ae4a9cae658f1e0a9feec4");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { testStreamCount: number }).testStreamCount,
      ),
    )
    .toBeGreaterThan(0);
  const emit = (type: string, data: unknown) =>
    page.evaluate(
      ({ type, data }) => {
        (
          window as unknown as {
            emitTestStream: (type: string, data: unknown) => void;
          }
        ).emitTestStream(type, data);
      },
      { type, data },
    );
  const delta = (sequence: number, text: string) => ({
    id: `progressive-${sequence}`,
    sequence,
    category: "agent_message",
    title: "Agent response",
    whatWasDone: text,
    whyItWasDone: "",
    status: "running",
    phase: "running",
    timestamp: "2026-10-06T01:21:00.000Z",
    evidence: ["codex-item:progressive"],
  });
  await emit("task_state", { status: "running" });
  await emit(
    "task_event",
    delta(10001, "## Progressive report\n\nFirst findings."),
  );
  const reply = page
    .locator(".conversation-scroll [data-markdown-message]")
    .filter({ hasText: "Progressive report" });
  await expect(
    reply.getByRole("heading", { name: "Progressive report" }),
  ).toBeVisible();
  await expect(reply).toContainText("First findings.");
  await expect(reply.locator("pre")).toHaveCount(0);
  await emit("task_event", delta(10002, "\n\n```cpp\nint main() {"));
  await expect(reply.locator("pre code")).toHaveText("int main() {");
  await expect(reply).not.toContainText("return 0");
  await emit(
    "task_event",
    delta(10003, "\n  return 0;\n}\n```\n\nReport complete."),
  );
  await expect(reply.locator("pre code")).toContainText("return 0;");
  await expect(reply).toContainText("Report complete.");
  await expect(reply).toHaveCount(1);
  await emit("task_state", { status: "completed" });
  const activity = page.locator(".activity-feed details").first();
  await expect(activity).not.toHaveAttribute("open", "");
  await expect(activity.locator("p").first()).not.toBeVisible();
  await activity.locator("summary").click();
  await expect(activity.locator("p").first()).toBeVisible();
  await activity.locator("summary").click();
  await expect(activity.locator("p").first()).not.toBeVisible();
});
