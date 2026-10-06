import { expect, test } from "@playwright/test";

test("Codex connection displays device code, detects sign-in, and disconnects", async ({
  page,
}) => {
  let connected = false;
  let pending = false;
  await page.route("**/api/codex/device", async (route) => {
    if (route.request().method() === "POST") pending = true;
    if (route.request().method() === "DELETE") {
      pending = false;
      connected = false;
    }
    await route.fulfill({
      json: connected
        ? {
            status: "connected",
            account: { email: "test@example.invalid", planType: "plus" },
            models: [{ id: "model-from-codex" }],
          }
        : pending
          ? {
              status: "pending",
              verificationUrl: "https://auth.openai.com/codex/device",
              userCode: "TEST-1234",
            }
          : { status: "disconnected" },
    });
  });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/settings#connections");
  await page.getByRole("button", { name: "Connect to Codex" }).click();
  await expect(page.getByText("TEST-1234", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Codex sign-in" }),
  ).toHaveAttribute("href", "https://auth.openai.com/codex/device");
  await page.reload();
  await expect(page.getByText("TEST-1234", { exact: true })).toBeVisible();
  connected = true;
  await expect(
    page.getByRole("button", { name: "Disconnect Codex" }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("model-from-codex", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Disconnect Codex" }).click();
  await expect(
    page.getByRole("button", { name: "Connect to Codex" }),
  ).toBeVisible();
});

test("task input loads account models and switches supported thinking efforts", async ({
  page,
}, testInfo) => {
  const models = [
    {
      id: "from-account-a",
      label: "Account model A",
      isDefault: true,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Fast" },
        { reasoningEffort: "high", description: "Thorough" },
      ],
    },
    {
      id: "from-account-b",
      label: "Account model B",
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [
        { reasoningEffort: "medium", description: "Balanced" },
      ],
    },
  ];
  await page.route("**/api/codex/models", (route) =>
    route.fulfill({ json: { models } }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  const model = page.getByRole("combobox", { name: "Codex model" });
  const effort = page.getByRole("slider", { name: "Thinking effort" });
  await expect(
    page.getByRole("button", {
      name: "Model and thinking effort",
      exact: true,
    }),
  ).toContainText("Account model A");
  await page
    .getByRole("button", { name: "Model and thinking effort", exact: true })
    .click();
  await expect(model).toHaveValue("from-account-a");
  await expect(effort).toHaveAttribute("aria-valuetext", "high");
  await page.screenshot({
    path: testInfo.outputPath("model-effort-dropdown.png"),
  });
  await expect(model.locator("option")).toHaveCount(2);
  await effort.focus();
  await effort.press("ArrowLeft");
  await expect(effort).toHaveAttribute("aria-valuetext", "low");
  await expect(page.locator('input[name="reasoningEffort"]')).toHaveValue(
    "low",
  );
  await model.selectOption("from-account-b");
  await expect(effort).toHaveAttribute("aria-valuetext", "medium");
  await expect(effort).toBeDisabled();
  await model.press("Escape");
  await expect(model).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: "Model and thinking effort",
      exact: true,
    }),
  ).toBeFocused();
  await page.reload();
  await page
    .getByRole("button", { name: "Model and thinking effort", exact: true })
    .click();
  await expect(model).toHaveValue("from-account-a");
  await page.goto("/tasks/new");
  await expect(page).toHaveURL(/\/$/);
  await page
    .getByRole("button", { name: "Model and thinking effort", exact: true })
    .click();
  await expect(model).toHaveValue("from-account-a");
  await expect(effort).toHaveAttribute("aria-valuetext", "high");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
