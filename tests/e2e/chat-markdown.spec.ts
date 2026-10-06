import { expect, test } from "@playwright/test";

test.use({
  timezoneId: "Asia/Kolkata",
  permissions: ["clipboard-read", "clipboard-write"],
});

test("simulated streaming Markdown renders formatted replies and grouped work safely", async ({
  page,
}, testInfo) => {
  const taskId = "task_b5226f5fb0ae4a9cae658f1e0a9feec4";
  const markdown = [
    "## Repository overview",
    "",
    "This is a **small sandbox** with `add(a, b)`.",
    "",
    `Read [README.md](<C:/Users/example/Nimbus 2.0/.nimbus/workspaces/${taskId}/README.md:1>).`,
    "",
    "### Python",
    "",
    "- Standalone examples",
    "- No external dependencies",
    "",
    "```python",
    'print("Hello, World!")',
    "```",
    "",
    "| Language | Purpose |",
    "| --- | --- |",
    "| Python | Examples |",
    "",
    "[Documentation](https://example.invalid/docs)",
    "",
    "[Unsafe](javascript:alert(1))",
    "",
    "<script>window.__markdownAttack = true</script>",
    "",
    "![remote](https://leak.invalid/pixel)",
  ].join("\n");
  const event = (
    sequence: number,
    category: string,
    title: string,
    text: string,
  ) => ({
    id: `markdown-${sequence}`,
    sequence,
    timestamp: "2026-10-06T01:21:00.000Z",
    category,
    title,
    whatWasDone: text,
    whyItWasDone: "",
    phase: "running",
    status: "succeeded",
    evidence: ["codex-item:report"],
  });
  const events = [
    event(
      10001,
      "lifecycle",
      "Workspace ready",
      "The assigned workspace is available.",
    ),
    event(
      10002,
      "repository",
      "Repository ready",
      "The repository was checked out.",
    ),
    event(10003, "agent_message", "Agent response", markdown.slice(0, 170)),
    event(10004, "protocol", "Codex activity", "item/agentMessage/delta"),
    event(10005, "agent_message", "Agent response", markdown.slice(170)),
  ];
  let imageFetched = false;
  page.on("request", (request) => {
    if (request.url().includes("leak.invalid")) imageFetched = true;
  });
  await page.route("**/api/tasks/*/events?*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body:
        'event: task_state\ndata: {"status":"completed"}\n\n' +
        events
          .map(
            (event) =>
              `id: ${event.sequence}\nevent: task_event\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
    }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto(`/tasks/${taskId}`);
  const chat = page.locator(".conversation-scroll");
  const reply = chat.locator("[data-markdown-message]").filter({
    has: page.getByRole("heading", {
      name: "Repository overview",
      exact: true,
    }),
  });
  await expect(reply).toHaveCount(1);
  await expect(reply.locator("strong")).toHaveText("small sandbox");
  await expect(reply.locator("ul li")).toHaveCount(2);
  await expect(reply.locator("table th")).toHaveCount(2);
  await expect(reply.locator("pre code")).toHaveText(
    'print("Hello, World!")\n',
  );
  await expect(reply.locator("pre code")).toHaveClass("language-python");
  await reply.getByRole("button", { name: "Copy code" }).click();
  await expect(reply.getByRole("button", { name: "Copy code" })).toHaveText(
    "Copied",
  );
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    ),
  ).toBe('print("Hello, World!")\n');
  await expect(
    reply.getByRole("link", { name: "Documentation", exact: true }),
  ).toHaveAttribute("href", "https://example.invalid/docs");
  await expect(reply.locator('[title="README.md:1"]')).toBeVisible();
  await expect(reply).not.toContainText("C:/Users");
  await expect(reply.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(reply.locator("script, img")).toHaveCount(0);
  expect(await page.evaluate(() => "__markdownAttack" in window)).toBe(false);
  expect(imageFetched).toBe(false);
  const work = chat
    .getByRole("region", { name: "Work log" })
    .filter({ hasText: "The assigned workspace is available." });
  await expect(work).toHaveCount(1);
  await expect(
    work
      .locator("details")
      .filter({ hasText: "The assigned workspace is available." }),
  ).toHaveCount(1);
  await expect(
    work
      .locator("details")
      .filter({ hasText: "The repository was checked out." }),
  ).toHaveCount(1);
  await expect(work.getByText("Nimbus", { exact: true })).toHaveCount(0);
  await expect(
    chat.locator('time[datetime="2026-10-06T01:21:00.000Z"]').first(),
  ).toHaveText("06:51 am");
  await expect(chat.locator("time").filter({ hasText: /UTC|IST/ })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(
    reply.getByRole("heading", { name: "Repository overview", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await reply.screenshot({
    path: `.nimbus/chat-markdown-reply-${testInfo.project.name}.png`,
  });
  await page.screenshot({
    path: `.nimbus/chat-markdown-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
