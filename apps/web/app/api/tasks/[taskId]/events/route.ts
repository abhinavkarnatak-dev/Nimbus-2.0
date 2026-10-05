import { and, asc, db, eq, gt, taskEvents, tasks } from "@nimbus/database";
import { currentIdentity } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const identity = await currentIdentity();
  if (!identity) return new Response("Unauthorized", { status: 401 });
  const { taskId } = await context.params;
  const [owned] = await db()
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.organizationId, identity.organizationId),
      ),
    )
    .limit(1);
  if (!owned) return new Response("Not found", { status: 404 });
  const cursorHeader =
    request.headers.get("Last-Event-ID") ??
    new URL(request.url).searchParams.get("after") ??
    "0";
  const cursor = Number.isSafeInteger(Number(cursorHeader))
    ? Number(cursorHeader)
    : 0;
  const events = await db()
    .select()
    .from(taskEvents)
    .where(and(eq(taskEvents.taskId, taskId), gt(taskEvents.sequence, cursor)))
    .orderBy(asc(taskEvents.sequence));
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events)
        controller.enqueue(
          encoder.encode(
            `id: ${event.sequence}\nevent: task_event\ndata: ${JSON.stringify(event)}\n\n`,
          ),
        );
      controller.enqueue(
        encoder.encode(
          `event: replay_complete\ndata: {"lastSequence":${events.at(-1)?.sequence ?? cursor}}\n\n`,
        ),
      );
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
