import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(resolve("apps/web/package.json"));
const { zipSync, strToU8 } =
  require("fflate") as typeof import("../../apps/web/node_modules/fflate");
const taskId = "task_00000000000000000000000000000abc";
const databaseRequire = createRequire(
  resolve("packages/database/package.json"),
);
let fixtureSql: ReturnType<
  typeof import("../../packages/database/node_modules/postgres").default
>;
test.beforeAll(async () => {
  if (process.env.NIMBUS_ATTACHMENT_E2E !== "true") return;
  if (
    !/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):/.test(
      process.env.DATABASE_URL ?? "",
    )
  )
    throw new Error(
      "Attachment E2E requires a disposable localhost DATABASE_URL.",
    );
  fixtureSql = databaseRequire("postgres")(process.env.DATABASE_URL, {
    max: 1,
    prepare: false,
  });
  await fixtureSql`INSERT INTO tasks(id,organization_id,created_by_user_id,title,objective,base_ref,status,requested_model) VALUES(${taskId},'org_local_01J000000000000000000001','usr_local_01J000000000000000000001','Attachment UI fixture','Attachment UI fixture','main','completed','fake-codex-test-provider') ON CONFLICT DO NOTHING`;
  await fixtureSql`INSERT INTO task_messages(id,task_id,user_id,content,status,idempotency_key) VALUES('msg_attachment_ui_fixture',${taskId},'usr_local_01J000000000000000000001','Attachment UI fixture','completed','attachment-ui-fixture') ON CONFLICT DO NOTHING`;
});
test.afterAll(async () => {
  if (fixtureSql) {
    await fixtureSql`DELETE FROM tasks WHERE id=${taskId}`;
    await fixtureSql.end();
  }
});
function pdf(text: string) {
  const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
const mixed = [
  {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("attachment text fixture"),
  },
  {
    name: "code.ts",
    mimeType: "text/plain",
    buffer: Buffer.from("export const attachment = true;"),
  },
  {
    name: "data.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,value\nattachment,42"),
  },
  {
    name: "word.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(
      zipSync({
        "word/document.xml": strToU8(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word attachment fixture</w:t></w:r></w:p></w:body></w:document>',
        ),
      }),
    ),
  },
  {
    name: "excel.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(
      zipSync({
        "xl/workbook.xml": strToU8(
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Fixture" sheetId="1"/></sheets></workbook>',
        ),
        "xl/worksheets/sheet1.xml": strToU8(
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Excel attachment fixture</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>',
        ),
      }),
    ),
  },
  {
    name: "report.pdf",
    mimeType: "application/pdf",
    buffer: pdf("PDF attachment fixture"),
  },
];
async function setup(page: Page, followup = false) {
  test.skip(
    process.env.NIMBUS_ATTACHMENT_E2E !== "true",
    "Use the isolated attachment fixture database, never a live account",
  );
  await page.request.post("/api/auth/local");
  const text = new Map<string, string>();
  const names = new Map<string, string>();
  let sequence = 0;
  await page.route("**/api/attachments**", async (route) => {
    if (route.request().method() !== "POST")
      return route.fulfill({
        json: { files: [], removed: true, initialMessageId: null },
      });
    const input = route.request().postDataJSON();
    if (input.action === "finish")
      return route.fulfill({ json: { id: input.id } });
    const uploads = input.files.map((file: { name: string }) => {
      const id = `att_${(++sequence).toString(16).padStart(32, "0")}`;
      names.set(id, file.name);
      return {
        id,
        url: `http://127.0.0.1:3000/__attachment-fixture/${id}/original`,
        textUrl: `http://127.0.0.1:3000/__attachment-fixture/${id}/text`,
      };
    });
    await route.fulfill({ json: { uploads } });
  });
  await page.route("**/__attachment-fixture/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/");
    if (path.at(-1) === "text")
      text.set(
        names.get(path.at(-2)!)!,
        route.request().postDataBuffer()!.toString("utf8"),
      );
    await route.fulfill({ status: 200, body: "" });
  });
  await page.goto(followup ? `/tasks/${taskId}` : "/");
  await expect(page.getByLabel("Attach files", { exact: true })).toBeAttached();
  return text;
}
test("images preview inside both composers before sending", async ({
  page,
}) => {
  for (const followup of [false, true]) {
    await setup(page, followup);
    await page.getByLabel("Attach files", { exact: true }).setInputFiles({
      name: "thumbnail.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0KsAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    const thumbnail = page.getByRole("img", {
      name: "Preview of thumbnail.png",
      exact: true,
    });
    await expect(thumbnail).toBeVisible();
    await expect
      .poll(() =>
        thumbnail.evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(page.locator('input[name="attachmentIds"]')).toHaveValue(
      /att_/,
      { timeout: 60000 },
    );
    await page.getByRole("button", { name: "Remove thumbnail.png" }).click();
    await expect(thumbnail).toHaveCount(0);
  }
});

test("long skill descriptions stay compact in the catalog and slash picker", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.NIMBUS_ATTACHMENT_E2E !== "true",
    "Disposable database only",
  );
  const id = "skl_compact_description_fixture";
  const description =
    "Iteratively improves a pull request until review comments are resolved. ".repeat(
      6,
    );
  await page.request.post("/api/auth/local");
  await fixtureSql`INSERT INTO skills(id,organization_id,owner_user_id,slug,name,description,summary) VALUES(${id},'org_local_01J000000000000000000001','usr_local_01J000000000000000000001','compact-greploop','greploop',${description},'Review pull requests')`;
  try {
    await page.goto("/skills");
    const row = page.getByRole("row").filter({
      has: page.getByRole("button", { name: "Edit greploop", exact: true }),
    });
    await expect(row.locator("strong")).toHaveCSS("white-space", "nowrap");
    const summary = row.locator("td").nth(1).locator("span");
    await expect(summary).toHaveAttribute("title", description);
    await expect(summary).toHaveCSS("-webkit-line-clamp", "2");
    const edit = (await row
      .getByRole("button", { name: "Edit greploop" })
      .boundingBox())!;
    const remove = (await row
      .getByRole("button", { name: "Delete greploop" })
      .boundingBox())!;
    expect(Math.abs(edit.y - remove.y)).toBeLessThan(2);
    await page.screenshot({ path: testInfo.outputPath("compact-skills.png") });
    await page.goto("/");
    await page.getByLabel("Task request").fill("/grep");
    const option = page.getByRole("option").filter({ hasText: "greploop" });
    await expect(option).toBeVisible();
    await expect(option.locator("span")).toHaveCSS("-webkit-line-clamp", "2");
    await expect(option.locator("span")).toHaveAttribute("title", description);
    await page.screenshot({
      path: testInfo.outputPath("compact-skill-picker.png"),
    });
  } finally {
    await fixtureSql`DELETE FROM skills WHERE id=${id}`;
  }
});

test("composer controls stay left/right aligned on dashboard and follow-up", async ({
  page,
}, testInfo) => {
  await setup(page);
  const attach = page.getByRole("button", {
    name: "Attach files (maximum 6 per message)",
    exact: true,
  });
  await expect(attach).toHaveText("");
  await expect(attach).toHaveCSS("border-top-width", "0px");
  const left = (await attach.boundingBox())!;
  const controls = (await page.locator(".launch-controls").boundingBox())!;
  const start = (await page
    .getByRole("button", { name: "Start", exact: true })
    .boundingBox())!;
  expect(controls.x).toBeGreaterThan(left.x + left.width);
  expect(start.x + start.width).toBeGreaterThan(
    controls.x + controls.width - 3,
  );
  await page.screenshot({
    path: testInfo.outputPath("dashboard-composer.png"),
  });
  await page.goto(`/tasks/${taskId}`);
  const clip = (await attach.boundingBox())!;
  const picker = (await page
    .locator(".followup-toolbar .model-picker")
    .boundingBox())!;
  const send = (await page
    .getByRole("button", { name: "Send follow-up", exact: true })
    .boundingBox())!;
  expect(picker.x).toBeGreaterThan(clip.x + clip.width);
  expect(send.x).toBeGreaterThan(picker.x + picker.width);
  expect(Math.abs(send.y + send.height - clip.y - clip.height)).toBeLessThan(6);
  await page.screenshot({ path: testInfo.outputPath("followup-composer.png") });
});

test("dashboard extracts six mixed files and rejects a seventh without losing them", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const text = await setup(page);
  await page.getByLabel("Task request").fill("Use my six attached files");
  await page.getByLabel("Attach files", { exact: true }).setInputFiles(mixed);
  await expect(page.locator('input[name="attachmentIds"]')).toHaveValue(
    /att_.*att_.*att_.*att_.*att_.*att_/,
    { timeout: 60_000 },
  );
  expect(text.get("word.docx")).toContain("Word attachment fixture");
  expect(text.get("excel.xlsx")).toContain("A1=Excel attachment fixture");
  expect(text.get("report.pdf")).toContain("PDF attachment fixture");
  expect(text.get("notes.txt")).toContain("attachment text fixture");
  await page.getByLabel("Attach files", { exact: true }).setInputFiles({
    name: "seventh.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("seventh"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "maximum of six" }),
  ).toBeVisible();
  expect(
    JSON.parse(await page.locator('input[name="attachmentIds"]').inputValue()),
  ).toHaveLength(6);
  let sent = "";
  await page.route("**/api/tasks", async (route) => {
    sent = route.request().postData() ?? "";
    await route.fulfill({
      status: 400,
      json: { error: "Fixture request captured" },
    });
  });
  await page.getByLabel("Task request").press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "captured" }),
  ).toBeVisible();
  expect(sent).toContain("attachmentIds");
  expect(sent).not.toContain("PDF attachment fixture");
});
test("follow-up resets the six-file allowance after each message and plain paste remains text", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await setup(page, true);
  const sent: Array<{ attachmentIds: string[] }> = [];
  await page.route(`**/api/tasks/${taskId}/messages`, async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({
      status: 202,
      json: { messageId: "msg_fixture", duplicate: false },
    });
  });
  for (let message = 0; message < 2; message++) {
    await page.getByLabel("Follow-up message").fill(`Message ${message}`);
    await page
      .getByLabel("Attach files", { exact: true })
      .setInputFiles(mixed.slice(0, 3));
    await expect(page.locator('input[name="attachmentIds"]')).toHaveValue(
      /att_.*att_.*att_/,
    );
    await page
      .getByLabel("Attach files", { exact: true })
      .setInputFiles(
        mixed
          .slice(0, 3)
          .map((file) => ({ ...file, name: `second-${file.name}` })),
      );
    await expect(page.locator('input[name="attachmentIds"]')).toHaveValue(
      /att_.*att_.*att_.*att_.*att_.*att_/,
    );
    await page.getByLabel("Follow-up message").press("Enter");
    await expect(page.locator('input[name="attachmentIds"]')).toHaveValue("[]");
  }
  expect(sent).toHaveLength(2);
  expect(sent.every((message) => message.attachmentIds.length === 6)).toBe(
    true,
  );
  await page.getByLabel("Follow-up message").evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "plain text");
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });
    element.dispatchEvent(event);
    if (event.defaultPrevented)
      throw new Error("Normal text paste was blocked");
  });
});
test("paste/drop attachments and upload failures keep sending disabled until removed", async ({
  page,
}) => {
  await setup(page, true);
  await page.getByLabel("Follow-up message").fill("Read this file");
  await page.route("**/__attachment-fixture/**", (route) =>
    route.fulfill({ status: 500 }),
  );
  await page.getByLabel("Follow-up message").evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File(["pasted file"], "pasted.txt", { type: "text/plain" }),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Upload failed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send follow-up" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Remove pasted.txt" }).click();
  await expect(
    page.getByRole("button", { name: "Send follow-up" }),
  ).toBeEnabled();
  await page.getByLabel("Follow-up message").evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(["video"], "bad.mp4", { type: "video/mp4" }),
    );
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
    );
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Audio and video" }),
  ).toBeVisible();
});

test("chat renders image previews, download cards and highlighted clickable URLs", async ({
  page,
}) => {
  test.skip(
    process.env.NIMBUS_ATTACHMENT_E2E !== "true",
    "Disposable database only",
  );
  await page.request.post("/api/auth/local");
  await fixtureSql`UPDATE tasks SET objective='Look at https://example.com/docs and https://x.com/user/status/123' WHERE id=${taskId}`;
  const imageId = "att_000000000000000000000000000000a1";
  const pdfId = "att_000000000000000000000000000000a2";
  const brokenId = "att_000000000000000000000000000000a3";
  await page.route("**/api/attachments**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("preview") === "1") {
      if (url.searchParams.get("id") === brokenId)
        return route.fulfill({ status: 404 });
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0KsAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    }
    return route.fulfill({
      json: {
        initialMessageId: "msg_attachment_ui_fixture",
        files: [
          {
            id: imageId,
            name: "photo.png",
            size: 68,
            messageId: "msg_attachment_ui_fixture",
          },
          {
            id: pdfId,
            name: "document.pdf",
            size: 2048,
            messageId: "msg_attachment_ui_fixture",
          },
          {
            id: brokenId,
            name: "broken.jpg",
            size: 100,
            messageId: "msg_attachment_ui_fixture",
          },
        ],
      },
    });
  });
  await page.route("https://example.com/favicon.ico", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.route("https://x.com/favicon.ico", (route) =>
    route.fulfill({ status: 404 }),
  );
  try {
    await page.goto(`/tasks/${taskId}`);
    const link = page.getByRole("link", {
      name: "https://example.com/docs",
      exact: true,
    });
    await expect(link).toHaveAttribute("href", "https://example.com/docs");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveCSS("background-color", "rgb(229, 222, 251)");
    const image = page.getByRole("img", { name: "photo.png", exact: true });
    await expect(image).toBeVisible();
    expect((await image.boundingBox())!.y).toBeLessThan(
      (await link.boundingBox())!.y,
    );
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(
      page.getByRole("link", { name: "Download document.pdf" }),
    ).toHaveAttribute("href", `/api/attachments?id=${pdfId}`);
    await expect(
      page.getByRole("link", { name: "Download broken.jpg" }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "broken.jpg" })).toHaveCount(0);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Execution health" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "How Nimbus works" }),
    ).toHaveCount(0);
  } finally {
    await fixtureSql`UPDATE tasks SET objective='Attachment UI fixture' WHERE id=${taskId}`;
  }
});

test("real browser uploads privately to R2 and binds the file to the launched message", async ({
  page,
}) => {
  test.skip(
    process.env.NIMBUS_ATTACHMENT_R2_LIVE !== "true" ||
      process.env.NIMBUS_ATTACHMENT_E2E !== "true",
    "Opt-in R2 smoke test only",
  );
  test.setTimeout(90_000);
  const { S3Client, DeleteObjectCommand, GetObjectCommand } =
    require("@aws-sdk/client-s3") as typeof import("../../apps/web/node_modules/@aws-sdk/client-s3");
  const client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  let sentTaskId = "";
  let id = "";
  const content = "Actual private R2 browser attachment test.";
  try {
    await page.request.post("/api/auth/local");
    await page.goto("/");
    await page.getByLabel("Task request").fill("Read the attachment test file");
    await page.getByLabel("Attach files", { exact: true }).setInputFiles({
      name: "nimbus-r2-browser-test.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(content),
    });
    await expect(page.locator('input[name="attachmentIds"]')).toHaveValue(
      /att_/,
      { timeout: 60_000 },
    );
    [id] = JSON.parse(
      await page.locator('input[name="attachmentIds"]').inputValue(),
    );
    await page.getByLabel("Task request").press("Enter");
    await expect(page).toHaveURL(/\/tasks\/task_/);
    sentTaskId = new URL(page.url()).pathname.split("/").at(-1)!;
    await expect(
      page
        .locator(".conversation-scroll")
        .getByRole("link", { name: "nimbus-r2-browser-test.txt" }),
    ).toBeVisible();
    const [file] =
      await fixtureSql`SELECT object_key,text_key,message_id FROM message_attachments WHERE id=${id} AND task_id=${sentTaskId}`;
    expect(file?.message_id).toBeTruthy();
    const stored = await client.send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: file!.text_key,
      }),
    );
    expect(await stored.Body?.transformToString()).toBe(content);
    const download = await page.request.get(`/api/attachments?id=${id}`);
    expect(download.status()).toBe(200);
    expect(await download.text()).toBe(content);
    expect(download.headers()["content-disposition"]).toContain("attachment");
  } finally {
    if (id && /^att_[a-f0-9]{32}$/.test(id)) {
      for (const prefix of ["staging", "files"])
        for (const part of ["original", "text"])
          await client.send(
            new DeleteObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME,
              Key: `${prefix}/org_local_01J000000000000000000001/usr_local_01J000000000000000000001/${id}/${part}`,
            }),
          );
      await fixtureSql`DELETE FROM message_attachments WHERE id=${id}`;
    }
    if (sentTaskId) {
      await fixtureSql`DELETE FROM outbox WHERE aggregate_id=${sentTaskId}`;
      await fixtureSql`DELETE FROM audit_logs WHERE target_id=${sentTaskId}`;
      await fixtureSql`DELETE FROM tasks WHERE id=${sentTaskId}`;
    }
    client.destroy();
  }
});
