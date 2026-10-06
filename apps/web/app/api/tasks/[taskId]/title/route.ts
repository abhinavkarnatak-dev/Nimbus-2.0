import { and, db, eq, tasks } from "@nimbus/database";
import { currentIdentity } from "@/lib/auth";
import { manualTaskTitleSchema } from "@/lib/manual-task-title";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (identity.role === "viewer")
    return NextResponse.json(
      { error: "Session write permission required" },
      { status: 403 },
    );
  let origin: URL;
  try {
    origin = new URL(request.headers.get("origin") ?? "");
  } catch {
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  }
  if (
    origin.host !== request.headers.get("host") ||
    !["http:", "https:"].includes(origin.protocol)
  )
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  const parsed = manualTaskTitleSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Enter a single-line title between 1 and 120 characters" },
      { status: 400 },
    );
  const { taskId } = await context.params;
  const [task] = await db()
    .update(tasks)
    .set({
      title: parsed.data.title,
      // Lock manual titles against a pending first-response title generator.
      titleGeneratedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.organizationId, identity.organizationId),
      ),
    )
    .returning({ id: tasks.id, title: tasks.title });
  if (!task)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json(task);
}
