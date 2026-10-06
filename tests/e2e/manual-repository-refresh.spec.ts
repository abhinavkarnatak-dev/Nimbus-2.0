import { expect, test } from "@playwright/test";

test("manual repository refresh reports success and loading, with silent failure and retry", async ({
  page,
}) => {
  let mode: "success" | "failure" | "hold" = "success";
  let requests = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/github/sync", async (route) => {
    requests++;
    if (mode === "hold") await held;
    await route.fulfill(
      mode === "failure"
        ? { status: 502, json: { error: "upstream unavailable" } }
        : { json: { installations: 1, repositories: 3 } },
    );
  });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/repositories");
  const refresh = page.getByRole("button", { name: "Refresh repositories" });
  const controls = page.locator(".page-head");
  await expect(page.getByRole("status")).toContainText(
    "Synced from GitHub: 3 repositories.",
  );
  await expect(refresh).toBeEnabled();
  const baseline = requests;
  mode = "failure";
  const failedRefresh = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/github/sync") && response.status() === 502,
  );
  await refresh.click();
  await failedRefresh;
  await expect(refresh).toBeEnabled();
  await expect(controls.getByRole("alert")).toHaveCount(0);
  await expect(controls.getByRole("status")).toHaveCount(0);
  expect(requests).toBeGreaterThan(baseline);
  mode = "hold";
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(refresh).toHaveText("Refreshing...");
  release();
  await expect(refresh).toBeEnabled();
  await expect(controls.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Updated");
  await expect(page.getByRole("status")).toContainText(
    "Synced from GitHub: 3 repositories.",
  );
  mode = "failure";
  const dashboardFailure = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/github/sync") && response.status() === 502,
  );
  await page.goto("/");
  await dashboardFailure;
  await expect(
    page.getByRole("heading", { name: "What can Nimbus help you with?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh repositories" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Repository refresh failed. Please try again."),
  ).toHaveCount(0);
});
