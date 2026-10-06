import { expect, test } from "@playwright/test";
test("highlighted prompts have a history navigator and a centered jump-to-latest control", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const events = [
    {
      id: "navigation-prompt",
      sequence: 10001,
      timestamp: new Date().toISOString(),
      category: "conversation",
      phase: "queued",
      status: "succeeded",
      title: "Follow-up received",
      whatWasDone: "Explain the cancellation flow",
      whyItWasDone: "",
    },
    {
      id: "navigation-reply",
      sequence: 10002,
      timestamp: new Date().toISOString(),
      category: "agent_message",
      phase: "running",
      status: "succeeded",
      title: "Agent response",
      whatWasDone: Array.from(
        { length: 35 },
        (_, i) =>
          `Paragraph ${i + 1}: This is a longer reply used to verify navigation back to the associated user prompt.`,
      ).join("\n\n"),
      whyItWasDone: "",
      evidence: ["codex-item:navigation-reply"],
    },
    {
      id: "navigation-stop",
      sequence: 10003,
      timestamp: new Date().toISOString(),
      category: "lifecycle",
      phase: "cancelled",
      status: "cancelled",
      title: "Request stopped",
      whatWasDone: "The current request stopped.",
      whyItWasDone: "",
    },
  ];
  await page.route("**/api/tasks/*/events?*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body:
        `event: task_state\ndata: ${JSON.stringify({ status: "cancelled", messageId: null })}\n\n` +
        events
          .map(
            (event) => `event: task_event\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
    }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/tasks/task_demo_01J00000000000000000001");
  const prompt = page.locator("#prompt-navigation-prompt");
  await expect(prompt).toContainText("Explain the cancellation flow");
  const chat = page.locator(".conversation-scroll");
  await expect(chat.locator(".message header strong")).toHaveCount(0);
  await expect(chat.locator(".live-agent-presence")).toHaveCount(0);
  await expect(chat.locator(".user-message .message-avatar")).toHaveCount(0);
  const layout = await chat.evaluate((element) => {
    const style = getComputedStyle(element);
    const width =
      element.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight);
    const right =
      element.getBoundingClientRect().left +
      element.clientWidth -
      parseFloat(style.paddingRight);
    return { width, right };
  });
  for (const userMessage of await chat.locator(".user-message").all()) {
    const box = await userMessage.boundingBox();
    expect(Math.abs(box!.width - layout.width * 0.65)).toBeLessThan(2);
    expect(Math.abs(box!.x + box!.width - layout.right)).toBeLessThan(2);
  }
  const reply = chat.locator(".agent-message").last();
  await expect(reply.locator(".message-avatar.agent")).toBeVisible();
  const avatarBox = await reply.locator(".message-avatar").boundingBox();
  const textBox = await reply
    .locator("[data-markdown-message] > :first-child")
    .boundingBox();
  expect(Math.abs(avatarBox!.y - textBox!.y)).toBeLessThan(3);
  expect(
    await prompt.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).toBe("rgb(239, 235, 248)");
  const stopped = page
    .getByRole("status")
    .filter({ hasText: "Request stopped" });
  await expect(stopped).toContainText(
    "You can continue with a new message below.",
  );
  expect(
    await stopped.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).toBe("rgb(245, 242, 252)");
  await expect(stopped.locator("svg")).toHaveCount(0);
  expect(
    await stopped.evaluate((element) => getComputedStyle(element).textAlign),
  ).toBe("center");
  const navigator = page.getByRole("navigation", { name: "Prompt history" });
  const bars = navigator.getByRole("button");
  await expect(bars).toHaveCount(2);
  await bars.first().hover();
  const menu = page.getByRole("menu", { name: "User prompts" });
  await expect(menu.getByRole("menuitem")).toHaveCount(2);
  expect(
    await menu
      .getByRole("menuitem")
      .first()
      .locator("span")
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("14px");
  await page.screenshot({
    path: `.nimbus/chat-prompt-menu-${test.info().project.name}.png`,
  });
  await menu.getByRole("menuitem").first().click();
  await expect(page.locator(".user-message").first()).toBeFocused();
  await expect(bars.first()).toHaveAttribute("aria-current", "step");
  await bars.last().click();
  await menu
    .getByRole("menuitem", { name: /Explain the cancellation flow/ })
    .click();
  await expect(prompt).toBeFocused();
  await expect(bars.last()).toHaveAttribute("aria-current", "step");
  const promptBox = await prompt.boundingBox(),
    barBox = await navigator.boundingBox();
  expect(promptBox!.x + promptBox!.width).toBeLessThan(barBox!.x);
  const scroll = page.locator(".conversation-scroll");
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.getByRole("button", { name: "Back to prompt" }),
  ).toHaveCount(0);
  await scroll.evaluate((element) => {
    element.scrollTop = 0;
  });
  const latest = page.getByRole("button", { name: "Jump to latest message" });
  await expect(latest).toBeVisible();
  const box = await latest.boundingBox(),
    pane = await page.locator(".conversation-pane").boundingBox();
  expect(
    Math.abs(box!.x + box!.width / 2 - (pane!.x + pane!.width / 2)),
  ).toBeLessThan(2);
  await latest.click();
  await expect(latest).toHaveCount(0);
  await bars.first().click();
  await page.getByRole("textbox", { name: "Follow-up message" }).click();
  await expect(menu).toHaveCount(0);
  await page.screenshot({
    path: `.nimbus/chat-navigation-${test.info().project.name}.png`,
    fullPage: true,
  });
});
