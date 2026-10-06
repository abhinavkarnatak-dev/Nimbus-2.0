import { expect, test } from "@playwright/test";

test("page actions share the Connections purple button palette", async ({
  page,
}) => {
  await page.route("**/api/codex/**", (route) =>
    route.fulfill({ json: { status: "disconnected" } }),
  );
  await page.route("**/api/github/sync", (route) =>
    route.fulfill({ json: { synced: true, repositories: 3 } }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  for (const [path, label, secondary] of [
    ["/usage", "Refresh limits", true],
    ["/skills", "New skill", false],
    ["/repositories", "Refresh repositories", false],
    ["/tasks", "Open Dashboard", false],
  ] as const) {
    await page.goto(path);
    const button = page.getByRole(path === "/tasks" ? "link" : "button", {
      name: label,
      exact: true,
    });
    await expect(button).toBeVisible();
    const colors = await button.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      color: getComputedStyle(element).color,
    }));
    expect(colors.background).toBe(
      secondary ? "rgb(246, 243, 255)" : "rgb(85, 64, 199)",
    );
    expect(colors.color).toBe(
      secondary ? "rgb(85, 64, 199)" : "rgb(255, 255, 255)",
    );
  }
  await page.goto("/settings");
  await page.locator("summary[aria-label='Profile']").click();
  const signOut = page.getByRole("button", { name: "Log out", exact: true });
  await expect(signOut).toHaveCSS("background-color", "rgb(255, 241, 242)");
  await expect(signOut).toHaveCSS("color", "rgb(185, 71, 71)");
  await expect(signOut).toHaveCSS("font-size", "11px");
  await expect(signOut.locator("svg")).toBeVisible();
});
