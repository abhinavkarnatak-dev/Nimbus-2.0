import { nimbusRepositoryRoot } from "@/lib/repository-root";
import { NextResponse } from "next/server";
import { and, db, eq, tasks, workspaces } from "@nimbus/database";
import { currentIdentity } from "@/lib/auth";
import { remoteWorkspace } from "@/lib/remote-workspace";
import {
  readConnectedRepository,
  repositoryContext,
} from "@/lib/repository-browser";
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
  if (record.provider && !["local-test", "e2b"].includes(record.provider))
    return NextResponse.json(
      { error: "The task workspace is not available for file browsing yet" },
      { status: 409, headers },
    );
  try {
    const url = new URL(request.url);
    const path = url.searchParams.get("path") ?? "";
    const operation = url.searchParams.get("operation") ?? "tree";
    if (!["local-test", "e2b"].includes(record.provider ?? "")) {
      const context = await repositoryContext(taskId);
      if (!context)
        return NextResponse.json(
          { error: "Ask Nimbus about a repository first" },
          { status: 409, headers },
        );
      if (operation === "history")
        return NextResponse.json(
          { entries: [], nextOffset: null },
          { headers },
        );
      if (
        !["tree", "read"].includes(operation) ||
        url.searchParams.has("revision")
      )
        throw new FileBrowserError("This repository view is read-only");
      const result = await readConnectedRepository(
        identity.organizationId,
        context.repositoryId,
        path,
        context.sha,
      );
      if (operation === "tree" && result.entries)
        return NextResponse.json({ entries: result.entries }, { headers });
      if (operation === "read" && typeof result.content === "string")
        return NextResponse.json(
          { path, revision: null, content: result.content },
          { headers },
        );
      throw new FileBrowserError(
        "The requested file or directory is unavailable",
      );
    }
    // Browse the checkpointed mirror. Only a deliberate root refresh exports the
    // active sandbox; changes retain their existing live-sync behavior.
    if (
      record.provider === "e2b" &&
      (operation === "changes" ||
        (operation === "tree" &&
          path === "" &&
          url.searchParams.get("sync") === "true"))
    )
      await remoteWorkspace(taskId, "sync");
    const root = await taskFileRoot(nimbusRepositoryRoot(), taskId);
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
