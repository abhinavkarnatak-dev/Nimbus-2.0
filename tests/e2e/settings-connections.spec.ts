import { expect, test } from "@playwright/test";

test("connections live in Settings and legacy links redirect there", async ({
  page,
}) => {
  await page.route("**/api/codex/device", (route) =>
    route.fulfill({
      json: {
        status: "connected",
        account: { email: "settings@example.invalid", planType: "plus" },
      },
    }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await expect(page.locator(".profile-row svg")).toHaveCount(0);
  await expect(page.locator(".engine-card")).toHaveCount(0);
  const workspaceName = await page.locator(".org-control strong").textContent();
  const expectedInitials = workspaceName!
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  await expect(page.locator(".org-avatar")).toHaveText(expectedInitials);
  await page
    .getByRole("navigation", { name: "Workspace", exact: true })
    .getByRole("link", { name: "Connections", exact: true })
    .click();
  const connections = page.getByRole("region", {
    name: "Connections",
    exact: true,
  });
  await expect(connections).toBeVisible();
  for (const name of [
    "Concurrency",
    "Pull requests",
    "Memory retention",
    "Observability privacy",
  ])
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(
      0,
    );
  await expect(
    page.getByRole("heading", { name: "Your account", exact: true }),
  ).toHaveCount(0);
  await expect(connections.locator(".connection-card")).toHaveCount(2);
  await expect(
    connections.getByRole("heading", { name: "GitHub App", exact: true }),
  ).toBeVisible();
  const codex = connections
    .locator(".connection-card")
    .filter({ has: page.getByRole("heading", { name: "Codex", exact: true }) });
  await expect(codex.locator(".connection-status")).toHaveText("Active");
  await expect(
    codex.getByRole("button", { name: "Disconnect Codex" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".sidebar-nav")
      .getByRole("link", { name: "Connections", exact: true }),
  ).toHaveCount(1);
  await page.goto("/integrations");
  await expect(page).toHaveURL(/\/settings#connections$/);
  await expect(connections).toBeInViewport();
  await expect(connections).toBeVisible();
  await page.reload();
  await expect(codex.locator(".connection-status")).toHaveText("Active");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("sidebar profile offers confirmed sign-out without an account card", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Your account", exact: true }),
  ).toHaveCount(0);
  const profile = page.locator("summary[aria-label='Profile']");
  await profile.click();
  const trigger = page.getByRole("button", {
    name: "Log out",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Log out?" });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCSS("filter", "blur(5px)");
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
  await expect(profile).toBeVisible();
  await profile.click();
  await trigger.click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await profile.click();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await profile.click();
  await trigger.click();
  await dialog.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in/);
});
