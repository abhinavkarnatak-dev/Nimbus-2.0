import {
  activeRequestId,
  and,
  asc,
  db,
  eq,
  gt,
  taskEvents,
  tasks,
} from "@nimbus/database";
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
    .select({ id: tasks.id, status: tasks.status })
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
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      let currentCursor = cursor;
      let currentStatus = "";
      let currentRequest = "";
      let stopped = false;
      request.signal.addEventListener("abort", () => {
        stopped = true;
      });
      void (async () => {
        const deadline = Date.now() + 25_000;
        try {
          while (!stopped && Date.now() < deadline) {
            const [task] = await db()
              .select({ status: tasks.status })
              .from(tasks)
              .where(
                and(
                  eq(tasks.id, taskId),
                  eq(tasks.organizationId, identity.organizationId),
                ),
              )
              .limit(1);
            const messageId = task ? await activeRequestId(taskId) : null;
            if (
              task &&
              (task.status !== currentStatus ||
                currentRequest !== (messageId ?? ""))
            ) {
              currentStatus = task.status;
              currentRequest = messageId ?? "";
              controller.enqueue(
                encoder.encode(
                  `event: task_state\ndata: ${JSON.stringify({ status: task.status, messageId })}\n\n`,
                ),
              );
            }
            const events = await db()
              .select()
              .from(taskEvents)
              .where(
                and(
                  eq(taskEvents.taskId, taskId),
                  gt(taskEvents.sequence, currentCursor),
                ),
              )
              .orderBy(asc(taskEvents.sequence));
            for (const event of events) {
              currentCursor = event.sequence;
              controller.enqueue(
                encoder.encode(
                  `id: ${event.sequence}\nevent: task_event\ndata: ${JSON.stringify(event)}\n\n`,
                ),
              );
            }
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                ["running", "provisioning"].includes(task?.status ?? "")
                  ? 250
                  : 1_000,
              ),
            );
          }
          if (!stopped) controller.close();
        } catch (error) {
          if (!stopped) controller.error(error);
        }
      })();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
