import { expect, test } from "@playwright/test";

test("button icons and elapsed time stay aligned on one line", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/usage");
  const refresh = page.getByRole("button", { name: "Refresh limits" });
  await expect(refresh).toBeVisible();
  expect(
    await refresh.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const icon = element.querySelector("svg")!.getBoundingClientRect();
      return (
        ["flex", "inline-flex"].includes(style.display) &&
        style.whiteSpace === "nowrap" &&
        Math.abs(icon.y + icon.height / 2 - rect.y - rect.height / 2) < 2
      );
    }),
  ).toBe(true);
  await page.goto("/tasks");
  const href = await page.locator("a.task-title").first().getAttribute("href");
  expect(href).toBeTruthy();
  await page.goto(href!);
  const elapsed = page
    .locator(".presence-facts > span")
    .filter({ has: page.getByText("Elapsed", { exact: true }) })
    .locator("b");
  await expect(elapsed).toBeVisible();
  expect(
    await elapsed.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const icon = element.querySelector("svg")!.getBoundingClientRect();
      return (
        style.display === "flex" &&
        style.whiteSpace === "nowrap" &&
        Math.abs(icon.y + icon.height / 2 - rect.y - rect.height / 2) < 2
      );
    }),
  ).toBe(true);
});
