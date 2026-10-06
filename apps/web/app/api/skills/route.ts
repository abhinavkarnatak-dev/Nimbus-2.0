import { randomUUID } from "node:crypto";
import {
  and,
  db,
  eq,
  listChatSkills,
  ownedSkillScope,
  skills,
  tasks,
  sql,
} from "@nimbus/database";
import { skillSchema } from "@nimbus/shared";
import { currentIdentity } from "@/lib/auth";
import { readSkillBody, skillOriginError } from "@/lib/skill-request";
import { NextResponse } from "next/server";
import { z } from "zod";

export async function GET() {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.json(
    { skills: await listChatSkills(identity.organizationId, identity.userId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
async function mutate(
  request: Request,
  operation: "create" | "edit" | "delete",
) {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (identity.role === "viewer")
    return NextResponse.json(
      { error: "Write permission required" },
      { status: 403 },
    );
  const originError = skillOriginError(request);
  if (originError) return originError;
  let body: unknown;
  try {
    body = await readSkillBody(request);
  } catch {
    return NextResponse.json(
      { error: "Use plain text skill content up to 20,000 characters" },
      { status: 400 },
    );
  }
  const parsed = (
    operation === "delete"
      ? z.object({ id: z.string().min(1).max(100) })
      : skillSchema.extend({
          id:
            operation === "edit"
              ? z.string().min(1).max(100)
              : z.string().optional(),
        })
  ).safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      {
        error:
          "Name, description, and summary are required (100 / 500 / 20,000 characters maximum)",
      },
      { status: 400 },
    );
  const id =
    operation === "create"
      ? `skl_${randomUUID().replaceAll("-", "")}`
      : parsed.data.id!;
  if (operation === "create") {
    const content = skillSchema.parse(parsed.data);
    await db()
      .insert(skills)
      .values({
        id,
        slug: id,
        organizationId: identity.organizationId,
        ownerUserId: identity.userId,
        ...content,
      });
  } else {
    if (operation === "delete") {
      const deleted = await db().transaction(async (tx) => {
        const [row] = await tx
          .update(skills)
          .set({
            disabledAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(skills.id, id),
              ownedSkillScope(identity.organizationId, identity.userId),
            ),
          )
          .returning({ id: skills.id });
        if (!row) return false;
        await tx
          .update(tasks)
          .set({ selectedSkillIds: sql`${tasks.selectedSkillIds} - ${id}` })
          .where(
            and(
              eq(tasks.organizationId, identity.organizationId),
              eq(tasks.createdByUserId, identity.userId),
              sql`${tasks.selectedSkillIds} ? ${id}`,
            ),
          );
        return true;
      });
      return NextResponse.json(
        deleted ? { id } : { error: "Skill not found" },
        { status: deleted ? 200 : 404 },
      );
    }
    const [updated] = await db()
      .update(skills)
      .set({
        ...skillSchema.parse(parsed.data),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(skills.id, id),
          ownedSkillScope(identity.organizationId, identity.userId),
        ),
      )
      .returning({ id: skills.id });
    if (!updated)
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }
  return NextResponse.json(
    { id },
    { status: operation === "create" ? 201 : 200 },
  );
}
export function POST(request: Request) {
  return mutate(request, "create");
}
export function PUT(request: Request) {
  return mutate(request, "edit");
}
export function DELETE(request: Request) {
  return mutate(request, "delete");
}
