import { expect, test } from "@playwright/test";

test("connection cards use clear status labels, local logos, and distinct actions", async ({
  page,
}, testInfo) => {
  await page.goto("http://localhost:3000/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("http://localhost:3000/settings#connections");
  const cards = page.locator(".connection-card");
  await expect(cards).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: /^(Slack|Gmail|Notion|Twilio)$/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "Codex logo", exact: true }),
  ).toHaveAttribute("src", "/integrations/codex.png");
  await expect(cards.nth(1).locator(".connection-logo")).toHaveCSS(
    "width",
    "48px",
  );
  await expect(cards.first()).toHaveCSS("display", "grid");
  await expect(
    page.getByText("Local connection only.", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByText("This does not switch the task executor", { exact: false }),
  ).toHaveCount(0);
  if (testInfo.project.name === "desktop-chromium") {
    const buttons = await cards
      .locator(".connection-card-footer > .connection-action")
      .all();
    const positions = await Promise.all(
      buttons.map((button) => button.boundingBox()),
    );
    expect(Math.abs(positions[0]!.y - positions[1]!.y)).toBeLessThanOrEqual(1);
  }
  for (const card of await cards.all()) {
    const logo = card.getByRole("img");
    await expect(logo).toHaveAttribute(
      "src",
      /^\/integrations\/.+\.(svg|png)$/,
    );
    await expect
      .poll(() =>
        logo.evaluate((element) => (element as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(card.locator(".connection-status")).toHaveText(
      /^(Active|Not Connected|Suspended|Connecting|Access Revoked|Connection Failed|Unavailable)$/,
    );
  }
  for (const badge of await page
    .locator(".connection-status-disconnected")
    .all()) {
    await expect(badge).toHaveCSS("color", "rgb(164, 48, 57)");
  }
  for (const badge of await page
    .locator(".connection-status-connected")
    .all()) {
    await expect(badge).toHaveCSS("color", "rgb(18, 100, 69)");
  }
  for (const button of await page
    .getByRole("button", { name: "Configuration Required" })
    .all()) {
    await expect(button).toBeDisabled();
    await expect(button).toHaveClass(/connection-action-unavailable/);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `.nimbus/connections-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("GitHub uses one Connect GitHub action to start repository selection", async ({
  page,
}) => {
  await page.goto("http://localhost:3000/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("http://localhost:3000/settings#connections");
  const card = page.locator(".connection-card").filter({
    has: page.getByRole("heading", { name: "GitHub App", exact: true }),
  });
  const connect = card.getByRole("button", {
    name: /^(Connect|Reconnect) GitHub$/,
  });
  test.skip(
    (await connect.count()) === 0,
    "GitHub App configuration is not supplied in this environment",
  );
  await expect(card.getByRole("link", { name: /Install/ })).toHaveCount(0);
  let installationUrl: string | undefined;
  await page.route("**/api/github/connect", async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    expect(response.status()).toBe(303);
    installationUrl = response.headers().location;
    expect(response.headers()["content-security-policy"]).toContain(
      "form-action 'self' https://github.com",
    );
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<h1>Simulated GitHub repository selection</h1>",
    });
  });
  await connect.click();
  await expect
    .poll(() => installationUrl)
    .toMatch(
      /^https:\/\/github\.com\/apps\/[^/]+\/installations\/new\?state=[A-Za-z0-9_-]+$/,
    );
  await expect(
    page.getByRole("heading", {
      name: "Simulated GitHub repository selection",
    }),
  ).toBeVisible();
});
