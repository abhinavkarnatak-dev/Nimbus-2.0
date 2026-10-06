import { expect, test } from "@playwright/test";

test("a general session renders full-width chat, persists and accepts follow-ups", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  test.skip(
    (await page.getByLabel("Codex model").inputValue()) !==
      "fake-codex-test-provider",
    "Do not change a user's live model connection for a UI fixture",
  );
  await page
    .getByRole("textbox", { name: "Task request" })
    .fill("General chat UI verification");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/task_/);
  const url = page.url();
  await expect(page.locator(".agent-breadcrumb")).toContainText("General chat");
  await expect(
    page.getByRole("navigation", { name: "Task workspace", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open task workbench" }),
  ).toHaveCount(0);
  await expect(page.locator(".agent-facts")).not.toContainText("Repository");
  await expect(page.locator(".agent-facts")).not.toContainText("Branch");
  await expect(page.locator(".agent-workspace")).toHaveClass(/panel-closed/);
  await expect(
    page
      .getByText("Local simulation received this message.", { exact: false })
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  const followup = `Continue this general chat ${Date.now()}`;
  await page.getByRole("textbox", { name: "Follow-up message" }).fill(followup);
  await page.getByRole("button", { name: "Send follow-up" }).click();
  await expect(
    page.locator(".conversation-scroll").getByText(followup, { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(
    page.locator(".conversation-scroll").getByText(followup, { exact: true }),
  ).toBeVisible();
  await page.goto("/tasks");
  await expect(
    page.locator(`a[href="${new URL(url).pathname}"]`).first(),
  ).toBeVisible();
});

test("general chat is the default and repository selection is always explicit", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.route("**/api/github/repositories", (route) =>
    route.fulfill({
      json: {
        repositories: [{ id: "repo_test_12345", fullName: "owner/repo" }],
      },
    }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  const trigger = page.getByRole("button", {
    name: "Choose repository",
    exact: true,
  });
  await expect(trigger).toContainText("No repository");
  await expect(page.locator('input[name="repositoryId"]')).toHaveValue("");
  await trigger.click();
  await page.getByRole("button", { name: "owner/repo", exact: true }).click();
  await expect(page.locator('input[name="repositoryId"]')).toHaveValue(
    "repo_test_12345",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator('input[name="repositoryId"]')).toHaveValue(
    "repo_test_12345",
  );
  await trigger.click();
  await page
    .getByRole("button", { name: "No repository - general chat" })
    .click();
  await expect(page.locator('input[name="repositoryId"]')).toHaveValue("");
  await page.reload();
  await expect(page.locator('input[name="repositoryId"]')).toHaveValue("");
  await page.unroute("**/api/github/repositories");
  await page.route("**/api/github/repositories", (route) =>
    route.fulfill({ json: { repositories: [] } }),
  );
  await trigger.click();
  await expect(
    page.getByRole("button", { name: "No repository - general chat" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "No repository - general chat" })
    .click();
  await page.getByRole("textbox", { name: "Task request" }).fill("Hi");
  await page.route("**/api/tasks", async (route) => {
    const body = route.request().postData() ?? "";
    expect(body).toContain("Hi");
    expect(body).toMatch(/name="repositoryId"\r\n\r\n\r\n/);
    await route.fulfill({
      status: 400,
      json: { error: "General chat submission verified" },
    });
  });
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator(".launch-feedback-error")).toContainText(
    "General chat submission verified",
  );
});
