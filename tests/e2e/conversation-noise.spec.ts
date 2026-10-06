import { expect, test } from "@playwright/test";

test("chat and Activity hide protocol noise without deleting recorded evidence", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/tasks/task_b5226f5fb0ae4a9cae658f1e0a9feec4");
  const chat = page.locator(".conversation-scroll");
  await expect(chat).toBeVisible();
  await expect(
    chat.getByText(
      /Codex reported (thread\/status|turn\/started|item\/started|mcpServer)/,
    ),
  ).toHaveCount(0);
  await expect(
    chat.getByText(
      "The process is recorded as evidence without exposing private reasoning.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(
    chat.getByText(/You.ve hit your usage limit/).last(),
  ).toBeVisible();
  await expect(
    page.locator(".activity-feed").getByText("Codex activity", { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(chat.getByText(/Codex reported thread\/status/)).toHaveCount(0);
  await expect(
    chat.getByText(/You.ve hit your usage limit/).last(),
  ).toBeVisible();
});
