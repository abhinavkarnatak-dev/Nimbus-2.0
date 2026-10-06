import { expect, test } from "@playwright/test";

test("provisioning shows live seconds and freezes at the confirmed duration", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const current = new Date("2026-10-06T10:00:10Z");
  let completed = false;
  const start = {
    id: "live-provision",
    sequence: 10001,
    timestamp: "2026-10-06T10:00:00Z",
    category: "lifecycle",
    phase: "provisioning",
    status: "succeeded",
    title: "Workspace provisioning started",
    whatWasDone: "Starting the workspace.",
    whyItWasDone: "",
  };
  await page.route("**/api/tasks/*/events?*", (route) => {
    const events = completed
      ? [
          start,
          {
            ...start,
            id: "ready",
            sequence: 10002,
            timestamp: "2026-10-06T10:00:52Z",
            phase: "running",
            title: "Workspace ready",
          },
        ]
      : [start];
    return route.fulfill({
      contentType: "text/event-stream",
      body:
        `event: task_state\ndata: ${JSON.stringify({ status: completed ? "completed" : "provisioning" })}\n\n` +
        events
          .map(
            (event) =>
              `id: ${event.sequence}\nevent: task_event\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
    });
  });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/tasks/task_demo_01J00000000000000000001", {
    waitUntil: "domcontentloaded",
  });
  await page.clock.install({ time: current });
  const row = page
    .locator(".conversation-scroll details")
    .filter({ hasText: "Workspace provisioning started" })
    .last()
    .locator("summary");
  await expect(row).toBeVisible();
  await expect(
    page.getByText("Follow-ups are queued without interrupting this run.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.clock.pauseAt(new Date("2026-10-06T10:01:10Z"));
  await page.clock.runFor(1000);
  await expect(row).toContainText("Working (1m 11s)");
  await expect(row).not.toContainText("Recorded");
  await page.clock.runFor(2000);
  await expect(row).toContainText("Working (1m 13s)");
  completed = true;
  await page.reload();
  await expect(row).toContainText("Worked for 52s");
  await page.clock.runFor(3000);
  await expect(row).toContainText("Worked for 52s");
});
