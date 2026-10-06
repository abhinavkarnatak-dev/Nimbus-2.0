import { expect, test } from "@playwright/test";

test("repository access refreshes on navigation and return; follow-up focus has no textarea outline", async ({
  page,
}) => {
  let syncs = 0;
  await page.route("**/api/github/sync", (route) => {
    syncs++;
    return route.fulfill({ json: { installations: 0, repositories: 0 } });
  });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/repositories");
  await expect.poll(() => syncs).toBeGreaterThan(0);
  const baseline = syncs;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => syncs).toBeGreaterThan(baseline);
  await page.goto("/tasks/task_b5226f5fb0ae4a9cae658f1e0a9feec4");
  const input = page.getByRole("textbox", { name: "Follow-up message" });
  await input.focus();
  await expect(input).toHaveCSS("outline-style", "none");
  await expect(page.locator(".followup-box")).toHaveCSS(
    "border-top-color",
    "rgb(180, 167, 237)",
  );
});
