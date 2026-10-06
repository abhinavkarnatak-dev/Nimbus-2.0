import { expect, test } from "@playwright/test";
test("successful checks are green and absent pull requests have an honest empty state", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/tasks/task_demo_01J00000000000000000001?tab=checks");
  const successful = page
    .locator(".check-row")
    .filter({ has: page.locator(".state-completed") });
  await expect(successful.first()).toBeVisible();
  await expect(successful.first().locator(".state-chip")).toHaveText(
    "Completed",
  );
  await expect(
    successful.first().locator(".check-icon svg.lucide-check"),
  ).toBeVisible();
  const color = await successful
    .first()
    .locator(".state-chip")
    .evaluate((element) => getComputedStyle(element).color);
  const green = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--green")
      .trim(),
  );
  const expectedColor = await page.evaluate((value) => {
    const element = document.createElement("span");
    element.style.color = value;
    document.body.appendChild(element);
    const result = getComputedStyle(element).color;
    element.remove();
    return result;
  }, green);
  expect(color).toBe(expectedColor);
  await page.goto(
    "/tasks/task_b5226f5fb0ae4a9cae658f1e0a9feec4?tab=pull-request",
  );
  await expect(
    page.getByRole("heading", { name: "No pull requests created" }),
  ).toBeVisible();
  await expect(
    page.getByText("Pull request pending", { exact: true }),
  ).toHaveCount(0);
});
