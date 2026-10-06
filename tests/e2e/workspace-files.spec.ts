import { expect, test } from "@playwright/test";
test("file tree and source loading show circular loaders only while pending", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tasks/*/files?*", async (route) => {
    await pending;
    const operation = new URL(route.request().url()).searchParams.get(
      "operation",
    );
    await route.fulfill({
      json:
        operation === "tree"
          ? {
              entries: [{ name: "README.md", path: "README.md", kind: "file" }],
            }
          : { content: "Example source" },
    });
  });
  try {
    await page.goto(
      "/tasks/task_demo_01J00000000000000000001?tab=files&file=README.md",
    );
    const panel = page.getByRole("region", { name: "Repository files" });
    for (const text of ["Loading files...", "Loading file..."]) {
      const status = panel.getByRole("status").filter({ hasText: text });
      await expect(status.locator("svg")).toBeVisible();
      expect(
        await status
          .locator("svg")
          .evaluate((element) => getComputedStyle(element).animationDuration),
      ).toBe("1s");
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await panel
        .getByRole("status")
        .first()
        .locator("svg")
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("none");
    release();
    await expect(panel.getByRole("status")).toHaveCount(0);
    await expect(panel.getByLabel("Contents of README.md")).toContainText(
      "Example source",
    );
  } finally {
    release();
  }
});
test("chat file references reopen Files with tree, source, line, history, and refresh persistence", async ({
  page,
}) => {
  const taskId = "task_b5226f5fb0ae4a9cae658f1e0a9feec4";
  const revision = "a".repeat(40);
  const examples = [
    ["Sandbox quickstart", "examples/sandbox-quickstart-ts/index.ts"],
    ["Python code interpreter", "examples/sandbox-code-interpreter-py/main.py"],
    ["Public port preview", "examples/sandbox-port-preview-ts/index.ts"],
  ];
  const event = {
    id: "file-link-event",
    sequence: 15001,
    timestamp: "2026-10-06T01:21:00Z",
    category: "agent_message",
    title: "Report",
    whatWasDone: `Read [README.md](<C:/work/.nimbus/workspaces/${taskId}/README.md:2>).\n\n${examples.map(([label, path]) => `- [${label}](<C:/Users/abhis/Downloads/AK-Dev/AI/Projects/Nimbus 2.0/.nimbus/workspaces/${taskId}/${path}>)`).join("\n")}`,
    whyItWasDone: "",
    phase: "completed",
    status: "succeeded",
  };
  await page.route("**/api/tasks/*/events?*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `event: task_state\ndata: {"status":"completed"}\n\nid: 15001\nevent: task_event\ndata: ${JSON.stringify(event)}\n\n`,
    }),
  );
  await page.route("**/api/tasks/*/files?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("operation") === "tree")
      return route.fulfill({
        json: {
          entries:
            query.get("path") === "src"
              ? [
                  {
                    name: "unchanged.ts",
                    path: "src/unchanged.ts",
                    kind: "file",
                  },
                ]
              : [
                  { name: "src", path: "src", kind: "directory" },
                  { name: "README.md", path: "README.md", kind: "file" },
                ],
        },
      });
    if (query.get("operation") === "history")
      return route.fulfill({
        json: {
          entries: [
            {
              revision: query.get("offset") === "0" ? revision : "b".repeat(40),
              date: "2026-10-05T10:00:00Z",
              author: "Developer",
              subject: "Original source",
              path: query.get("path"),
            },
          ],
          nextOffset: query.get("offset") === "0" ? 25 : null,
        },
      });
    return route.fulfill({
      json: {
        content: query.get("revision")
          ? "old contents\noriginal line"
          : query.get("path") === "README.md"
            ? "# Sandbox\nQuick start\nReal repository files"
            : "export const unchanged = true;",
      },
    });
  });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Enter local development workspace" })
    .click();
  await page.goto(`/tasks/${taskId}`);
  await page.getByRole("button", { name: "Close task workbench" }).click();
  await page.getByRole("link", { name: "Open README.md:2 in Files" }).click();
  await expect(page).toHaveURL(/tab=files.*file=README.md.*line=2/);
  const files = page.getByRole("region", { name: "Repository files" });
  await expect(files).toBeVisible();
  const contents = files.getByLabel("Contents of README.md");
  await expect(contents).toContainText("Quick start");
  expect(
    await contents
      .locator("div")
      .filter({ hasText: "Quick start" })
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");
  await page.reload();
  await expect(contents).toContainText("Real repository files");
  await files.getByRole("button", { name: "History", exact: true }).click();
  await files.getByRole("button", { name: "Load more history" }).click();
  await expect(
    files.getByRole("button", { name: "Load more history" }),
  ).toHaveCount(0);
  await files
    .getByRole("button", { name: /Original source/ })
    .first()
    .click();
  await expect(contents).toContainText("old contents");
  await files.getByRole("button", { name: "Current file" }).click();
  await expect(contents).toContainText("Quick start");
  const tree = files.getByRole("navigation", {
    name: "Repository file structure",
  });
  await tree.getByRole("button", { name: "src", exact: true }).click();
  await tree.getByRole("button", { name: "unchanged.ts" }).click();
  await expect(files.getByLabel("Contents of src/unchanged.ts")).toContainText(
    "export const unchanged = true;",
  );
  await files.getByRole("button", { name: "Refresh workspace files" }).click();
  await expect(files.getByLabel("Contents of src/unchanged.ts")).toContainText(
    "unchanged",
  );
  for (const [label, path] of examples) {
    const link = page
      .locator(".conversation-scroll a")
      .filter({ hasText: label! });
    await expect(link).toHaveAttribute(
      "href",
      `/tasks/${taskId}?tab=files&file=${encodeURIComponent(path!)}`,
    );
    await page.getByRole("button", { name: "Close task workbench" }).click();
    await link.click();
    await expect(files).toBeVisible();
    await expect(files.getByLabel(`Contents of ${path}`)).toContainText(
      "export const unchanged",
    );
    expect(new URL(page.url()).searchParams.get("file")).toBe(path);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
