import { sessionTitleFromResponse } from "@nimbus/shared";
import { db } from "./index.js";
import { tasks } from "./schema.js";
import { and, eq, isNull } from "drizzle-orm";

export async function persistGeneratedTaskTitle(
  taskId: string,
  organizationId: string,
  title: string,
): Promise<boolean> {
  if (sessionTitleFromResponse(`## ${title}`) !== title) return false;
  const result = await db()
    .update(tasks)
    .set({ title, titleGeneratedAt: new Date().toISOString() })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.organizationId, organizationId),
        isNull(tasks.titleGeneratedAt),
      ),
    )
    .returning({ id: tasks.id });
  return result.length === 1;
}
