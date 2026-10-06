import { expect, test } from "@playwright/test";
test("session uses a 50/50 desktop split without Plan, stacks on mobile and expands when workbench closes", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/tasks/task_demo_01J00000000000000000001");
  await expect(
    page
      .locator(".workbench-tabs")
      .getByRole("link", { name: "Plan", exact: true }),
  ).toHaveCount(0);
  await page.goto("/tasks/task_demo_01J00000000000000000001?tab=plan");
  await expect(page.locator(".workbench-tabs a.active")).toHaveText("Activity");
  await expect(
    page.getByText("No formal plan yet", { exact: true }),
  ).toHaveCount(0);
  for (const width of [1600, 1280, 1000, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page
      .locator(".agent-workspace")
      .evaluate((element) => {
        const workspace = element.getBoundingClientRect();
        const chat = element
          .querySelector(".conversation-pane")!
          .getBoundingClientRect();
        const workbench = element
          .querySelector(".workbench-shell")!
          .getBoundingClientRect();
        return {
          width: workspace.width,
          chat: chat.width,
          workbench: workbench.width,
          chatBottom: chat.bottom,
          workbenchTop: workbench.top,
        };
      });
    if (width > 780) {
      expect(Math.abs(dimensions.chat / dimensions.width - 0.5)).toBeLessThan(
        0.002,
      );
      expect(
        Math.abs(dimensions.workbench / dimensions.width - 0.5),
      ).toBeLessThan(0.002);
    } else {
      expect(Math.abs(dimensions.chat - dimensions.width)).toBeLessThan(1);
      expect(dimensions.workbenchTop).toBeGreaterThanOrEqual(
        dimensions.chatBottom,
      );
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Close task workbench" }).click();
  expect(
    await page
      .locator(".agent-workspace")
      .evaluate((element) =>
        Math.abs(
          element.getBoundingClientRect().width -
            element.querySelector(".conversation-pane")!.getBoundingClientRect()
              .width,
        ),
      ),
  ).toBeLessThan(1);
  await page.getByRole("button", { name: "Open task workbench" }).click();
  await expect(page.locator(".workbench-shell")).toBeVisible();
});
