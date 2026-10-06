import { expect, test } from "@playwright/test";
test("PR actions use dismissible in-app modals and a red close button", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/tasks/task_demo_01J00000000000000000001?tab=pull-request");
  let writes = 0;
  page.on("dialog", () => {
    throw new Error("Native alert/confirm should not be used");
  });
  await page.route("**/api/tasks/*/pull-request", async (route) => {
    writes++;
    expect(route.request().postDataJSON()).toMatchObject({ confirmed: true });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ state: "merged" }),
    });
  });
  const close = page.getByRole("button", {
    name: "Close pull request",
    exact: true,
  });
  expect(
    await page
      .getByRole("button", { name: "Merge pull request", exact: true })
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(130, 80, 223)");
  expect(
    await page
      .locator(".pr-state-line")
      .evaluate((element) => getComputedStyle(element).color),
  ).toBe("rgb(26, 127, 55)");
  await expect(close).toBeEnabled();
  expect(
    await close.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).toBe("rgb(220, 53, 69)");
  await close.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Close PR #148?" }),
  ).toBeVisible();
  expect(writes).toBe(0);
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  expect(writes).toBe(0);
  await page
    .getByRole("button", { name: "Merge pull request", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Merge PR #148?" }),
  ).toBeVisible();
  expect(
    await dialog
      .getByRole("button", { name: "Confirm merge" })
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(130, 80, 223)");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Merge pull request", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Confirm merge" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Pull request merged" }),
  ).toBeVisible();
  expect(
    await dialog
      .getByRole("heading", { name: "Pull request merged" })
      .evaluate((element) => getComputedStyle(element).color),
  ).toBe("rgb(130, 80, 223)");
  expect(writes).toBe(1);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Pull request merged." }),
  ).toBeVisible();
});
