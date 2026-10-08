// Isolated real hero component: no auth, database, Codex or sandbox calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const { build } = createRequire(
  new URL("../../executor/package.json", import.meta.url),
)("esbuild");
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = await build({
  stdin: {
    resolveDir: webRoot,
    loader: "tsx",
    contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {HeroTaskDemo} from './app/(product)/hero-task-demo';
    createRoot(document.getElementById('root')).render(<HeroTaskDemo/>);
  `,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  outdir: resolve(webRoot, ".hero-browser-fixture"),
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "silent",
});
const assets = new Map(
  output.outputFiles.map((file) => [basename(file.path), file.contents]),
);
const server = createServer((request, response) => {
  const name = (request.url ?? "/").slice(1);
  if (!name) {
    response.setHeader("content-type", "text/html");
    response.end(
      '<html><head><link rel="stylesheet" href="/stdin.css"><style>*{box-sizing:border-box}body{margin:0;background:#0b0c11;color:white;font:14px Arial;display:grid;place-items:center;min-height:650px}#root{width:min(650px,calc(100vw - 48px))}</style></head><body><div id="root"></div><script type="module" src="/stdin.js"></script></body></html>',
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
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true });
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 700 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const start = new Date("2026-10-09T00:00:00Z");
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
  await page.goto(origin);
  const stage = page.locator("[data-hero-demo]");
  await stage.waitFor();
  await page.clock.runFor(100);
  const badge = (name) => page.locator(`[data-orbit-badge="${name}"]`);
  const center = async (name) => {
    const b = await badge(name).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const topStart = await center("events"),
    bottomStart = await center("outcome");
  const initialHeight = (await stage.boundingBox()).height;
  await page.clock.runFor(1300);
  assert.equal(await stage.getAttribute("data-demo-phase"), "message");
  await page.clock.runFor(4400);
  assert.equal(await stage.getAttribute("data-demo-phase"), "inspecting");
  await page.clock.runFor(2300);
  assert.equal(await stage.getAttribute("data-demo-phase"), "writing");
  const topHalf = await center("events"),
    bottomHalf = await center("outcome");
  assert.ok(
    Math.abs(topHalf.x - bottomStart.x) < 15 &&
      Math.abs(topHalf.y - bottomStart.y) < 15,
  );
  assert.ok(
    Math.abs(bottomHalf.x - topStart.x) < 15 &&
      Math.abs(bottomHalf.y - topStart.y) < 15,
  );
  assert.equal(await badge("events").evaluate((e) => e.style.zIndex), "0");
  assert.equal(await badge("outcome").evaluate((e) => e.style.zIndex), "3");
  await page.clock.runFor(4000);
  assert.equal(await stage.getAttribute("data-demo-phase"), "complete");
  assert.equal((await stage.boundingBox()).height, initialHeight);
  await mkdir(resolve(webRoot, "../../test-results"), { recursive: true });
  await page.screenshot({
    path: resolve(webRoot, "../../test-results/hero-demo.png"),
  });
  await page.clock.runFor(4000);
  assert.equal(await stage.getAttribute("data-demo-phase"), "message");
  const topLoop = await center("events");
  assert.ok(
    Math.abs(topLoop.x - topStart.x) < 15 &&
      Math.abs(topLoop.y - topStart.y) < 15,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(async () => {
    await page.clock.runFor(100);
    assert.equal(await stage.getAttribute("data-demo-phase"), "complete");
  }).toPass({ timeout: 5000 });
  assert.equal(await badge("events").evaluate((e) => e.style.translate), "0px");
  await page.setViewportSize({ width: 390, height: 700 });
  await page.screenshot({
    path: resolve(webRoot, "../../test-results/hero-demo-mobile.png"),
  });
  const bounds = await stage.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: staged workflow loops, opposite badges exchange anchors and depth, stable sizing, reduced motion and mobile layout.",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
