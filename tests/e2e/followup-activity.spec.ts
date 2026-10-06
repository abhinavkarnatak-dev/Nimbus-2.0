import { expect, test } from "@playwright/test";

test("simulated follow-ups suppress repeated setup and stop finished thinking animations", async ({
  page,
}) => {
  let status = "running";
  const event = (
    sequence: number,
    category: string,
    title: string,
    text: string,
    state = "succeeded",
  ) => ({
    id: `followup-activity-${sequence}`,
    sequence,
    category,
    title,
    whatWasDone: text,
    whyItWasDone:
      "The session will reuse its existing workspace and Codex thread.",
    status: state,
    phase: "running",
    timestamp: "2026-10-06T01:21:00.000Z",
  });
  const events = [
    event(10001, "lifecycle", "Workspace ready", "Initial setup evidence"),
    event(10002, "agent_message", "Agent response", "First answer."),
    event(10003, "conversation", "Follow-up received", "Read HelloName.cpp"),
    event(
      10004,
      "lifecycle",
      "Workspace resume started",
      "Repeated resume evidence",
    ),
    event(10005, "lifecycle", "Workspace ready", "Repeated workspace evidence"),
    event(
      10006,
      "repository",
      "Repository checkout started",
      "Repeated checkout evidence",
    ),
    event(
      10007,
      "repository",
      "Repository ready",
      "Repeated repository evidence",
    ),
    event(
      10008,
      "agent_state",
      "Thinking",
      "Follow-up thinking evidence",
      "running",
    ),
  ];
  await page.route("**/api/tasks/*/events?*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body:
        `event: task_state\ndata: ${JSON.stringify({ status })}\n\n` +
        events
          .map(
            (event) =>
              `id: ${event.sequence}\nevent: task_event\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
    }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/tasks/task_b5226f5fb0ae4a9cae658f1e0a9feec4");
  const chat = page.locator(".conversation-scroll");
  await expect(
    chat.getByText("Initial setup evidence", { exact: true }),
  ).toHaveCount(1);
  await expect(
    chat.getByText(/Repeated (workspace|checkout|repository) evidence/),
  ).toHaveCount(0);
  await expect(
    chat
      .locator("details")
      .filter({ hasText: "Repeated resume evidence" })
      .locator("summary"),
  ).toContainText("Workspace resume started");
  const followup = chat
    .locator("article")
    .filter({ hasText: "Read HelloName.cpp" });
  await expect(followup).toHaveCount(1);
  await expect(followup.locator(".decision-note")).toHaveCount(0);
  const thinking = chat
    .locator("details")
    .filter({ hasText: "Follow-up thinking evidence" });
  await expect(thinking.locator("summary")).toContainText("In progress");
  await expect(thinking.locator("summary > span").first()).not.toHaveCSS(
    "animation-name",
    "none",
  );
  status = "completed";
  events.push({
    ...event(
      10009,
      "lifecycle",
      "Response finished",
      "Routine terminal evidence",
    ),
    timestamp: "2026-10-06T01:22:13.000Z",
  });
  await page.reload();
  await expect(thinking.locator("summary")).toContainText("1m 13s");
  await expect(thinking.locator("summary > span").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(
    chat.locator("details").filter({ hasText: "Response finished" }),
  ).toHaveCount(0);
  await expect(
    chat.getByText("Routine terminal evidence", { exact: true }),
  ).toHaveCount(0);
  await expect(
    chat.getByText(/Repeated (workspace|checkout|repository) evidence/),
  ).toHaveCount(0);
});
