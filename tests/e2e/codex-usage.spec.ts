import { expect, test } from "@playwright/test";

test("usage shows account exhaustion, reset windows, and refreshed limits", async ({
  page,
}, testInfo) => {
  let usedPercent = 100;
  await page.route("**/api/codex/usage", (route) =>
    route.fulfill({
      json: {
        status: "available",
        updatedAt: new Date().toISOString(),
        limits: [
          {
            id: "codex",
            name: "Codex",
            planType: "plus",
            reachedType: null,
            credits: null,
            primary: {
              usedPercent,
              windowDurationMins: 300,
              resetsAt: 1791249480,
            },
            secondary: {
              usedPercent: 28,
              windowDurationMins: 10080,
              resetsAt: null,
            },
          },
        ],
      },
    }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/usage");
  await expect(
    page.getByText("100% used / 0% remaining", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Limit reached", { exact: true })).toBeVisible();
  await expect(page.getByText("5-hour window", { exact: true })).toBeVisible();
  await expect(page.getByText("7-day window", { exact: true })).toBeVisible();
  expect(
    await page
      .locator(".codex-usage-card")
      .evaluate((element) => getComputedStyle(element).paddingTop),
  ).toBe("24px");
  await page.screenshot({
    path: testInfo.outputPath("codex-usage.png"),
    fullPage: true,
  });
  await expect(page.locator(".codex-limit-window").first()).toContainText(
    "Resets",
  );
  usedPercent = 20;
  await page.getByRole("button", { name: "Refresh limits" }).click();
  await expect(
    page.getByText("20% used / 80% remaining", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Limit reached", { exact: true })).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("usage preserves last confirmed data on failure and clears it on disconnect", async ({
  page,
}) => {
  let status = "available";
  await page.route("**/api/codex/usage", (route) =>
    route.fulfill({
      json:
        status === "available"
          ? {
              status,
              updatedAt: new Date().toISOString(),
              limits: [
                {
                  id: "codex",
                  name: "Codex",
                  planType: null,
                  reachedType: null,
                  credits: null,
                  primary: {
                    usedPercent: 70,
                    windowDurationMins: 300,
                    resetsAt: null,
                  },
                  secondary: null,
                },
              ],
            }
          : { status, error: "Could not refresh account limits." },
    }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/usage");
  await expect(
    page.getByText("70% used / 30% remaining", { exact: true }),
  ).toBeVisible();
  status = "unavailable";
  await page.getByRole("button", { name: "Refresh limits" }).click();
  await expect(
    page.getByText(/These limits are not confirmed current/),
  ).toBeVisible();
  await expect(
    page.getByText("70% used / 30% remaining", { exact: true }),
  ).toBeVisible();
  status = "disconnected";
  await expect(
    page.getByRole("button", { name: "Refresh limits" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Refresh limits" }).click();
  await expect(
    page.getByRole("link", { name: "Connect Codex", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("70% used / 30% remaining", { exact: true }),
  ).toBeHidden();
});
