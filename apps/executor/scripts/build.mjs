import { build } from "esbuild";

// Include workspace dependencies too: pnpm does not expose their transitive
// packages at the executor root. No runtime transpiler or flattened install.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  external: ["bufferutil", "utf-8-validate"],
  banner: {
    js: "import { createRequire as nimbusCreateRequire } from 'node:module'; const require = nimbusCreateRequire(import.meta.url);",
  },
});
