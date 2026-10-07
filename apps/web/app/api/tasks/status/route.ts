import { NextResponse } from "next/server";
import { and, db, eq, inArray, tasks, workspaces } from "@nimbus/database";
import { currentIdentity } from "@/lib/auth";

export async function GET(request: Request) {
  const headers = { "cache-control": "private, no-store" };
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Sign in first" },
      { status: 401, headers },
    );
  const ids = [
    ...new Set((new URL(request.url).searchParams.get("ids") ?? "").split(",")),
  ];
  if (
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => !/^task_[a-zA-Z0-9_-]{1,100}$/.test(id))
  )
    return NextResponse.json(
      { error: "Invalid session ids" },
      { status: 400, headers },
    );
  const rows = await db()
    .select({
      id: tasks.id,
      status: tasks.status,
      updatedAt: tasks.updatedAt,
      archivedAt: tasks.archivedAt,
      workspaceStatus: workspaces.status,
    })
    .from(tasks)
    .leftJoin(workspaces, eq(workspaces.taskId, tasks.id))
    .where(
      and(
        eq(tasks.organizationId, identity.organizationId),
        inArray(tasks.id, ids),
      ),
    );
  return NextResponse.json({ tasks: rows }, { headers });
}
