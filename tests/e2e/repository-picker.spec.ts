import { expect, test } from "@playwright/test";

test("repository dropdown keeps icon, truncated name, and checkmark on one row", async ({
  page,
}, testInfo) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page
    .getByRole("button", { name: "Choose repository", exact: true })
    .click();
  const panel = page.getByRole("group", { name: "Repository selection" });
  const option = panel.locator(".repository-option").first();
  await expect(option).toBeVisible();
  expect(
    await option.evaluate((element) => {
      const name = element.querySelector("span")!;
      const style = getComputedStyle(name);
      const rect = name.getBoundingClientRect();
      return (
        getComputedStyle(element).display === "flex" &&
        style.whiteSpace === "nowrap" &&
        style.textOverflow === "ellipsis" &&
        rect.height < 30
      );
    }),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("repository-dropdown.png"),
  });
  await option.click();
  await expect(panel).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Choose repository", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("long repository lists scroll internally without expanding the dropdown", async ({
  page,
}) => {
  await page.route("**/api/github/repositories", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page
    .getByRole("button", { name: "Choose repository", exact: true })
    .click();
  const panel = page.getByRole("group", { name: "Repository selection" });
  const list = panel.locator(".repository-options");
  // A synthetic long-list layout fixture avoids changing real repository access.
  await list.evaluate((element) => {
    const template = element.querySelector("button")!;
    for (let index = 0; index < 40; index++) {
      const option = template.cloneNode(true) as HTMLButtonElement;
      option.querySelector("span")!.textContent = `owner/repository-${index}`;
      element.appendChild(option);
    }
  });
  const before = await list.evaluate((element) => ({
    height: element.clientHeight,
    overflowing: element.scrollHeight > element.clientHeight,
    overflow: getComputedStyle(element).overflowY,
  }));
  expect(before.height).toBeLessThanOrEqual(280);
  expect(before.overflowing).toBe(true);
  expect(before.overflow).toBe("auto");
  await list.hover();
  const pageScroll = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 1000);
  await expect
    .poll(() => list.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
  await list.locator("button").last().focus();
  await expect(list.locator("button").last()).toBeInViewport();
  await expect(panel.locator(".model-picker-heading")).toBeInViewport();
  expect(await list.evaluate((element) => element.clientHeight)).toBe(
    before.height,
  );
});

test("start errors stay in the composer instead of navigating to JSON", async ({
  page,
}) => {
  await page.route("**/api/tasks", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Reconnect Codex before running a task" },
    }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page
    .getByRole("textbox", { name: "Task request" })
    .fill("Inspect repository files and identify the test command");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "Reconnect Codex before running a task",
  );
  await expect(page).not.toHaveURL(/\/api\/tasks/);
});
