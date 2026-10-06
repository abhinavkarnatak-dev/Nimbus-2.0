import { expect, test } from "@playwright/test";

test("default model is account-listed GPT-5.6 Sol with medium effort", async ({
  page,
}) => {
  await page.route("**/api/codex/models", (route) =>
    route.fulfill({
      json: {
        models: [
          { id: "gpt-6-sol", label: "GPT-6-Sol", isDefault: true },
          {
            id: "gpt-5.6-sol",
            label: "GPT-5.6-Sol",
            isDefault: false,
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Fast" },
              { reasoningEffort: "medium", description: "Balanced" },
            ],
          },
        ],
      },
    }),
  );
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Model and thinking effort",
      exact: true,
    }),
  ).toContainText("GPT-5.6-Sol");
  await expect(page.locator('input[name="reasoningEffort"]')).toHaveValue(
    "medium",
  );
  await page.reload();
  await expect(page.locator('input[name="model"]')).toHaveValue("gpt-5.6-sol");
  await expect(page.locator('input[name="reasoningEffort"]')).toHaveValue(
    "medium",
  );
});

test("limit cards stay in place when refresh returns reversed buckets", async ({
  page,
}) => {
  let reverse = true;
  await page.route("**/api/codex/usage", (route) => {
    const limits = [
      { id: "codex", name: "codex" },
      { id: "base_model_inference", name: "gpt-reserve" },
    ].map((bucket) => ({
      ...bucket,
      primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null },
      secondary: null,
      credits: null,
      planType: null,
      reachedType: null,
    }));
    return route.fulfill({
      json: {
        status: "available",
        limits: reverse ? limits.reverse() : limits,
      },
    });
  });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/usage");
  const names = page.locator(".codex-limit-title h3");
  await expect(names).toHaveText(["codex", "gpt-reserve"]);
  reverse = false;
  await page.getByRole("button", { name: "Refresh limits" }).click();
  await expect(names).toHaveText(["codex", "gpt-reserve"]);
});
