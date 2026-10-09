import { createRequire } from "node:module";
import { copyFile, mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const target = new URL("../public/", import.meta.url);
await mkdir(target, { recursive: true });
await copyFile(
  require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"),
  new URL("pdf.worker.min.mjs", target),
);
