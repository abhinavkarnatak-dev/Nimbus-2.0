import { expect, test } from "@playwright/test";

test("Dashboard is the launch page, has no top bar, and sidebar shows limit warnings", async ({
  page,
}, testInfo) => {
  let usedPercent = 100;
  let status = "available";
  await page.route("**/api/codex/usage", (route) =>
    route.fulfill({
      json: {
        status,
        limits: [
          {
            id: "codex",
            name: "Codex",
            planType: null,
            reachedType: null,
            credits: null,
            secondary: null,
            primary: { usedPercent, windowDurationMins: 300, resetsAt: null },
          },
        ],
      },
    }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await expect(page.locator(".app-topbar")).toHaveCount(0);
  const header = page.locator(".app-sidebar");
  await expect(
    header.getByRole("link", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(
    header.getByRole("link", { name: "History", exact: true }),
  ).toBeVisible();
  await expect(
    header.getByRole("link", { name: "New agent run", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start", exact: true }),
  ).toBeVisible();
  await expect(
    header.getByRole("link", { name: "Codex limit reached", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("header-limit-warning.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await header
    .getByRole("link", { name: "Codex limit reached", exact: true })
    .click();
  await expect(page).toHaveURL(/\/usage$/);
  usedPercent = 92;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    header.getByRole("link", {
      name: "Codex limit nearly reached",
      exact: true,
    }),
  ).toBeVisible();
  usedPercent = 20;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(header.locator(".topbar-limit-notice")).toBeHidden();
  status = "disconnected";
  usedPercent = 100;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(header.locator(".topbar-limit-notice")).toBeHidden();
  await page.goto("/tasks/new");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("textbox", { name: "Task request", exact: true }),
  ).toBeVisible();
  await expect(page.locator('a[href="/tasks/new"]')).toHaveCount(0);
});
