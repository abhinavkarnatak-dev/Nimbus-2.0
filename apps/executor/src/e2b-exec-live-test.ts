// Protocol preflight only: no account login, model call, host repository commands or GitHub writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { E2BWorkspaceProvider } from "./e2b-workspace-provider.js";
import { startE2BExecBridge } from "./e2b-exec-bridge.js";

if (process.env.NIMBUS_E2B_LIVE_TEST !== "true")
  throw new Error("Live test requires explicit opt-in");
const provider = new E2BWorkspaceProvider();
const workspace = await provider.provision(
  `task_e2b_protocol_${Date.now()}`,
  "nimbus_live_test",
  { owner: "abhinavkarnatak-dev", name: "Testing-Nimbus-PRs", baseRef: "main" },
);
let bridge: Awaited<ReturnType<typeof startE2BExecBridge>> | undefined;
let child: ReturnType<typeof spawn> | undefined;
let testHome: string | undefined;
let stage = "execution bridge";
try {
  const token = randomBytes(32).toString("hex");
  bridge = await startE2BExecBridge(provider, workspace, token, (message) =>
    console.log(`EXEC: ${message.slice(0, 1000)}`),
  );
  const executable =
    process.platform === "win32"
      ? resolve(
          process.env.APPDATA ?? "",
          "npm/node_modules/@openai/codex/node_modules/@openai",
          `codex-win32-${process.arch}`,
          "vendor",
          process.arch === "arm64"
            ? "aarch64-pc-windows-msvc"
            : "x86_64-pc-windows-msvc",
          "bin/codex.exe",
        )
      : "codex";
  // Only native app-server protocol discovery runs locally, never repo code.
  testHome = await mkdtemp(resolve(tmpdir(), "nimbus-e2b-preflight-"));
  child = spawn(executable, ["app-server", "--listen", "stdio://"], {
    env: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      USERPROFILE: process.env.USERPROFILE,
      CODEX_HOME: testHome,
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  let sequence = 0;
  const lines = createInterface({ input: child.stdout! });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error)
      request.reject(
        new Error(`${message.error.code}: ${message.error.message}`),
      );
    else request.resolve(message.result);
  });
  const rpc = (method: string, params: unknown): Promise<any> => {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Protocol request timed out"));
      }, 30_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child!.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  };
  await rpc("initialize", {
    clientInfo: { name: "nimbus_preflight", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin!.write(
    `${JSON.stringify({ method: "initialized", params: {} })}\n`,
  );
  stage = "remote environment registration";
  await rpc("environment/add", {
    environmentId: "nimbus_e2b_preflight",
    execServerUrl: bridge.url,
    authBearerToken: token,
    connectTimeoutMs: 20_000,
  });
  console.log("PASS: authenticated app-server to remote exec-server transport");
  stage = "remote environment identity";
  const info = await rpc("environment/info", {
    environmentId: "nimbus_e2b_preflight",
  });
  assert.equal(info.cwd, "file:///workspace/repo");
  assert.match(info.shell.path, /^\//);
  console.log(
    "PASS: remote environment reports Linux shell and repository URI",
  );
  stage = "sticky remote thread environment";
  const thread = await rpc("thread/start", {
    model: "gpt-5.4",
    approvalPolicy: "never",
    sandbox: "read-only",
    environments: [
      {
        environmentId: "nimbus_e2b_preflight",
        cwd: "/workspace/repo",
        runtimeWorkspaceRoots: ["/workspace/repo"],
      },
    ],
  });
  assert.equal(
    thread.thread.environments?.[0]?.environmentId,
    "nimbus_e2b_preflight",
  );
  console.log(
    "PASS: thread selected the remote environment (no model turn started)",
  );
} catch (error) {
  console.error(`FAIL: ${stage}`);
  // This protocol-only app-server has no Nimbus account/backend credentials.
  console.error(
    error instanceof Error
      ? error.message.slice(0, 1000)
      : "Protocol test failed",
  );
  process.exitCode = 1;
} finally {
  const exited =
    child && child.exitCode === null ? once(child, "exit") : Promise.resolve();
  child?.kill();
  await exited;
  child?.stdin?.destroy();
  child?.stdout?.destroy();
  child?.stderr?.destroy();
  await bridge?.close();
  await provider.destroy(workspace);
  if (testHome)
    await rm(testHome, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  console.log(
    "Protocol test sandbox destroyed; no model turn or GitHub write performed",
  );
}
