import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

// Next's Windows glob exclusions can leave runtime data in deployment traces.
// Edit generated manifests only. Never read/delete the referenced runtime files.
const projectRoot = resolve(import.meta.dirname, "..");
const runtimeRoot = resolve(projectRoot, "../../.nimbus");
const normalized = (path) =>
  process.platform === "win32" ? path.toLowerCase() : path;
function runtimeData(tracePath, file) {
  const absolute = resolve(dirname(tracePath), file);
  const path = normalized(absolute);
  const runtime = normalized(runtimeRoot);
  const name = basename(absolute);
  return (
    path === runtime ||
    path.startsWith(runtime + sep) ||
    ((name === ".env" || name.startsWith(".env.")) &&
      !name.endsWith(".example"))
  );
}
let removed = 0;
async function sanitize(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await sanitize(path);
    else if (entry.isFile() && entry.name.endsWith(".nft.json")) {
      const trace = JSON.parse(await readFile(path, "utf8"));
      if (
        !Array.isArray(trace.files) ||
        trace.files.some((file) => typeof file !== "string")
      )
        throw new Error("Invalid build trace");
      const files = trace.files.filter((file) => !runtimeData(path, file));
      removed += trace.files.length - files.length;
      if (files.length !== trace.files.length)
        await writeFile(path, JSON.stringify({ ...trace, files }));
      if (
        JSON.parse(await readFile(path, "utf8")).files.some((file) =>
          runtimeData(path, file),
        )
      )
        throw new Error("Runtime data remains in a deployment trace");
    }
  }
}
await sanitize(resolve(projectRoot, ".next"));
console.log(
  `Deployment traces verified: removed ${removed} local runtime/secret references. Runtime files were untouched.`,
);
