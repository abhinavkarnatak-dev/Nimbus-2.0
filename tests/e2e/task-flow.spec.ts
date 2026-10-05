import { expect, test } from "@playwright/test";

test("local onboarding creates a durable task that survives refresh", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "What should Nimbus ship next?",
    }),
  ).toBeVisible();

  await page.goto("/tasks/new");
  const title = "Fix task stream recovery after a browser refresh";
  await page
    .getByLabel("What should Nimbus do?")
    .fill(
      `${title}. Preserve ordered durable events when the page reconnects.`,
    );
  const createButton = page.getByRole("button", { name: "Run agent" });
  await createButton.focus();
  await createButton.press("Enter");

  await expect(page).toHaveURL(/\/tasks\/task_/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agent activity" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Plan" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Task accepted", { exact: true })).toBeVisible();
});
