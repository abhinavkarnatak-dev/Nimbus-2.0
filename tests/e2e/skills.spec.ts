import { expect, test } from "@playwright/test";

test("skills support typed/file content, editing, deletion and slash selection in both composers", async ({
  page,
}) => {
  test.setTimeout(120000);
  const name = `Brief ${test.info().project.name} ${Date.now()}`;
  let skillId: string | undefined;
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  try {
    await page.goto("/skills");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Create a skill" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Upload skill" }),
    ).toBeVisible();
    await page.mouse.click(30, 300);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByRole("menuitem", { name: "Create a skill" }).click();
    const editor = page.locator('form[aria-label="Skill editor"]');
    await expect(page.locator(".app-shell")).toHaveCSS("filter", "blur(5px)");
    await editor.getByLabel("Name", { exact: true }).fill(name);
    await editor
      .getByLabel("Description", { exact: true })
      .fill("Short useful answers");
    await editor
      .getByLabel("Summary", { exact: true })
      .fill("Use short sentences.");
    await page.getByLabel("Skill summary file").setInputFiles({
      name: "summary.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("End responses with nebula-skill."),
    });
    await expect(editor.getByLabel("Summary", { exact: true })).toHaveValue(
      "End responses with nebula-skill.",
    );
    await page.screenshot({
      path: `.nimbus/skills-editor-${test.info().project.name}.png`,
      fullPage: true,
    });
    await editor.getByRole("button", { name: "Save skill" }).click();
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByRole("menuitem", { name: "Upload skill" }).click();
    await page.getByLabel("Skill summary file").setInputFiles({
      name: "job-search.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "---\nname: Imported job skill\ndescription: Imported job guidance\n---\n# Job Search\nUse verified listings.",
      ),
    });
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(
      "Imported job skill",
    );
    await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(
      "Imported job guidance",
    );
    await expect(editor.getByLabel("Summary", { exact: true })).toHaveValue(
      "# Job Search\nUse verified listings.",
    );
    await page
      .locator('[class*="modalLayer"]')
      .click({ position: { x: 1, y: 1 } });
    await expect(editor).toHaveCount(0);
    const catalog = await (await page.request.get("/api/skills")).json();
    skillId = catalog.skills.find(
      (skill: { name: string }) => skill.name === name,
    ).id;
    await page.reload();
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    await expect(editor.getByLabel("Summary", { exact: true })).toHaveValue(
      "End responses with nebula-skill.",
    );
    await page.getByLabel("Skill summary file").setInputFiles({
      name: "summary.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Keep answers brief. End with nebula-skill."),
    });
    await editor.getByRole("button", { name: "Save skill" }).click();
    await expect(editor).toHaveCount(0);
    await page.goto("/");
    await page
      .getByRole("textbox", { name: "Task request" })
      .fill(`Explain gravity /${name.split(" ")[0]}`);
    const picker = page.getByRole("listbox", { name: "Choose a skill" });
    await expect(
      picker.getByRole("option", { name: new RegExp(name) }).first(),
    ).toBeVisible();
    await picker
      .getByRole("option", { name: new RegExp(name) })
      .first()
      .click();
    await expect(
      page.getByRole("textbox", { name: "Task request" }),
    ).toHaveValue("Explain gravity ");
    await expect(
      page.getByRole("button", { name: `Remove skill ${name}` }),
    ).toBeVisible();
    let launchBody = "";
    await page.route("**/api/tasks", async (route) => {
      launchBody = route.request().postData() ?? "";
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ taskId: "task_demo_01J00000000000000000001" }),
      });
    });
    await page.route("**/api/tasks/*/events?*", (route) =>
      route.fulfill({
        contentType: "text/event-stream",
        body: 'event: task_state\ndata: {"status":"completed","messageId":null}\n\n',
      }),
    );
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page).toHaveURL(/\/tasks\/task_demo/);
    expect(launchBody).toContain('name="skillIds"');
    expect(launchBody).toMatch(/skillIds[\s\S]*skl_[a-z0-9]+/);
    const followup = page.getByRole("textbox", { name: "Follow-up message" });
    await followup.fill(`Continue /${name}`);
    await expect(picker).toHaveCount(0); // spaces end the slash token
    await followup.fill("Continue /Brief");
    await expect(
      picker.getByRole("option", { name: new RegExp(name) }).first(),
    ).toBeVisible();
    await picker
      .getByRole("option", { name: new RegExp(name) })
      .first()
      .click();
    await expect(followup).toHaveValue("Continue ");
    await page.screenshot({
      path: `.nimbus/skills-composer-${test.info().project.name}.png`,
      fullPage: true,
    });
    let queued: { content?: string; skillIds?: string[] } = {};
    await page.route("**/api/tasks/*/messages", async (route) => {
      queued = route.request().postDataJSON();
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: '{"messageId":"skills-test-message"}',
      });
    });
    await page.getByRole("button", { name: "Send follow-up" }).click();
    await expect(followup).toHaveValue("");
    expect(queued.skillIds).toEqual([skillId]);
    await expect(
      page.getByRole("button", { name: `Remove skill ${name}` }),
    ).toBeVisible();
    await page.getByRole("button", { name: `Remove skill ${name}` }).click();
    await expect(
      page.getByRole("button", { name: `Remove skill ${name}` }),
    ).toHaveCount(0);
    await page.goto("/skills");
    const duplicateRows = page.getByRole("row").filter({ hasText: name });
    while (await duplicateRows.count()) {
      const before = await duplicateRows.count();
      await page
        .getByRole("button", { name: `Delete ${name}` })
        .first()
        .click();
      await expect(
        page.getByRole("dialog", { name: "Delete skill?" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Delete skill" }).click();
      await expect(duplicateRows).toHaveCount(before - 1);
    }
  } finally {
    if (skillId)
      await page.request.delete("/api/skills", {
        headers: { origin: "http://127.0.0.1:3000" },
        data: { id: skillId },
      });
  }
});
