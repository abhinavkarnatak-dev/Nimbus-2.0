import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { artifactMimeType } from "../../apps/web/lib/artifact-policy";
test("a PDF chat reference opens Artifacts and downloads the actual attachment", async ({
  page,
  context,
}) => {
  const taskId = "task_b5226f5fb0ae4a9cae658f1e0a9feec4";
  const name = "reports/Agent overview.pdf";
  const pdf = Buffer.from("%PDF-1.4\nfixture\n%%EOF\n");
  let rejectDownload = false;
  const artifact = {
    id: "art-pdf-fixture",
    name,
    mimeType: "application/pdf",
    sizeBytes: 42,
    checksum: "a".repeat(64),
    createdAt: "2026-10-06T00:00:00Z",
  };
  const event = {
    id: "pdf-artifact-message",
    sequence: 19001,
    timestamp: "2026-10-06T00:00:00Z",
    category: "agent_message",
    title: "PDF ready",
    whatWasDone: `[Download report](<C:/Users/example/Nimbus 2.0/.nimbus/workspaces/${taskId}/${name}>)`,
    whyItWasDone: "",
    status: "succeeded",
    phase: "completed",
  };
  await page.route("**/api/tasks/*/events?*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `event: task_state\ndata: {"status":"completed"}\n\nid: 19001\nevent: task_event\ndata: ${JSON.stringify(event)}\n\n`,
    }),
  );
  await context.route("**/api/tasks/*/artifacts*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("download") && rejectDownload)
      return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    if (url.searchParams.has("download"))
      return route.fulfill({
        body: pdf,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="Agent overview.pdf"',
        },
      });
    return route.fulfill({ json: { artifacts: [artifact] } });
  });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto(`/tasks/${taskId}`);
  await page.getByRole("button", { name: "Close task workbench" }).click();
  const reference = page.getByRole("link", {
    name: `Open ${name} in Artifacts`,
  });
  await expect(reference).toBeVisible();
  expect(
    await reference.evaluate(
      (element) => getComputedStyle(element).textDecorationLine,
    ),
  ).toBe("none");
  await reference.click();
  await expect(page).toHaveURL(/tab=artifacts/);
  expect(new URL(page.url()).searchParams.get("tab")).toBe("artifacts");
  const panel = page.getByRole("region", { name: "Task artifacts" });
  await expect(
    panel.locator(".workspace-panel-header > div > span"),
  ).toHaveText("Task outputs");
  expect(
    await panel
      .locator("h2")
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("14px");
  expect(
    await panel
      .locator("[data-workbench-content]")
      .evaluate((element) => getComputedStyle(element).paddingLeft),
  ).toBe("17px");
  await expect(panel.getByText(name, { exact: true })).toBeVisible();
  await expect(panel.getByText("(42 B)", { exact: true })).toBeVisible();
  await expect(panel.locator("time")).toHaveAttribute(
    "datetime",
    artifact.createdAt,
  );
  await expect(panel.getByText(/SHA-256|application\/pdf|Saved /)).toHaveCount(
    0,
  );
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: `Download ${name}` }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toBe("Agent overview.pdf");
  expect(await readFile((await downloaded.path())!)).toEqual(pdf);
  rejectDownload = true;
  await panel.getByRole("button", { name: `Download ${name}` }).click();
  await expect(panel.getByRole("alert")).toHaveText(
    "Could not download this file. Please retry.",
  );
  await page.reload();
  await expect(
    panel.getByRole("button", { name: `Download ${name}` }),
  ).toBeVisible();
  await page.goto(
    `/tasks/${taskId}?tab=files&file=${encodeURIComponent(name)}`,
  );
  await expect(panel).toBeVisible();
  expect(new URL(page.url()).searchParams.get("tab")).toBe("artifacts");
});

test("Artifacts downloads Office, text, code and unknown binary outputs", async ({
  page,
  context,
}) => {
  const taskId = "task_b5226f5fb0ae4a9cae658f1e0a9feec4";
  const names = [
    "Budget.xlsx",
    "Report.docx",
    "Presentation.pptx",
    "Summary.md",
    "main.py",
    "result.custom",
  ];
  const bytes = Buffer.from([0, 255, 1, 2, 3]);
  const outputs = names.map((name, index) => ({
    id: `generic-artifact-${index}`,
    name,
    mimeType: artifactMimeType(name),
    sizeBytes: bytes.length,
    checksum: "b".repeat(64),
    createdAt: "2026-10-06T00:00:00Z",
  }));
  await context.route("**/api/tasks/*/artifacts*", (route) => {
    const id = new URL(route.request().url()).searchParams.get("download");
    if (id)
      return route.fulfill({
        body: bytes,
        contentType: outputs.find((output) => output.id === id)!.mimeType,
      });
    return route.fulfill({ json: { artifacts: outputs } });
  });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto(`/tasks/${taskId}?tab=artifacts`);
  const panel = page.getByRole("region", { name: "Task artifacts" });
  for (const name of names) {
    const download = page.waitForEvent("download");
    await panel
      .getByRole("button", { name: `Download ${name}`, exact: true })
      .click();
    const result = await download;
    expect(result.suggestedFilename()).toBe(name);
    expect(await readFile((await result.path())!)).toEqual(bytes);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("artifact preparation never shows the file list until fetching finishes, including refresh", async ({
  page,
  context,
}) => {
  let release = () => {};
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const artifact = {
    id: "loading-artifact",
    name: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 5050,
    checksum: "c".repeat(64),
    createdAt: "2026-10-06T00:00:00Z",
  };
  await context.route("**/api/tasks/*/artifacts*", async (route) => {
    await gate;
    await route.fulfill({ json: { artifacts: [artifact] } });
  });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto("/tasks/task_b5226f5fb0ae4a9cae658f1e0a9feec4?tab=artifacts");
  const panel = page.getByRole("region", { name: "Task artifacts" });
  await expect(panel.getByRole("status")).toHaveText("Preparing downloads...");
  const spinner = panel.getByRole("status").locator("svg");
  await expect(spinner).toBeVisible();
  expect(
    await spinner.evaluate(
      (element) => getComputedStyle(element).animationDuration,
    ),
  ).toBe("1s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await spinner.evaluate(
      (element) => getComputedStyle(element).animationName,
    ),
  ).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(panel.locator("article")).toHaveCount(0);
  release();
  await expect(panel.getByText("report.pdf", { exact: true })).toBeVisible();
  await expect(panel.getByRole("status")).toHaveCount(0);
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await panel.getByRole("button", { name: "Refresh artifacts" }).click();
  await expect(panel.getByRole("status")).toBeVisible();
  await expect(spinner).toBeVisible();
  await expect(panel.locator("article")).toHaveCount(0);
  release();
  await expect(panel.getByText("report.pdf", { exact: true })).toBeVisible();
  await expect(panel.getByRole("status")).toHaveCount(0);
});
