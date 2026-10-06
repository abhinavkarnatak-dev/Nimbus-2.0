import { expect, test } from "@playwright/test";

test("instructions import, save, reload and clear persist for the signed-in user", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/settings");
  await expect(
    page.getByRole("textbox", { name: "General instructions", exact: true }),
  ).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "Workspace", exact: true });
  for (const [label, icon] of [
    ["Skills", "book-text"],
    ["Memory", "brain"],
    ["Usage", "gauge"],
    ["Instructions", "scroll-text"],
  ]) {
    await expect(
      nav
        .getByRole("link", { name: label, exact: true, includeHidden: true })
        .locator(`svg.lucide-${icon}`),
    ).toHaveCount(1);
  }
  await nav.getByRole("link", { name: "Instructions", exact: true }).click();
  await expect(page).toHaveURL(/\/instructions$/);
  await expect(
    page.getByRole("heading", { name: "Instructions", exact: true }),
  ).toBeVisible();
  const original = await (await page.request.get("/api/instructions")).json();
  const origin = new URL(page.url()).origin;
  const editor = page.getByRole("textbox", {
    name: "General instructions",
    exact: true,
  });
  const section = page.getByRole("region", {
    name: "Instructions",
    exact: true,
  });
  try {
    await expect(editor).toHaveValue(original.content);
    await editor.fill("Use hyphens only, never en or em dashes.");
    await section
      .getByRole("button", { name: "Save instructions", exact: true })
      .click();
    await expect(section.getByRole("status")).toContainText("Saved.");
    await page.reload();
    await expect(editor).toHaveValue(
      "Use hyphens only, never en or em dashes.",
    );
    const upload = page.getByLabel("Upload instructions file");
    await upload.setInputFiles({
      name: "preferences.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Preferences\nUse hyphens only.\nKeep replies concise.",
      ),
    });
    await expect(editor).toHaveValue(
      "# Preferences\nUse hyphens only.\nKeep replies concise.",
    );
    await expect(section.getByRole("status")).toContainText("Save to apply");
    await section
      .getByRole("button", { name: "Save instructions", exact: true })
      .click();
    await expect(section.getByRole("status")).toContainText("Saved.");
    await page.reload();
    await expect(editor).toHaveValue(
      "# Preferences\nUse hyphens only.\nKeep replies concise.",
    );
    await upload.setInputFiles({
      name: "preferences.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Plain text instructions."),
    });
    await expect(editor).toHaveValue("Plain text instructions.");
    await upload.setInputFiles({
      name: "unsafe.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("unsafe"),
    });
    await expect(section.getByRole("alert")).toHaveText(
      "Choose an MD or TXT file.",
    );
    await expect(editor).toHaveValue("Plain text instructions.");
    await upload.setInputFiles({
      name: "binary.txt",
      mimeType: "text/plain",
      buffer: Buffer.from([0, 1, 2]),
    });
    await expect(section.getByRole("alert")).toContainText("plain UTF-8");
    await section.getByRole("button", { name: "Clear", exact: true }).click();
    await section
      .getByRole("button", { name: "Save instructions", exact: true })
      .click();
    await expect(section.getByRole("status")).toContainText("cleared");
    await page.reload();
    await expect(editor).toHaveValue("");
    const forbidden = await page.request.put("/api/instructions", {
      headers: { origin: "https://hostile.invalid" },
      data: { content: "Injected" },
    });
    expect(forbidden.status()).toBe(403);
    const tooLong = await page.request.put("/api/instructions", {
      headers: { origin },
      data: { content: "x".repeat(20_001) },
    });
    expect(tooLong.status()).toBe(400);
    expect(
      (await (await page.request.get("/api/instructions")).json()).content,
    ).toBe("");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    const restored = await page.request.put("/api/instructions", {
      headers: { origin },
      data: { content: original.content },
    });
    expect(restored.ok()).toBe(true);
  }
});

test("instructions API requires authentication", async ({ request }) => {
  expect((await request.get("/api/instructions")).status()).toBe(401);
  expect(
    (
      await request.put("/api/instructions", {
        data: { content: "Not signed in" },
      })
    ).status(),
  ).toBe(401);
});
