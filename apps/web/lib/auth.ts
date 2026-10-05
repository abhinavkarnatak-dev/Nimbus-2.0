import { createHash, randomBytes } from "node:crypto";

import {
  and,
  db,
  eq,
  gt,
  memberships,
  organizations,
  sessions,
  users,
} from "@nimbus/database";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "nimbus_session";

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createLocalSession(): Promise<string> {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.NIMBUS_LOCAL_AUTH !== "true"
  ) {
    throw new Error("Local authentication is disabled");
  }
  const token = randomBytes(32).toString("base64url");
  await db()
    .insert(sessions)
    .values({
      id: `ses_${crypto.randomUUID().replaceAll("-", "")}`,
      userId: "usr_local_01J000000000000000000001",
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    });
  return token;
}

export async function currentIdentity() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [identity] = await db()
    .select({
      userId: users.id,
      userName: users.name,
      email: users.email,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      role: memberships.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(memberships, eq(users.id, memberships.userId))
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        gt(sessions.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);
  return identity ?? null;
}

export async function requireIdentity() {
  const identity = await currentIdentity();
  if (!identity) redirect("/sign-in");
  return identity;
}
