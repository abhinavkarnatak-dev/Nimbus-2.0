import { expect, test } from "@playwright/test";
test("open finished sessions show Idle in task, live presence, History and Dashboard", async ({
  page,
}) => {
  await page.route("**/api/tasks/*/events?*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'event: task_state\ndata: {"status":"completed"}\n\n',
    }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await expect(page.locator(".run-row .state-idle").first()).toHaveText("Idle");
  await page.goto("/tasks");
  const session = page.locator(
    'tr[data-task-id="task_demo_01J00000000000000000001"]',
  );
  await expect(session.locator(".state-idle")).toHaveText("Idle");
  await session.locator(".task-title").click();
  await expect(page.locator(".agent-header .state-idle")).toHaveText("Idle");
  await expect(page.locator(".agent-header-actions button")).toHaveCount(0);
  const badge = page.locator(".agent-header .state-chip");
  // Exercise CSS state transitions without mutating the persisted fixture.
  for (const state of ["failed", "running", "idle"]) {
    const colors = await badge.evaluate((element, value) => {
      element.className = `state-chip state-${value}`;
      const dot = element.querySelector(".live-dot")!;
      return {
        text: getComputedStyle(element).color,
        dot: getComputedStyle(dot).backgroundColor,
        shadow: getComputedStyle(dot).boxShadow,
      };
    }, state);
    expect(colors.dot).toBe(colors.text);
    expect(colors.shadow).toBe("none");
    if (state === "failed") expect(colors.dot).toBe("rgb(185, 71, 71)");
  }
  await expect(page.locator(".presence-heading strong")).toHaveText(
    "Idle - ready for follow-up",
  );
  await expect(
    page.locator(".presence-facts").getByText("Idle", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Follow-up message" }),
  ).toBeEnabled();
});
