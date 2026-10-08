// Hermetic browser check of the real composer; no database/auth/Codex/E2B calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
const requireBuild = createRequire(
  new URL("../../executor/package.json", import.meta.url),
);
const { build } = requireBuild("esbuild");
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = await build({
  stdin: {
    resolveDir: webRoot,
    loader: "tsx",
    contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {LiveAgentWorkspace} from './app/(product)/tasks/[taskId]/live-agent-workspace';
window.streams=[];
window.EventSource=class extends EventTarget { constructor(){super();window.streams.push(this)} close(){} };
window.taskState=(status)=>window.streams.forEach(s=>s.dispatchEvent(new MessageEvent('task_state',{data:JSON.stringify({status,messageId:status==='running'?'request':null})})));
createRoot(document.getElementById('root')).render(<LiveAgentWorkspace taskId='fixture' createdAt='2026-10-08T10:00:00Z' finishedAt='2026-10-08T10:01:00Z' objective='Original conversation' model='model-a' initialStatus='completed' initialEvents={[]} workbench={null}/>);
`,
  },
  bundle: true,
  write: false,
  splitting: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  outdir: resolve(webRoot, ".followup-browser-fixture"),
  alias: { "@": webRoot },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "silent",
  plugins: [
    {
      name: "fixture-navigation",
      setup(builder) {
        builder.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: "navigation",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export function useRouter(){return {refresh(){},push(){}}}",
        }));
      },
    },
  ],
});
const assets = new Map(
  output.outputFiles.map((file) => [basename(file.path), file.contents]),
);
assets.set("globals.css", await readFile(resolve(webRoot, "app/globals.css")));
const server = createServer((request, response) => {
  const name = (request.url ?? "/").slice(1);
  if (!name) {
    response.setHeader("content-type", "text/html");
    response.end(
      '<html><head><script>window.process={env:{NODE_ENV:"production"},browser:true}</script><style>button{background:transparent;border:0}</style><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/stdin.css"><style>body{margin:20px}.app-shell{display:block;font:15px Arial}.agent-workspace{height:520px}</style></head><body class="app-shell"><div id="root"></div><script type="module" src="/stdin.js"></script></body></html>',
    );
  } else if (assets.has(name)) {
    response.setHeader(
      "content-type",
      name.endsWith(".css") ? "text/css" : "application/javascript",
    );
    response.end(assets.get(name));
  } else {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 700 },
  });
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const models = [
    {
      id: "model-a",
      label: "Model A",
      supportedReasoningEfforts: [
        { reasoningEffort: "medium" },
        { reasoningEffort: "high" },
      ],
    },
    {
      id: "model-b",
      label: "Model B",
      supportedReasoningEfforts: [
        { reasoningEffort: "low" },
        { reasoningEffort: "medium" },
      ],
    },
  ];
  await page.route("**/api/codex/models", (route) =>
    route.fulfill({ json: { models } }),
  );
  await page.route("**/api/skills", (route) =>
    route.fulfill({ json: { skills: [] } }),
  );
  let reject = false;
  await page.route("**/api/tasks/fixture/messages", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      status: reject ? 409 : 202,
      json: reject
        ? {
            error:
              "Wait for the current request to finish before changing models",
          }
        : { messageId: "sent" },
    });
  });
  await page.goto(origin);
  const trigger = page.getByRole("button", {
    name: "Follow-up model and thinking effort",
  });
  await trigger.click();
  const picker = page.getByRole("combobox", { name: "Follow-up model" });
  await picker
    .locator('option[value="model-b"]')
    .waitFor({ state: "attached" });
  assert.equal(await picker.isEnabled(), true);
  assert.equal(await picker.inputValue(), "model-a");
  await picker.selectOption("model-b");
  const effort = page.getByRole("slider", {
    name: "Follow-up thinking effort",
  });
  await effort.focus();
  await effort.press("Home");
  assert.equal(await effort.getAttribute("aria-valuetext"), "low");
  await effort.press("Escape");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await trigger.click();
  const input = page.getByRole("textbox", { name: "Follow-up message" });
  await input.fill("Continue with this model");
  await input.press("Enter");
  await page.waitForFunction(
    () => document.querySelector("textarea").value === "",
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, "model-b");
  assert.equal(requests[0].reasoningEffort, "low");
  assert.equal(requests[0].content, "Continue with this model");
  assert.equal(await trigger.isDisabled(), true);
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await page.evaluate(() => window.taskState("running"));
  assert.equal(await trigger.isDisabled(), true);
  await page.evaluate(() => window.taskState("completed"));
  await page.waitForFunction(
    () => !document.querySelector(".model-picker-trigger").disabled,
  );
  await trigger.click();
  await picker.selectOption("model-a");
  assert.equal(await effort.getAttribute("aria-valuetext"), "medium");
  await effort.focus();
  await effort.press("End");
  assert.equal(await effort.getAttribute("aria-valuetext"), "high");
  await input.fill("Line one");
  await input.press("Shift+Enter");
  await input.press("a");
  assert.equal(requests.length, 1);
  assert.equal(await input.inputValue(), "Line one\na");
  reject = true;
  await input.press("Enter");
  await page.getByRole("alert").waitFor();
  assert.equal(await input.inputValue(), "Line one\na");
  assert.equal(await trigger.isEnabled(), true);
  assert.equal(requests[1].model, "model-a");
  assert.equal(requests[1].reasoningEffort, "high");
  await trigger.click();
  assert.equal(await effort.isEnabled(), true);
  await mkdir(resolve(webRoot, "../../test-results"), { recursive: true });
  await page.screenshot({
    path: resolve(webRoot, "../../test-results/followup-model-picker.png"),
  });
  await page.setViewportSize({ width: 390, height: 700 });
  const panelBounds = await page.locator(".model-picker-panel").boundingBox();
  assert.ok(
    panelBounds &&
      panelBounds.x >= 0 &&
      panelBounds.x + panelBounds.width <= 390,
  );
  const triggerBounds = await trigger.boundingBox();
  assert.ok(panelBounds.y + panelBounds.height <= triggerBounds.y);
  await page.screenshot({
    path: resolve(
      webRoot,
      "../../test-results/followup-model-picker-mobile.png",
    ),
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: unified follow-up picker selects models and effort via slider, opens upward, handles Escape and mobile sizing, locks during work, and preserves sending behavior.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
