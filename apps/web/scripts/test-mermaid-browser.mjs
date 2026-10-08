// Hermetic browser QA: real chat components/libraries, no app server, auth,
// database, Codex, or E2B. All assets are served from memory on localhost.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
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
    contents: `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MarkdownMessage} from './app/(product)/tasks/[taskId]/markdown-message';
import {renderDiagram} from './lib/mermaid-renderer';
const flow = 'Before\\n\\n'+String.fromCharCode(96).repeat(3)+'mermaid\\nflowchart LR\\nA[User request] --> B{Repository selected?}\\nB -->|Yes| C[E2B workspace]\\nB -->|No| D[General chat]\\n';
const end = String.fromCharCode(96).repeat(3)+'\\n\\nAfter';
const sequence = String.fromCharCode(96).repeat(3)+'mermaid\\nsequenceDiagram\\nparticipant U as User\\nparticipant N as Nimbus\\nparticipant E as E2B\\nU->>N: Request a change\\nN->>E: Execute task\\nE-->>N: Return result\\nN-->>U: Explain changes\\n'+String.fromCharCode(96).repeat(3);
const invalid = String.fromCharCode(96).repeat(3)+'mermaid\\nflowchart TD\\nA[broken\\n'+String.fromCharCode(96).repeat(3)+'\\n\\nStill readable';
const ascii = String.fromCharCode(96).repeat(3)+'text\\nroot/\\n├── src/\\n└── README.md\\n'+String.fromCharCode(96).repeat(3)+'\\n\\n'+String.fromCharCode(96).repeat(3)+'javascript\\nconsole.log(1);\\n'+String.fromCharCode(96).repeat(3);
function App(){ const [text,setText]=useState(flow); return <main><nav><button onClick={()=>setText(flow+end)}>Finish stream</button><button onClick={()=>setText(sequence)}>Sequence</button><button onClick={()=>setText(invalid)}>Invalid</button><button onClick={()=>setText(ascii)}>ASCII</button></nav><MarkdownMessage taskId='fixture' text={text}/></main>; }
window.renderFixtureDiagram = renderDiagram;
createRoot(document.getElementById('root')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  splitting: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  outdir: resolve(webRoot, ".mermaid-browser-fixture"),
  alias: { "@": webRoot },
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
      '<html><head><script>window.process={env:{NODE_ENV:"production"},browser:true}</script><link rel="stylesheet" href="/stdin.css"><style>body{font:14px Arial;background:#fff;color:#454854;margin:30px}main{max-width:1000px;margin:auto}nav{display:flex;gap:10px;margin-bottom:20px}</style></head><body><div id="root"></div><script type="module" src="/stdin.js"></script></body></html>',
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
    viewport: { width: 1100, height: 820 },
  });
  const errors = [];
  const external = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Browser fixture error:", error.message);
  });
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(origin)) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto(origin);
  await page
    .getByText("Preview requires a complete diagram block. Source shown below.")
    .waitFor();
  assert.equal(await page.locator("[data-mermaid-diagram] svg").count(), 0);
  await page
    .getByRole("button", { name: "Finish stream", exact: true })
    .click();
  await page.getByRole("img", { name: "Flowchart", exact: true }).waitFor();
  assert.ok(await page.locator("[data-mermaid-diagram] svg").textContent());
  assert.equal(await page.getByText("Before", { exact: true }).count(), 1);
  assert.equal(await page.getByText("After", { exact: true }).count(), 1);
  await mkdir(resolve(webRoot, "../../test-results"), { recursive: true });
  await page.screenshot({
    path: resolve(webRoot, "../../test-results/mermaid-flowchart.png"),
  });
  await page.getByRole("button", { name: "Source", exact: true }).click();
  assert.equal(await page.locator("[data-mermaid-diagram] svg").count(), 0);
  assert.match(
    await page.locator("[data-mermaid-diagram] pre").textContent(),
    /flowchart LR/,
  );
  await page.getByRole("button", { name: "Diagram", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG", exact: true }).click();
  assert.equal((await downloading).suggestedFilename(), "nimbus-diagram.svg");
  await page.getByRole("button", { name: "Sequence", exact: true }).click();
  await page
    .getByRole("img", { name: "Sequence diagram", exact: true })
    .waitFor();
  await page.screenshot({
    path: resolve(webRoot, "../../test-results/mermaid-sequence.png"),
  });
  await page.getByRole("button", { name: "Invalid", exact: true }).click();
  await page
    .getByText(
      "This diagram could not be rendered. Its source is available below.",
    )
    .waitFor();
  assert.equal(
    await page.getByText("Still readable", { exact: true }).count(),
    1,
  );
  await page.getByRole("button", { name: "Sequence", exact: true }).click();
  await page
    .getByRole("img", { name: "Sequence diagram", exact: true })
    .waitFor();
  const security = await page.evaluate(async () => {
    const outcomes = [];
    for (const source of [
      'flowchart TD\nclick A "https://evil.test"',
      "flowchart TD\nA[<img src=x onerror=alert(1)>]",
      '%%{init: {securityLevel: "loose"}}%%\nflowchart TD\nA-->B',
      'flowchart TD\nA@{img: "https://evil.test/image.png"}',
      "flowchart TD\n" +
        Array.from({ length: 105 }, (_, i) => `A${i}-->A${i + 1}`).join("\n"),
    ]) {
      try {
        await window.renderFixtureDiagram(source);
        outcomes.push(false);
      } catch {
        outcomes.push(true);
      }
    }
    const recovered = await window.renderFixtureDiagram(
      "flowchart TD\nSafe-->Diagram",
    );
    return { outcomes, recovered };
  });
  assert.ok(security.outcomes.every(Boolean));
  assert.ok(security.recovered.includes("<svg"));
  assert.equal(
    await page
      .locator(
        "[data-mermaid-diagram] svg script, [data-mermaid-diagram] svg foreignObject, [data-mermaid-diagram] svg image, [data-mermaid-diagram] svg a",
      )
      .count(),
    0,
  );
  await page.getByRole("button", { name: "ASCII", exact: true }).click();
  assert.equal(await page.locator("[data-mermaid-diagram]").count(), 0);
  assert.match(await page.locator("pre").first().textContent(), /├── src/);
  assert.equal(
    await page
      .getByRole("button", { name: "Download file", exact: true })
      .count(),
    1,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "Mermaid browser QA passed: real flow/sequence SVGs, streaming gate, source toggle, SVG download, invalid fallback/recovery, security/complexity limits, ASCII/code preservation, no external requests.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
