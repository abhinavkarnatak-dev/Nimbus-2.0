import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { CODEX_VERSION } from "./runtime-config.mjs";

// Build-only tool install: don't write to Render's read-only global npm directory.
const root = fileURLToPath(new URL("../", import.meta.url));
const child = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  [
    "install",
    "--prefix",
    resolve(root, ".nimbus-tools"),
    "--no-audit",
    "--no-fund",
    `@openai/codex@${CODEX_VERSION}`,
  ],
  { stdio: "inherit", shell: process.platform === "win32", windowsHide: true },
);
child.on("error", () => {
  console.error("Codex CLI installation failed");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
