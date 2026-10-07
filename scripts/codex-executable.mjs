import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

// The pinned npm CLI is a Node launcher around a native executable. Avoid
// retaining that extra Node process for every account on a small instance.
export function nativeCodexExecutable(
  root,
  fallback,
  platform = process.platform,
  arch = process.arch,
) {
  const triples = {
    "linux:x64": "x86_64-unknown-linux-musl",
    "linux:arm64": "aarch64-unknown-linux-musl",
    "darwin:x64": "x86_64-apple-darwin",
    "darwin:arm64": "aarch64-apple-darwin",
    "win32:x64": "x86_64-pc-windows-msvc",
    "win32:arm64": "aarch64-pc-windows-msvc",
  };
  const triple = triples[`${platform}:${arch}`];
  if (!triple) return fallback;
  const packageRoot = resolve(root, ".nimbus-tools/node_modules/@openai/codex");
  const candidates = [resolve(packageRoot, "vendor")];
  try {
    const require = createRequire(resolve(packageRoot, "package.json"));
    candidates.unshift(
      resolve(
        dirname(
          require.resolve(`@openai/codex-${platform}-${arch}/package.json`),
        ),
        "vendor",
      ),
    );
  } catch {
    /* Older pinned distributions embed vendor in the main package. */
  }
  for (const vendor of candidates) {
    const executable = resolve(
      vendor,
      triple,
      "bin",
      platform === "win32" ? "codex.exe" : "codex",
    );
    if (existsSync(executable)) return executable;
  }
  return fallback;
}
