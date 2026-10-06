import { expect, test } from "@playwright/test";

test("confirmed PR delivery appears as a compact linked chat card", async ({
  page,
}) => {
  const data = {
    title: "Keep the greeting reliable",
    repository: "test/repo",
    number: 16,
    url: "https://github.com/test/repo/pull/16",
    changedFiles: 1,
    additions: 2,
    deletions: 1,
    files: [{ path: "README.md", additions: 2, deletions: 1 }],
  };
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.route("**/api/tasks/*/events?*", async (route) => {
    const card = {
      id: "test-pr-card",
      sequence: 99999,
      timestamp: new Date().toISOString(),
      category: "agent_message",
      phase: "creating_pr",
      status: "succeeded",
      title: "Pull request ready",
      whatWasDone: "PR created",
      whyItWasDone: "",
      evidence: [`pr-card:${JSON.stringify(data)}`],
    };
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `event: task_event\ndata: ${JSON.stringify(card)}\n\n`,
    });
  });
  await page.goto("/tasks/task_demo_01J00000000000000000001");
  const card = page.getByRole("region", { name: "Pull request #16" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: data.title })).toHaveAttribute(
    "href",
    data.url,
  );
  await expect(card).toContainText("1 file changed");
  await expect(card).toContainText("+2 added");
  await expect(card).toContainText("−1 deleted");
  const file = card.getByRole("button", { name: "README.md", exact: true });
  await expect(file).not.toBeVisible();
  await card.getByText("Changed files", { exact: true }).click();
  await expect(file).toBeVisible();
  expect(
    await card.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});
