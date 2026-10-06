import { db } from "./index.js";
import { agentInstructions } from "./schema.js";
import { and, eq } from "drizzle-orm";

export async function readAgentInstructions(
  organizationId: string,
  userId: string,
): Promise<string> {
  const [saved] = await db()
    .select({ content: agentInstructions.content })
    .from(agentInstructions)
    .where(
      and(
        eq(agentInstructions.organizationId, organizationId),
        eq(agentInstructions.userId, userId),
      ),
    );
  return saved?.content ?? "";
}
