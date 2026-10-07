import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

// Exercise plain-Node module resolution without loading any local credentials
// or contacting a real database, GitHub account, sandbox, or model.
const probe = createServer();
await new Promise((done) => probe.listen(0, "127.0.0.1", done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const child = spawn(process.execPath, ["dist/index.mjs"], {
  cwd: fileURLToPath(new URL("../apps/executor/", import.meta.url)),
  windowsHide: true,
  env: {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
    NIMBUS_CODING_PROVIDER: "connected",
    NIMBUS_EXECUTOR_SECRET: "a".repeat(64),
    EXECUTOR_PORT: String(port),
    POSTHOG_PROJECT_TOKEN: "test-only-no-real-project",
    POSTHOG_HOST: "http://127.0.0.1:1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (data) => {
  logs += data;
});
child.stderr.on("data", (data) => {
  logs += data;
});
const exited = new Promise((done) => child.once("exit", done));
try {
  let response;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Compiled executor exited before health check: ${logs}`);
    try {
      response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(300),
      });
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  assert.ok(response, "Compiled executor failed to start");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).provider, "connected");
  console.log(
    "Compiled executor smoke check passed with plain Node; no live services used.",
  );
} finally {
  child.kill();
  await exited;
}
