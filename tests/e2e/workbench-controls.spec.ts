import { expect, test } from "@playwright/test";
test("navigation icons, follow-up placeholder and icon-only workbench controls stay consistent without Runtime", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  const nav = page.getByRole("navigation", { name: "Workspace", exact: true });
  await expect(
    nav
      .getByRole("link", { name: "Dashboard", exact: true })
      .locator("svg.lucide-layout-dashboard"),
  ).toBeVisible();
  await expect(
    nav
      .getByRole("link", { name: "History", exact: true })
      .locator("svg.lucide-history"),
  ).toBeVisible();
  await page.goto("/tasks/task_demo_01J00000000000000000001");
  await expect(
    page.getByRole("textbox", { name: "Follow-up message" }),
  ).toHaveAttribute(
    "placeholder",
    "Session stays open. Continue in the same workspace and thread.",
  );
  await expect(
    page.getByRole("link", { name: "Runtime", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Ready for your next request.", { exact: true }),
  ).toHaveCount(0);
  const tabs = page.getByRole("navigation", {
    name: "Task workspace",
    exact: true,
  });
  expect(
    await tabs.evaluate((element) => ({
      horizontalOverflow: element.scrollWidth > element.clientWidth,
      verticalOverflow: element.scrollHeight > element.clientHeight,
      overflow: getComputedStyle(element).overflow,
    })),
  ).toEqual({
    horizontalOverflow: false,
    verticalOverflow: false,
    overflow: "visible",
  });
  const close = page.getByRole("button", {
    name: "Close task workbench",
    exact: true,
  });
  await expect(close).toHaveText("");
  await expect(close).toHaveAttribute("title", "Close workbench");
  const closeBox = await close.boundingBox();
  const firstTab = await tabs
    .getByRole("link", { name: "Activity", exact: true })
    .boundingBox();
  expect(
    Math.abs(
      closeBox!.y + closeBox!.height / 2 - firstTab!.y - firstTab!.height / 2,
    ),
  ).toBeLessThanOrEqual(1);
  await close.click();
  const open = page.getByRole("button", {
    name: "Open task workbench",
    exact: true,
  });
  await expect(open).toHaveText("");
  await expect(open).toHaveAttribute("title", "Open workbench");
  const openBox = await open.boundingBox();
  const heading = await page.locator(".pane-heading").boundingBox();
  expect(
    Math.abs(
      openBox!.y + openBox!.height / 2 - heading!.y - heading!.height / 2,
    ),
  ).toBeLessThanOrEqual(1);
  expect(openBox!.width).toBe(closeBox!.width);
  expect(openBox!.height).toBe(closeBox!.height);
  await open.click();
  await expect(close).toBeVisible();
  await page.goto("/tasks/task_demo_01J00000000000000000001?tab=logs");
  await expect(
    page.getByRole("heading", { name: "Runtime", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".activity-feed")).toBeVisible();
});
