import { expect, test } from "@playwright/test";

test("inline rename persists on session and History with adjacent edit icons", async ({
  page,
}) => {
  const taskId = "task_demo_01J00000000000000000001";
  await page.route("**/api/tasks/*/events?*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'event: task_state\ndata: {"status":"completed"}\n\n',
    }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recent History", exact: true }),
  ).toBeVisible();
  await page.goto(`/tasks/${taskId}`);
  const heading = page.locator(".agent-title-block h1");
  const original = (await heading.innerText()).trim();
  const input = page.getByRole("textbox", {
    name: "Session title",
    exact: true,
  });
  try {
    await page
      .getByRole("button", { name: `Edit title: ${original}`, exact: true })
      .click();
    await expect(input).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await input.fill("Unsaved title");
    await input.press("Escape");
    await expect(heading).toHaveText(original);
    await page
      .getByRole("button", { name: `Edit title: ${original}`, exact: true })
      .click();
    await input.fill("Renamed session verification");
    await input.press("Enter");
    await expect(heading).toHaveText("Renamed session verification");
    await expect(page.locator(".agent-breadcrumb strong")).toHaveText(
      "Renamed session verification",
    );
    await page.reload();
    await expect(heading).toHaveText("Renamed session verification");
    await page.goto("/tasks");
    const table = page.getByRole("table", { name: "Session history" });
    await expect(table.getByRole("columnheader")).toHaveText([
      "Session",
      "Repository",
      "Status",
      "Updated",
    ]);
    const row = table.locator(`tr[data-task-id='${taskId}']`);
    await expect(row.locator(".task-title")).toHaveText(
      "Renamed session verification",
    );
    const titleBounds = await row.locator(".task-title").boundingBox();
    const editBounds = await row
      .getByRole("button", {
        name: "Edit title: Renamed session verification",
        exact: true,
      })
      .boundingBox();
    expect(titleBounds).not.toBeNull();
    expect(editBounds).not.toBeNull();
    expect(
      editBounds!.x - (titleBounds!.x + titleBounds!.width),
    ).toBeLessThanOrEqual(12);
    await page
      .getByRole("button", {
        name: "Edit title: Renamed session verification",
        exact: true,
      })
      .click();
    await input.fill("Renamed from History");
    await page.getByRole("button", { name: "Save title", exact: true }).click();
    await expect(row.locator(".task-title")).toHaveText("Renamed from History");
    await row.locator(".task-title").click();
    await expect(heading).toHaveText("Renamed from History");
  } finally {
    const response = await page.request.patch(`/api/tasks/${taskId}/title`, {
      headers: { origin: "http://127.0.0.1:3000" },
      data: { title: original },
    });
    expect(response.ok()).toBe(true);
  }
});
