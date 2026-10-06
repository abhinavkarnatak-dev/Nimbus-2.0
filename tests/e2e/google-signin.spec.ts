import { expect, test } from "@playwright/test";

test("Nimbus sign-in offers Google rather than ChatGPT", async ({
  page,
}, testInfo) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(page.getByText("Continue with ChatGPT")).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .getByRole("button", { name: "Continue with Google" })
        .locator("img")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByText("ChatGPT sign-in is a launch-gated integration"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `.nimbus/google-signin-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("Settings sign-out clears the development browser session", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("Google callback without credentials fails closed", async ({
  request,
}) => {
  const response = await request.get(
    "/api/auth/callback/google?code=invalid-test-code&state=invalid-test-state",
    { maxRedirects: 0 },
  );
  expect([302, 403, 503]).toContain(response.status());
  expect(response.headers()["set-cookie"] ?? "").not.toContain(
    "authjs.session-token=",
  );
});
