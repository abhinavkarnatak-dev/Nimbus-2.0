import { expect, test } from "@playwright/test";

test("centered setup survives refresh and continues only after user action", async ({
  page,
}, testInfo) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  let ready = false;
  let completions = 0;
  await page.route("**/api/onboarding", async (route) => {
    if (route.request().method() === "POST") completions++;
    await route.fulfill({
      json:
        route.request().method() === "POST"
          ? { completed: true }
          : {
              ready,
              completed: false,
              githubConnected: ready,
              codexConnected: ready,
            },
    });
  });
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: /Set up/ })).toBeVisible();
  await expect(page.locator(".connection-card")).toHaveCount(2);
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(
    "/onboarding",
  );
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "Connect Codex to continue",
  );
  await page.screenshot({
    path: `.nimbus/onboarding-${testInfo.project.name}.png`,
    fullPage: true,
  });
  ready = true;
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await expect(page).toHaveURL(/\/onboarding$/);
  expect(completions).toBe(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/:3000\/$/, { timeout: 10000 });
  await expect(
    page.getByRole("heading", { name: "What can Nimbus help you with?" }),
  ).toBeVisible();
});
