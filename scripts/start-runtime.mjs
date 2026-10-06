import { spawn, spawnSync } from "node:child_process";
import { mkdir, access, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeConfiguration } from "./runtime-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = runtimeConfiguration(process.env, root);
if (config.storageMode === "ephemeral")
  console.warn(
    "TEMPORARY STORAGE: service restarts/spin-downs can lose Codex connections, thread files, checkpoints, and downloads. Users will need to reconnect.",
  );
await mkdir(process.env.NIMBUS_CODEX_HOME, { recursive: true, mode: 0o700 });
await chmod(process.env.NIMBUS_CODEX_HOME, 0o700);
await access(config.executable);
const preflight = spawnSync(config.executable, ["--version"], {
  encoding: "utf8",
  env: { PATH: process.env.PATH, HOME: process.env.HOME },
  timeout: 15_000,
});
if (preflight.status !== 0)
  throw new Error("Codex CLI preflight failed. Run pnpm runtime:build first.");
console.log(
  `Nimbus runtime: ${preflight.stdout.trim()}; web port ${config.port}; private executor port ${config.executorPort}`,
);
if (!process.env.E2B_API_KEY?.trim())
  console.warn(
    "E2B_API_KEY is missing: general chat can run, repository tasks cannot.",
  );

const children = [];
let stopping = false;
let exitCode = 0;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  process.exitCode = code;
  for (const child of children)
    if (
      process.platform !== "win32" ||
      (child.exitCode === null && child.signalCode === null)
    )
      signal(child, "SIGTERM");
  const force = setTimeout(() => {
    for (const child of children)
      if (
        process.platform !== "win32" ||
        (child.exitCode === null && child.signalCode === null)
      )
        signal(child, "SIGKILL");
    process.exit(exitCode);
  }, 12_000);
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((done) => child.once("exit", done)),
    ),
  );
  clearTimeout(force);
  process.exit(exitCode);
}
function signal(child, name) {
  try {
    // Linux process groups include the web process's Codex children.
    if (process.platform !== "win32" && child.pid)
      process.kill(-child.pid, name);
    else child.kill(name);
  } catch (error) {
    if (error.code !== "ESRCH") console.error("Could not stop runtime child");
  }
}
function launch(name, args, cwd, env) {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  children.push(child);
  child.once("error", () => {
    console.error(`${name} failed to start`);
    void shutdown(1);
  });
  child.once("exit", (code) => {
    if (!stopping) {
      console.error(`${name} exited; stopping runtime`);
      void shutdown(code || 1);
    }
  });
  return child;
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
launch(
  "Web",
  [
    resolve(root, "apps/web/node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "0.0.0.0",
    "--port",
    String(config.port),
  ],
  resolve(root, "apps/web"),
  config.webEnvironment,
);

let ready = false;
for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
  try {
    // Any HTTP response confirms the HTTP listener is up; no Google login is needed.
    await fetch(`http://127.0.0.1:${config.port}/api/codex/device`, {
      redirect: "manual",
      signal: AbortSignal.timeout(1000),
    });
    ready = true;
    break;
  } catch {
    await new Promise((done) => setTimeout(done, 1000));
  }
}
if (!ready) await shutdown(1);
else
  launch(
    "Executor",
    ["--import", "tsx", "src/index.ts"],
    resolve(root, "apps/executor"),
    config.executorEnvironment,
  );
