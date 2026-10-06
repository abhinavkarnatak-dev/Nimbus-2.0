import { expect, test } from "@playwright/test";
test("Stop is inside chat, targets one request, and leaves follow-ups available", async ({
  page,
}) => {
  test.setTimeout(90_000);
  let status = "provisioning";
  const messageId = "request-stop-fixture";
  await page.route("**/api/tasks/*/events?*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `event: task_state\ndata: ${JSON.stringify({ status, messageId: status === "cancelled" ? null : messageId })}\n\n`,
    }),
  );
  let stopped = false;
  await page.route("**/api/tasks/*/stop", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ messageId });
    stopped = true;
    status = "cancelling";
    await route.fulfill({ status: 202, json: { messageId } });
  });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/tasks/task_demo_01J00000000000000000001");
  const stop = page.getByRole("button", { name: "Stop current request" });
  await expect(stop).toBeVisible();
  await expect(
    page
      .locator(".followup-box")
      .getByRole("button", { name: "Stop current request" }),
  ).toBeVisible();
  await stop.click();
  expect(stopped).toBe(true);
  await expect(stop).toHaveAttribute("aria-busy", "true");
  await expect(stop).toBeDisabled();
  status = "cancelled";
  await page.reload();
  await expect(stop).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Follow-up message" })
    .fill("Continue in this chat");
  await expect(
    page.getByRole("button", { name: "Send follow-up" }),
  ).toBeEnabled();
  await expect(page.locator(".conversation-scroll")).toBeVisible();
});
