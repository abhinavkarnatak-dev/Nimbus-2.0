// No login or inference: verify the installed CLI protocol in a brand-new private home.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { CodexAppServerProvider } from "../packages/codex/src/app-server-provider.js";

const home = await mkdtemp(resolve(tmpdir(), "nimbus-codex-preflight-"));
const executable =
  process.env.CODEX_EXECUTABLE ??
  (process.platform === "win32"
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
    : "codex");
const provider = new CodexAppServerProvider({
  localDeviceAuth: { home, persistent: true },
  codexExecutable: executable,
  requestTimeoutMs: 15_000,
});
try {
  await provider.start();
  assert.equal(await provider.readDeviceAccount(), null);
  assert.equal(provider.isRunning, true);
  await provider.stop();
  assert.equal(provider.isRunning, false);
  await provider.start();
  assert.equal(await provider.readDeviceAccount(), null);
  console.log(
    "Codex preflight passed: initialize, isolated file store, unauthenticated account read. No login or model request made.",
  );
} finally {
  await provider.stop();
  if (
    dirname(home) !== resolve(tmpdir()) ||
    !basename(home).startsWith("nimbus-codex-preflight-")
  )
    throw new Error("Invalid temporary cleanup target");
  await rm(home, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
