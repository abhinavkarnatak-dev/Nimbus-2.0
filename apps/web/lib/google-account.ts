import { randomUUID } from "node:crypto";
import {
  accounts,
  and,
  db,
  eq,
  memberships,
  organizations,
  sql,
  users,
} from "@nimbus/database";
import { verifiedGoogleIdentity, workspaceName } from "./google-auth-policy";

export async function provisionGoogleAccount(
  profile: unknown,
): Promise<string> {
  const identity = verifiedGoogleIdentity(profile);
  return db().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`google:${identity.subject}`}, 0))`,
    );
    const [existing] = await tx
      .select({ userId: accounts.userId })
      .from(accounts)
      .where(
        and(
          eq(accounts.provider, "google"),
          eq(accounts.providerAccountId, identity.subject),
        ),
      )
      .limit(1);
    if (existing) return existing.userId;
    const [emailOwner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, identity.email))
      .limit(1);
    if (emailOwner)
      throw new Error(
        "This email belongs to another Nimbus account; automatic linking is disabled",
      );
    const userId = `usr_${randomUUID().replaceAll("-", "")}`;
    const organizationId = `org_${randomUUID().replaceAll("-", "")}`;
    await tx.insert(users).values({
      id: userId,
      email: identity.email,
      name: identity.name,
      avatarUrl: identity.image,
    });
    await tx.insert(accounts).values({
      id: `acc_${randomUUID().replaceAll("-", "")}`,
      userId,
      provider: "google",
      providerAccountId: identity.subject,
    });
    await tx.insert(organizations).values({
      id: organizationId,
      slug: organizationId,
      name: workspaceName(identity.name),
    });
    await tx
      .insert(memberships)
      .values({ userId, organizationId, role: "owner" });
    return userId;
  });
}
