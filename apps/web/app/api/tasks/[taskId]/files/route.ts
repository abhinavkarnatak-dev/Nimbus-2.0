import { nimbusRepositoryRoot } from "@/lib/repository-root";
import { NextResponse } from "next/server";
import { and, db, eq, tasks, workspaces } from "@nimbus/database";
import { currentIdentity } from "@/lib/auth";
import { remoteWorkspace } from "@/lib/remote-workspace";
import {
  FileBrowserError,
  listWorkspaceDirectory,
  readWorkspaceFile,
  readWorkspaceVersion,
  taskFileRoot,
  workspaceFileHistory,
  workspaceChanges,
} from "@/lib/workspace-files";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const headers = { "cache-control": "private, no-store" };
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Sign in first" },
      { status: 401, headers },
    );
  const { taskId } = await params;
  const [record] = await db()
    .select({ provider: workspaces.provider, baseRef: tasks.baseRef })
    .from(tasks)
    .leftJoin(workspaces, eq(workspaces.taskId, tasks.id))
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.organizationId, identity.organizationId),
      ),
    );
  if (!record)
    return NextResponse.json(
      { error: "Task not found" },
      { status: 404, headers },
    );
  if (!["local-test", "e2b"].includes(record.provider ?? ""))
    return NextResponse.json(
      { error: "The task workspace is not available for file browsing yet" },
      { status: 409, headers },
    );
  try {
    if (record.provider === "e2b") await remoteWorkspace(taskId, "sync");
    const root = await taskFileRoot(nimbusRepositoryRoot(), taskId);
    const url = new URL(request.url);
    const path = url.searchParams.get("path") ?? "";
    const operation = url.searchParams.get("operation") ?? "tree";
    if (operation === "changes")
      return NextResponse.json(await workspaceChanges(root, record.baseRef), {
        headers,
      });
    if (operation === "tree")
      return NextResponse.json(
        { entries: await listWorkspaceDirectory(root, path) },
        { headers },
      );
    if (operation === "history")
      return NextResponse.json(
        await workspaceFileHistory(
          root,
          path,
          Number(url.searchParams.get("offset") ?? 0),
        ),
        { headers },
      );
    if (operation !== "read")
      throw new FileBrowserError("Invalid file operation");
    const revision = url.searchParams.get("revision");
    const content = revision
      ? await readWorkspaceVersion(root, path, revision)
      : await readWorkspaceFile(root, path);
    return NextResponse.json({ path, revision, content }, { headers });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof FileBrowserError
            ? error.message
            : "The requested file or directory is unavailable",
      },
      {
        status: error instanceof FileBrowserError ? error.status : 404,
        headers,
      },
    );
  }
}
