import { expect, test } from "@playwright/test";

test("one repository-page refresh updates an open Mission Control picker across tabs", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  let changed = false;
  let applyChanges = false;
  const initial = [
    { id: "picker-old", fullName: "owner/removed" },
    { id: "picker-kept", fullName: "owner/kept" },
  ];
  const latest = [{ id: "picker-new", fullName: "owner/added" }, initial[1]];
  await context.route("**/api/github/repositories", (route) =>
    route.fulfill({ json: { repositories: changed ? latest : initial } }),
  );
  await context.route("**/api/github/sync", (route) => {
    if (applyChanges) changed = true;
    return route.fulfill({ json: { installations: 1, repositories: 2 } });
  });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  const trigger = page.getByRole("button", {
    name: "Choose repository",
    exact: true,
  });
  await expect(trigger).toContainText("No repository");
  await trigger.click();
  await page
    .getByRole("button", { name: "owner/removed", exact: true })
    .click();
  const prompt = page.getByRole("textbox", { name: "Task request" });
  await prompt.fill("Keep my draft while repositories update");
  await trigger.click();
  const options = page.getByRole("group", { name: "Repository selection" });
  await expect(
    options.getByRole("button", { name: "owner/removed" }),
  ).toBeVisible();
  const repoPage = await context.newPage();
  await repoPage.goto("/repositories");
  const refresh = repoPage.getByRole("button", {
    name: "Refresh repositories",
  });
  await expect(repoPage.getByRole("status")).toContainText(
    "Synced from GitHub",
  );
  await expect(refresh).toBeEnabled();
  applyChanges = true;
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(
    options.getByRole("button", { name: "owner/added" }),
  ).toBeVisible();
  await expect(
    options.getByRole("button", { name: "owner/removed" }),
  ).toHaveCount(0);
  await expect(trigger).toContainText("No repository");
  await expect(page.locator('input[name="repositoryId"]')).toHaveValue("");
  await expect(prompt).toHaveValue("Keep my draft while repositories update");
  await options.getByRole("button", { name: "owner/kept" }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(trigger).toContainText("owner/kept");
  await expect(page.locator('input[name="repositoryId"]')).toHaveValue(
    "picker-kept",
  );
  await repoPage.close();
});
