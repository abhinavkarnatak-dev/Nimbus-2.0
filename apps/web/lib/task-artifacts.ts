import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  writeFile,
  readFile,
  link,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { and, artifacts, db, desc, eq } from "@nimbus/database";
import {
  FileBrowserError,
  filePath,
  listWorkspaceDirectory,
  readWorkspaceBytes,
  taskFileRoot,
  workspaceArtifactChanges,
} from "./workspace-files";
import { artifactMimeType, isPrivateArtifactPath } from "./artifact-policy";

function hash(data: Buffer | string) {
  return createHash("sha256").update(data).digest("hex");
}
async function artifactDirectory(repositoryRoot: string, taskId: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId))
    throw new FileBrowserError("Invalid task", 404);
  let directory = resolve(repositoryRoot);
  for (const segment of [".nimbus", "artifacts", taskId]) {
    directory = join(directory, segment);
    await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new FileBrowserError("Artifact storage is unavailable", 409);
  }
  return directory;
}
export async function preserveArtifact(
  repositoryRoot: string,
  taskId: string,
  path: string,
) {
  filePath(path);
  if (isPrivateArtifactPath(path))
    throw new FileBrowserError(
      "Credential files cannot be published as artifacts",
      403,
    );
  const root = await taskFileRoot(repositoryRoot, taskId);
  const data = await readWorkspaceBytes(root, path);
  const mimeType = artifactMimeType(path);
  if (
    mimeType === "application/pdf" &&
    data.subarray(0, 5).toString() !== "%PDF-"
  )
    throw new FileBrowserError("This file is not a PDF", 415);
  if (
    mimeType === "application/pdf" &&
    !data.subarray(-1024).toString("latin1").includes("%%EOF")
  )
    throw new FileBrowserError(
      "The PDF is still being generated. Retry after the task finishes",
      409,
    );
  const checksum = hash(data);
  const id = `art_${hash(`${taskId}\0${path}\0${checksum}`)}`;
  const directory = await artifactDirectory(repositoryRoot, taskId);
  const suffix = mimeType === "application/pdf" ? "pdf" : "bin";
  const target = join(directory, `${checksum}.${suffix}`);
  const temporary = join(directory, `pending-${randomUUID()}`);
  try {
    await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
    await link(temporary, target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(target);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size !== data.length ||
      hash(await readFile(target)) !== checksum
    )
      throw new FileBrowserError("Artifact integrity check failed", 409);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  await db()
    .insert(artifacts)
    .values({
      id,
      taskId,
      name: path,
      mimeType,
      objectKey: `${taskId}/${checksum}.${suffix}`,
      sizeBytes: data.length,
      checksum,
    })
    .onConflictDoNothing();
  return id;
}
export const preservePdf = preserveArtifact;
export async function preserveWorkspaceArtifacts(
  repositoryRoot: string,
  taskId: string,
  requestedPath?: string,
  baseRef?: string,
) {
  if (requestedPath) {
    await preserveArtifact(repositoryRoot, taskId, requestedPath);
    return;
  }
  const root = await taskFileRoot(repositoryRoot, taskId);
  const { tracked, changed } = await workspaceArtifactChanges(root, baseRef);
  const directories = [""];
  let examined = 0;
  let captured = 0;
  while (directories.length) {
    const directory = directories.pop()!;
    for (const entry of await listWorkspaceDirectory(root, directory)) {
      if (++examined > 10000)
        throw new FileBrowserError(
          "Large workspace: select a specific file to preserve it",
          413,
        );
      if (
        entry.kind === "directory" &&
        !["node_modules", ".venv", "venv", ".next", "__pycache__"].includes(
          entry.name,
        ) &&
        !isPrivateArtifactPath(entry.path) &&
        entry.path.split("/").length < 24
      )
        directories.push(entry.path);
      if (
        entry.kind === "file" &&
        !isPrivateArtifactPath(entry.path) &&
        (!tracked.has(entry.path) ||
          changed.has(entry.path) ||
          /\.pdf$/i.test(entry.name))
      ) {
        if (++captured > 50)
          throw new FileBrowserError(
            "Select a specific file to preserve more outputs",
            413,
          );
        await preserveArtifact(repositoryRoot, taskId, entry.path);
      }
    }
  }
}
export async function listTaskArtifacts(taskId: string) {
  return db()
    .select()
    .from(artifacts)
    .where(eq(artifacts.taskId, taskId))
    .orderBy(desc(artifacts.createdAt));
}
export async function downloadTaskArtifact(
  repositoryRoot: string,
  taskId: string,
  artifactId: string,
) {
  const [artifact] = await db()
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.taskId, taskId), eq(artifacts.id, artifactId)));
  if (!artifact) throw new FileBrowserError("Artifact not found", 404);
  if (
    !/^[a-f0-9]{64}$/.test(artifact.checksum) ||
    ![
      `${taskId}/${artifact.checksum}.pdf`,
      `${taskId}/${artifact.checksum}.bin`,
    ].includes(artifact.objectKey)
  )
    throw new FileBrowserError("Artifact download is unavailable", 409);
  const target = join(
    await artifactDirectory(repositoryRoot, taskId),
    artifact.objectKey.split("/")[1]!,
  );
  const info = await lstat(target);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 50_000_000 ||
    info.size !== artifact.sizeBytes
  )
    throw new FileBrowserError("Artifact integrity check failed", 409);
  const data = await readFile(target);
  if (hash(data) !== artifact.checksum)
    throw new FileBrowserError("Artifact integrity check failed", 409);
  return { artifact, data };
}
