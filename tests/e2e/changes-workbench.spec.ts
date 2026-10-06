import { expect, test } from "@playwright/test";
test("Changes loading and empty states have aligned padded containers", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tasks/*/files?operation=changes", async (route) => {
    await pending;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ files: [] }),
    });
  });
  try {
    await page.goto("/tasks/task_demo_01J00000000000000000001?tab=changes");
    const state = page
      .getByRole("status")
      .filter({ hasText: "Loading changes" });
    await expect(state).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh changes" }),
    ).toBeDisabled();
    const panel = page.locator(".workspace-panel");
    expect(
      await panel
        .locator("[data-workbench-content]")
        .evaluate((element) => getComputedStyle(element).paddingLeft),
    ).toBe("17px");
    await expect(
      panel.locator(".workspace-panel-header > div > span"),
    ).toHaveText("Repository changes");
    expect(
      await panel
        .locator("h2")
        .evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe("14px");
    expect(
      await state.evaluate((element) => getComputedStyle(element).paddingLeft),
    ).toBe("16px");
    const header = await panel.locator("header > div").boundingBox();
    const loading = await state.boundingBox();
    expect(Math.abs(header!.x - loading!.x)).toBeLessThan(1);
    release();
    await expect(state).toHaveCount(0);
    await expect(
      page.getByText("No changes in this session.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh changes" }),
    ).toBeEnabled();
  } finally {
    release();
  }
});
test("Changes shows expandable line diffs and folder moves", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.route("**/api/tasks/*/files?operation=changes", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        files: [
          {
            path: "folder/hello.py",
            previousPath: "hello.py",
            status: "renamed",
            additions: 0,
            deletions: 0,
            binary: false,
            patch:
              "similarity index 100%\nrename from hello.py\nrename to folder/hello.py",
          },
          {
            path: "README.md",
            status: "modified",
            additions: 1,
            deletions: 1,
            binary: false,
            patch:
              "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old greeting\n+new greeting",
          },
        ],
      }),
    }),
  );
  await page.goto("/tasks/task_demo_01J00000000000000000001?tab=changes");
  await expect(
    page.getByText("hello.py → folder/hello.py", { exact: true }),
  ).toBeVisible();
  await page
    .locator("details")
    .filter({ hasText: "README.md" })
    .locator("summary")
    .click();
  const patch = page.getByLabel("Diff for README.md");
  await expect(patch).toBeVisible();
  await expect(patch).toContainText("-old greeting");
  await expect(patch).toContainText("+new greeting");
  expect(
    await patch
      .locator("span")
      .filter({ hasText: "+new greeting" })
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(230, 255, 236)");
  expect(
    await patch
      .locator("span")
      .filter({ hasText: "-old greeting" })
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(255, 235, 233)");
});
