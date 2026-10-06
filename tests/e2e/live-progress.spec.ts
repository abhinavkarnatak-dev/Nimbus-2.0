import { expect, test } from "@playwright/test";

test.use({ timezoneId: "Asia/Kolkata" });
test("simulated live events show compact commands, whole replies, and local time", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  const event = (
    sequence: number,
    category: string,
    title: string,
    text: string,
    item: string,
  ) => ({
    id: `test-${sequence}`,
    sequence,
    timestamp: "2026-10-06T01:21:00.000Z",
    category,
    phase: "running",
    status: "running",
    title,
    whatWasDone: text,
    whyItWasDone: "",
    evidence: [`codex-item:${item}`],
  });
  const events = [
    event(10001, "tool", "Running command", "git status --short", "command"),
    event(
      10002,
      "agent_message",
      "Agent response",
      "This repository ",
      "reply",
    ),
    event(
      10003,
      "agent_message",
      "Agent response",
      "tests pull request workflows.",
      "reply",
    ),
    event(
      10004,
      "agent_state",
      "Thinking",
      "Codex is deciding its next action.",
      "thinking",
    ),
  ];
  await page.route("**/api/tasks/*/events?*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body:
        'event: task_state\ndata: {"status":"running"}\n\n' +
        events
          .map(
            (event) =>
              `id: ${event.sequence}\nevent: task_event\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
    }),
  );
  await page.goto("/tasks/task_b5226f5fb0ae4a9cae658f1e0a9feec4");
  const chat = page.locator(".conversation-scroll");
  await expect(
    chat.getByText("This repository tests pull request workflows.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    chat.locator('time[datetime="2026-10-06T01:21:00.000Z"]').first(),
  ).toBeVisible();
  await expect(
    chat.locator('time[datetime="2026-10-06T01:21:00.000Z"]').first(),
  ).toHaveText("06:51 am");
  await expect(chat.locator("time").filter({ hasText: /UTC|IST/ })).toHaveCount(
    0,
  );
  await expect(
    page.locator(".presence-heading").getByText("Thinking", { exact: true }),
  ).toBeVisible();
  const command = chat
    .locator("details")
    .filter({ hasText: "Running command" });
  await expect(command).toHaveCount(1);
  await command.locator("summary").click();
  await expect(command.locator("pre")).toHaveText("git status --short");
});
