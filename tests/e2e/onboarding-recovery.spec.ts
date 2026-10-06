import { expect, test } from "@playwright/test";

test("setup exposes a manual status retry and preserves completion errors", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  let unavailable = true;
  let failCompletion = true;
  await page.route("**/api/onboarding", async (route) => {
    const post = route.request().method() === "POST";
    if ((!post && unavailable) || (post && failCompletion))
      return route.fulfill({
        status: 503,
        json: { error: "Could not finish setup. Please try again." },
      });
    return route.fulfill({
      json: post ? { completed: true } : { ready: true, completed: false },
    });
  });
  await page.goto("/onboarding");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Could not confirm your connections",
  );
  unavailable = false;
  await page.getByRole("button", { name: "Check connections again" }).click();
  const proceed = page.getByRole("button", { name: "Continue", exact: true });
  await expect(proceed).toBeEnabled();
  await proceed.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not finish setup");
  await expect(proceed).toBeEnabled();
  await page.getByRole("button", { name: "Check connections again" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not finish setup");
  failCompletion = false;
  await proceed.click();
  await expect(page).toHaveURL(/:3000\/$/);
});
