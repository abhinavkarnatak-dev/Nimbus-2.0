import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

// Postgres keeps the durable copy of the credential directory so that a
// replaced container can still resume the user's existing Codex threads. The
// snapshot is deliberately bounded: the credential file, the newest rollout
// files, and nothing else.
export const HOME_SNAPSHOT_VERSION = 1;

const MAX_FILES = 200;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const MAX_DEPTH = 6;
const MAX_SESSION_FILES = 20;
const SKIP_DIRECTORIES = new Set(["tmp", "log", "logs", "cache"]);

interface Candidate {
  path: string;
  key: string;
  size: number;
  modified: number;
}

function normalize(path: string): string {
  return path.split(sep).join("/");
}

async function collect(home: string): Promise<Candidate[]> {
  const files: Candidate[] = [];
  let visited = 0;
  const walk = async (directory: string, depth: number) => {
    if (depth > MAX_DEPTH || visited > MAX_ENTRIES) return;
    let listing;
    try {
      listing = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of listing) {
      if (visited++ > MAX_ENTRIES) return;
      // The snapshot holds regular files only, so a link can never be followed
      // out of the credential directory.
      if (entry.isSymbolicLink()) continue;
      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth === 0 && SKIP_DIRECTORIES.has(entry.name)) continue;
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const info = await lstat(full);
        if (!info.isFile() || info.isSymbolicLink()) continue;
        if (info.size > MAX_FILE_BYTES) continue;
        const key = normalize(relative(home, full));
        if (!key || key.startsWith("..") || isAbsolute(key)) continue;
        files.push({
          path: full,
          key,
          size: info.size,
          modified: info.mtimeMs,
        });
      } catch {
        continue;
      }
    }
  };
  await walk(home, 0);
  return files;
}

// Returns null when there is nothing worth storing, which is also the case for
// a directory that is not an authenticated home.
export async function snapshotCodexHome(home: string): Promise<string | null> {
  const files = await collect(home);
  if (!files.length) return null;
  const newest = (list: Candidate[]) =>
    [...list].sort((left, right) => right.modified - left.modified);
  const credential = files.filter((file) => file.key === "auth.json");
  const sessions = newest(
    files.filter((file) => file.key.startsWith("sessions/")),
  ).slice(0, MAX_SESSION_FILES);
  const rest = newest(
    files.filter(
      (file) => file.key !== "auth.json" && !file.key.startsWith("sessions/"),
    ),
  );
  const kept: Candidate[] = [];
  let total = 0;
  for (const file of [...credential, ...sessions, ...rest]) {
    if (kept.length >= MAX_FILES || total + file.size > MAX_TOTAL_BYTES)
      continue;
    kept.push(file);
    total += file.size;
  }
  const payload: Record<string, string> = {};
  for (const file of kept) {
    try {
      payload[file.key] = (await readFile(file.path)).toString("base64");
    } catch {
      continue;
    }
  }
  // Without the credential file this is not a connected home worth keeping.
  if (!payload["auth.json"]) return null;
  return JSON.stringify({
    version: HOME_SNAPSHOT_VERSION,
    files: payload,
    skipped: files.length - Object.keys(payload).length,
  });
}

function resolveSnapshotPath(home: string, key: string): string | null {
  if (!key || key.includes("\0") || key.includes("\\") || isAbsolute(key))
    return null;
  const segments = key.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  )
    return null;
  const root = resolve(home);
  const target = resolve(root, ...segments);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

// Restores only files that are absent, so a live directory is never overwritten.
// Returns how many files were written. Treats the snapshot as hostile input.
export async function restoreCodexHome(
  home: string,
  snapshot: string,
): Promise<number> {
  let parsed: { version?: unknown; files?: unknown };
  try {
    parsed = JSON.parse(snapshot) as { version?: unknown; files?: unknown };
  } catch {
    return 0;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.version !== HOME_SNAPSHOT_VERSION ||
    !parsed.files ||
    typeof parsed.files !== "object"
  )
    return 0;
  let written = 0;
  for (const [key, value] of Object.entries(
    parsed.files as Record<string, unknown>,
  )) {
    if (typeof value !== "string") continue;
    const target = resolveSnapshotPath(home, key);
    if (!target) continue;
    const contents = Buffer.from(value, "base64");
    if (contents.byteLength > MAX_FILE_BYTES) continue;
    try {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      // "wx" refuses an existing path and refuses to write through a link.
      await writeFile(target, contents, { mode: 0o600, flag: "wx" });
      written += 1;
    } catch {
      continue;
    }
  }
  return written;
}
