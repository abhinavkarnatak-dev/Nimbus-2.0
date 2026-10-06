import { execFile } from "node:child_process";
import { lstat, readdir, realpath, open } from "node:fs/promises";
import { resolve, relative, isAbsolute, join, basename } from "node:path";
import { isPrivateArtifactPath } from "./artifact-policy";

export class FileBrowserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function filePath(value: string): string {
  if (!value) return "";
  if (
    value.length > 2048 ||
    /[\\:\u0000-\u001f\u007f]/.test(value) ||
    value.startsWith("/") ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          part.toLowerCase() === ".git" ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw new FileBrowserError("Invalid repository path");
  return value;
}
function inside(root: string, target: string) {
  const diff = relative(root, target);
  if (
    diff === ".." ||
    diff.startsWith("../") ||
    diff.startsWith("..\\") ||
    isAbsolute(diff)
  )
    throw new FileBrowserError("Path is outside this task workspace", 403);
}
export async function taskFileRoot(repositoryRoot: string, taskId: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId))
    throw new FileBrowserError("Invalid task", 404);
  const base = await realpath(resolve(repositoryRoot, ".nimbus/workspaces"));
  const candidate = join(base, taskId);
  if ((await lstat(candidate)).isSymbolicLink())
    throw new FileBrowserError("Linked workspaces are not available", 403);
  const root = await realpath(candidate);
  inside(base, root);
  return root;
}
async function targetPath(root: string, path: string) {
  filePath(path);
  let target = root;
  for (const segment of path.split("/").filter(Boolean)) {
    target = join(target, segment);
    if ((await lstat(target)).isSymbolicLink())
      throw new FileBrowserError("Symbolic links cannot be opened", 403);
  }
  const actual = await realpath(target);
  inside(root, actual);
  filePath(relative(root, actual).replaceAll("\\", "/"));
  return actual;
}
export async function listWorkspaceDirectory(root: string, path: string) {
  const target = await targetPath(root, path);
  const rows = await readdir(target, { withFileTypes: true });
  if (rows.length > 10000)
    throw new FileBrowserError("This directory is too large to display", 413);
  return rows
    .filter((entry) => entry.name.toLowerCase() !== ".git")
    .map((entry) => ({
      name: entry.name,
      path: [path, entry.name].filter(Boolean).join("/"),
      kind: entry.isSymbolicLink()
        ? "link"
        : entry.isDirectory()
          ? "directory"
          : "file",
    }))
    .sort(
      (a, b) =>
        Number(b.kind === "directory") - Number(a.kind === "directory") ||
        a.name.localeCompare(b.name),
    );
}
function textFile(buffer: Buffer) {
  if (buffer.toString("utf8").split("\n").length > 20000)
    throw new FileBrowserError(
      "Files over 20,000 lines cannot be previewed",
      413,
    );
  if (buffer.includes(0))
    throw new FileBrowserError("Binary files cannot be previewed", 415);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new FileBrowserError("This file is not UTF-8 text", 415);
  }
}
export async function readWorkspaceBytes(
  root: string,
  path: string,
  limit = 50_000_000,
) {
  if (!filePath(path)) throw new FileBrowserError("Choose a file");
  const target = await targetPath(root, path);
  if (!(await lstat(target)).isFile())
    throw new FileBrowserError("Choose a regular file");
  const handle = await open(target, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new FileBrowserError("Choose a regular file");
    if (info.size > limit)
      throw new FileBrowserError(
        `Files over ${limit / 1_000_000} MB cannot be read`,
        413,
      );
    const buffer = Buffer.alloc(Math.min(info.size + 1, limit + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit)
      throw new FileBrowserError("File is too large to preview", 413);
    if (bytesRead !== info.size)
      throw new FileBrowserError("File changed while being read; retry", 409);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
export async function readWorkspaceFile(root: string, path: string) {
  return textFile(await readWorkspaceBytes(root, path, 1_000_000));
}
async function git(root: string, args: string[]) {
  const gitRoot = join(root, ".git");
  if (!(await lstat(gitRoot)).isDirectory())
    throw new FileBrowserError("Git history is not available", 409);
  for (const path of ["objects", "objects/info"]) {
    if ((await lstat(join(gitRoot, path))).isSymbolicLink())
      throw new FileBrowserError("Linked Git history cannot be read", 403);
  }
  if (
    await lstat(join(gitRoot, "objects/info/alternates")).then(
      () => true,
      () => false,
    )
  )
    throw new FileBrowserError("External Git history cannot be read", 403);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"].includes(
        key.toUpperCase(),
      ),
    ),
  );
  return new Promise<Buffer>((resolveResult, reject) => {
    execFile(
      "git",
      [
        "--no-pager",
        "--literal-pathspecs",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      {
        cwd: root,
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 1_000_000,
        encoding: "buffer",
        env: {
          ...env,
          NODE_ENV: process.env.NODE_ENV ?? "development",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
      (error, stdout) =>
        error
          ? reject(
              new FileBrowserError("Requested Git version is unavailable", 404),
            )
          : resolveResult(stdout),
    );
  });
}
export async function workspaceFileHistory(
  root: string,
  path: string,
  offset: number,
) {
  filePath(path);
  if (!path || !Number.isInteger(offset) || offset < 0 || offset > 100000)
    throw new FileBrowserError("Invalid history request");
  const output = await git(root, [
    "log",
    "--follow",
    "--max-count=26",
    `--skip=${offset}`,
    "--format=%x1e%H%x00%aI%x00%an%x00%s%x00",
    "--name-only",
    "-z",
    "--",
    path,
  ]);
  const entries = output
    .toString("utf8")
    .split("\x1e")
    .filter(Boolean)
    .map((record) => {
      const [revision, date, author, subject, ...names] = record.split("\0");
      const historicalPath =
        names.map((name) => name.replace(/^\n+/, "")).find(Boolean) ?? path;
      return {
        revision: revision!,
        date: date!,
        author: author!,
        subject: subject!,
        path: filePath(historicalPath),
      };
    });
  return {
    entries: entries.slice(0, 25),
    nextOffset: entries.length > 25 ? offset + 25 : null,
  };
}
export async function workspaceArtifactChanges(root: string, baseRef?: string) {
  const tracked = new Set(
    (await git(root, ["ls-files", "-z"]))
      .toString("utf8")
      .split("\0")
      .filter(Boolean),
  );
  const ref =
    baseRef && /^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,199}$/.test(baseRef)
      ? baseRef
      : "HEAD";
  const changed = new Set(
    (await git(root, ["diff", "--name-only", "-z", ref, "--"]))
      .toString("utf8")
      .split("\0")
      .filter(Boolean),
  );
  return { tracked, changed };
}
export async function readWorkspaceVersion(
  root: string,
  path: string,
  revision: string,
) {
  if (!filePath(path) || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision))
    throw new FileBrowserError("Invalid file revision");
  return textFile(await git(root, ["show", `${revision}:${path}`]));
}

export async function workspaceChanges(root: string, baseRef: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,199}$/.test(baseRef))
    throw new FileBrowserError("Invalid base reference");
  let base = (
    await git(root, ["merge-base", `refs/remotes/origin/${baseRef}`, "HEAD"])
  )
    .toString("utf8")
    .trim();
  // Keep the session's original comparison even when its PR was merged and
  // origin/main later advanced. The oldest task-branch reflog is its creation.
  if (/^task_[a-zA-Z0-9_-]+$/.test(basename(root))) {
    const active = (await git(root, ["branch", "--show-current"]))
      .toString("utf8")
      .trim();
    const generation = active.startsWith(`nimbus/${basename(root)}-pr-`)
      ? active.slice(`nimbus/${basename(root)}-pr-`.length)
      : "1";
    const cycleBase = /^[2-9]\d*$|^1\d+$/.test(generation)
      ? await git(root, [
          "rev-parse",
          "--verify",
          `refs/nimbus/pr-bases/pr-${generation}`,
        ]).then(
          (output) => output.toString("utf8").trim(),
          () => undefined,
        )
      : undefined;
    const original = await git(root, [
      "reflog",
      "show",
      "--format=%H",
      `refs/heads/nimbus/${basename(root)}`,
    ]).then(
      (output) => output.toString("utf8").trim().split("\n").at(-1),
      () => undefined,
    );
    if (cycleBase && /^[a-f0-9]{40}$/.test(cycleBase)) base = cycleBase;
    else if (original && /^[a-f0-9]{40}$/.test(original)) base = original;
  }
  if (!/^[a-f0-9]{40}$/.test(base))
    throw new FileBrowserError("Comparison base is unavailable", 409);
  const tokens = (
    await git(root, [
      "diff",
      "--name-status",
      "-z",
      "--find-renames",
      base,
      "--",
    ])
  )
    .toString("utf8")
    .split("\0");
  const entries: {
    path: string;
    previousPath?: string;
    status: string;
    patch: string;
    additions: number;
    deletions: number;
    binary: boolean;
  }[] = [];
  for (let i = 0; i < tokens.length && tokens[i]; ) {
    const code = tokens[i++]!;
    const first = filePath(tokens[i++] ?? "");
    const path =
      code.startsWith("R") || code.startsWith("C")
        ? filePath(tokens[i++] ?? "")
        : first;
    if (!path || isPrivateArtifactPath(path) || isPrivateArtifactPath(first))
      continue;
    const patch = (
      await git(root, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--find-renames",
        base,
        "--",
        first,
        ...(path !== first ? [path] : []),
      ])
    ).toString("utf8");
    let additions = 0;
    let deletions = 0;
    let inHunk = false;
    for (const line of patch.split("\n")) {
      if (line.startsWith("diff --git ")) inHunk = false;
      if (line.startsWith("@@")) inHunk = true;
      else if (inHunk && line.startsWith("+")) additions++;
      else if (inHunk && line.startsWith("-")) deletions++;
    }
    entries.push({
      path,
      ...(first !== path ? { previousPath: first } : {}),
      status: code.startsWith("R")
        ? "renamed"
        : code.startsWith("C")
          ? "copied"
          : code === "A"
            ? "added"
            : code === "D"
              ? "deleted"
              : "modified",
      patch,
      additions,
      deletions,
      binary: /^(?:Binary files|GIT binary patch)/m.test(patch),
    });
  }
  const untracked = (
    await git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (entries.length + untracked.length > 500)
    throw new FileBrowserError("Too many changed files to preview", 413);
  for (const raw of untracked) {
    const path = filePath(raw);
    if (isPrivateArtifactPath(path)) continue;
    try {
      const content = await readWorkspaceFile(root, path);
      const lines = content ? content.replace(/\n$/, "").split("\n") : [];
      entries.push({
        path,
        status: "added",
        patch: `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`,
        additions: lines.length,
        deletions: 0,
        binary: false,
      });
    } catch (error) {
      if (!(error instanceof FileBrowserError) || error.status !== 415)
        throw error;
      entries.push({
        path,
        status: "added",
        patch: "Binary file added; text diff unavailable.",
        additions: 0,
        deletions: 0,
        binary: true,
      });
    }
  }
  if (entries.reduce((sum, entry) => sum + entry.patch.length, 0) > 2_000_000)
    throw new FileBrowserError("Changes exceed the diff preview limit", 413);
  return { base, files: entries.sort((a, b) => a.path.localeCompare(b.path)) };
}
