import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, basename } from "node:path";
import { nativeCodexExecutable } from "./codex-executable.mjs";

test("selects the installed native binary and safely falls back for unsupported distributions", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "nimbus-native-test-"));
  try {
    const executable = resolve(
      root,
      ".nimbus-tools/node_modules/@openai/codex/vendor/x86_64-unknown-linux-musl/bin/codex",
    );
    assert.equal(
      nativeCodexExecutable(root, "launcher", "linux", "x64"),
      "launcher",
    );
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(executable, "test-only-not-executed");
    assert.equal(
      nativeCodexExecutable(root, "launcher", "linux", "x64"),
      executable,
    );
    assert.equal(
      nativeCodexExecutable(root, "launcher", "unsupported", "x64"),
      "launcher",
    );
  } finally {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("nimbus-native-test-"));
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
