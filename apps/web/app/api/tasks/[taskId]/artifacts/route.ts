import { basename } from "node:path";
import { nimbusRepositoryRoot } from "@/lib/repository-root";
import { NextResponse } from "next/server";
import { and, db, eq, tasks, workspaces } from "@nimbus/database";
import { currentIdentity } from "@/lib/auth";
import { remoteWorkspace } from "@/lib/remote-workspace";
import { isGitHubSyncOrigin as isTrustedOrigin } from "@/lib/github-security";
import { readBoundedBody } from "@/lib/github-security";
import { FileBrowserError } from "@/lib/workspace-files";
import {
  downloadTaskArtifact,
  listTaskArtifacts,
  preserveWorkspaceArtifacts,
} from "@/lib/task-artifacts";
const headers = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};
type Context = { params: Promise<{ taskId: string }> };
async function authorizedTask(taskId: string) {
  const identity = await currentIdentity();
  if (!identity) throw new FileBrowserError("Sign in first", 401);
  const [record] = await db()
    .select({ provider: workspaces.provider, baseRef: tasks.baseRef })
    .from(tasks)
    .leftJoin(workspaces, eq(tasks.id, workspaces.taskId))
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.organizationId, identity.organizationId),
      ),
    );
  if (!record) throw new FileBrowserError("Task not found", 404);
  return record;
}
function failure(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof FileBrowserError
          ? error.message
          : "Artifact is unavailable. Please retry.",
    },
    { status: error instanceof FileBrowserError ? error.status : 503, headers },
  );
}
export async function GET(request: Request, context: Context) {
  try {
    const { taskId } = await context.params;
    await authorizedTask(taskId);
    const id = new URL(request.url).searchParams.get("download");
    if (!id)
      return NextResponse.json(
        { artifacts: await listTaskArtifacts(taskId) },
        { headers },
      );
    const { artifact, data } = await downloadTaskArtifact(
      nimbusRepositoryRoot(),
      taskId,
      id,
    );
    const name = encodeURIComponent(basename(artifact.name)).replace(
      /['()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new Response(new Uint8Array(data), {
      headers: {
        ...headers,
        "content-type": artifact.mimeType,
        "content-length": String(data.length),
        "content-disposition": `attachment; filename="artifact"; filename*=UTF-8''${name}`,
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const { taskId } = await context.params;
    const record = await authorizedTask(taskId);
    if (!isTrustedOrigin(request))
      throw new FileBrowserError("Invalid request origin", 403);
    if (!["local-test", "e2b"].includes(record.provider ?? ""))
      throw new FileBrowserError("Task workspace is not available", 409);
    let body: { path?: unknown };
    try {
      body = JSON.parse((await readBoundedBody(request, 4096)).toString()) as {
        path?: unknown;
      };
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => key !== "path")
      )
        throw new Error("Invalid body");
    } catch {
      throw new FileBrowserError("Invalid artifact request");
    }
    if (body.path !== undefined && typeof body.path !== "string")
      throw new FileBrowserError("Invalid artifact path");
    if (record.provider === "e2b") await remoteWorkspace(taskId, "sync");
    await preserveWorkspaceArtifacts(
      nimbusRepositoryRoot(),
      taskId,
      body.path as string | undefined,
      record.baseRef,
    );
    return NextResponse.json(
      { artifacts: await listTaskArtifacts(taskId) },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
