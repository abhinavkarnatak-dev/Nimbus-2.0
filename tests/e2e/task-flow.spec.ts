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
      name: "What can Nimbus help you with?",
    }),
  ).toBeVisible();

  await page.goto("/");
  test.skip(
    (await page.getByLabel("Codex model").inputValue()) !==
      "fake-codex-test-provider",
    "This simulation-only flow requires an isolated fake-provider account; do not disconnect a user's live Codex account for a test",
  );
  await expect(page.getByLabel("Codex model")).toHaveValue(
    "fake-codex-test-provider",
  );
  const title = "Fix task stream recovery after a browser refresh";
  await page
    .getByRole("button", { name: "Choose repository", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Repository selection" })
    .getByRole("button")
    .filter({ hasText: "/" })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Task request" })
    .fill(
      `${title}. Preserve ordered durable events when the page reconnects.`,
    );
  const createButton = page.getByRole("button", { name: "Start", exact: true });
  await createButton.focus();
  await createButton.press("Enter");

  await expect(page).toHaveURL(/\/tasks\/task_/);
  await expect(
    page.getByRole("heading", { name: "Fix event streaming" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agent activity" }),
  ).toBeVisible();
  await expect(page.locator(".live-agent-presence")).toBeVisible();
  await expect(
    page.locator(".live-agent-presence").getByText("Elapsed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close task workbench" }).click();
  await expect(
    page.getByRole("button", { name: "Open task workbench" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open task workbench" }).click();
  await expect(
    page.getByRole("heading", { name: "Agent activity" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Plan", exact: true }),
  ).toHaveCount(0);

  await expect(
    page.getByText("Idle - ready for follow-up", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const followup = `Add another change to this same session ${Date.now()}`;
  await page.getByRole("textbox", { name: "Follow-up message" }).fill(followup);
  const delivered = page.waitForResponse(
    (response) =>
      response.url().endsWith("/messages") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send follow-up" }).click();
  expect((await delivered).status()).toBe(202);
  await expect(
    page.getByRole("textbox", { name: "Follow-up message" }),
  ).toHaveValue("");
  await expect(
    page.locator(".conversation-scroll p").getByText(followup, { exact: true }),
  ).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByText("Idle - ready for follow-up", { exact: true }),
  ).toBeVisible({ timeout: 20000 });

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Fix event streaming" }),
  ).toBeVisible();
  await expect(
    page.locator(".conversation-scroll").getByText(followup, { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".activity-feed").getByText("Task accepted", { exact: true }),
  ).toBeVisible();
});
