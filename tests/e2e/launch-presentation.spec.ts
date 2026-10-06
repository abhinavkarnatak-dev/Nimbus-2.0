import { expect, test } from "@playwright/test";

test("launch feedback stays in the button and desktop profile stays at the bottom", async ({
  page,
}) => {
  test.setTimeout(90_000);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await gate;
    await route.fulfill({
      status: 400,
      json: { error: "Test launch rejected" },
    });
  });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await expect(
    page.getByText("Nimbus will name the session from your request.", {
      exact: true,
    }),
  ).toHaveCount(0);
  if (page.viewportSize()!.width > 780) {
    await expect
      .poll(async () => {
        const profile = await page
          .locator("summary[aria-label='Profile']")
          .boundingBox();
        return profile
          ? Math.abs(
              page.viewportSize()!.height - profile.y - profile.height - 14,
            )
          : Infinity;
      })
      .toBeLessThan(2);
  }
  await page
    .getByRole("textbox", { name: "Task request" })
    .fill("Verify the launch button presentation only.");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  try {
    await expect(
      page.getByRole("button", { name: "Starting…", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Starting your agent run...", { exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.locator(".launch-feedback-error")).toHaveText(
    "Test launch rejected",
  );
  await expect(
    page.getByRole("button", { name: "Start", exact: true }),
  ).toBeEnabled();
});
