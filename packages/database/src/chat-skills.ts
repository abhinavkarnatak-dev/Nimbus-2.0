import { and, eq, inArray, isNull, asc } from "drizzle-orm";
import { db } from "./index.js";
import { skills } from "./schema.js";
import type { SkillSnapshot } from "@nimbus/shared";

export function ownedSkillScope(organizationId: string, userId: string) {
  return and(
    eq(skills.organizationId, organizationId),
    eq(skills.ownerUserId, userId),
    isNull(skills.disabledAt),
  );
}
export async function listChatSkills(
  organizationId: string,
  userId: string,
): Promise<SkillSnapshot[]> {
  return db()
    .select({
      id: skills.id,
      name: skills.name,
      description: skills.description,
      summary: skills.summary,
    })
    .from(skills)
    .where(ownedSkillScope(organizationId, userId))
    .orderBy(asc(skills.name));
}
// Do not fetch every instruction body merely to advertise available skills.
export async function listChatSkillCatalog(
  organizationId: string,
  userId: string,
) {
  return db()
    .select({
      id: skills.id,
      name: skills.name,
      description: skills.description,
    })
    .from(skills)
    .where(ownedSkillScope(organizationId, userId))
    .orderBy(asc(skills.name));
}
export async function resolveChatSkills(
  organizationId: string,
  userId: string,
  ids: string[],
): Promise<SkillSnapshot[] | null> {
  if (!ids.length) return [];
  const rows = await db()
    .select({
      id: skills.id,
      name: skills.name,
      description: skills.description,
      summary: skills.summary,
    })
    .from(skills)
    .where(
      and(ownedSkillScope(organizationId, userId), inArray(skills.id, ids)),
    );
  if (rows.length !== ids.length || rows.some((row) => !row.summary.trim()))
    return null;
  return ids.map((id) => rows.find((row) => row.id === id)!);
}
