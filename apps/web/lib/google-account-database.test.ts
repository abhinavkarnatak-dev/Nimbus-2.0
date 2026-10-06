import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  accounts,
  closeDatabase,
  db,
  eq,
  memberships,
  organizations,
  users,
} from "@nimbus/database";
import { provisionGoogleAccount } from "./google-account";

const enabled = process.env.NIMBUS_AUTH_DATABASE_TEST === "true";
const suffix = randomUUID();
const profile = {
  sub: `google-test-${suffix}`,
  email: `google-${suffix}@example.invalid`,
  name: "OAuth test",
  email_verified: true,
};
const userIds: string[] = [];
const organizationIds: string[] = [];
afterAll(async () => {
  if (!enabled) return;
  for (const id of userIds) {
    const rows = await db()
      .select()
      .from(memberships)
      .where(eq(memberships.userId, id));
    organizationIds.push(...rows.map((row) => row.organizationId));
    await db().delete(users).where(eq(users.id, id));
  }
  for (const id of organizationIds)
    await db().delete(organizations).where(eq(organizations.id, id));
  await closeDatabase();
});
describe.skipIf(!enabled)("Google account persistence", () => {
  it("provisions once under concurrent callbacks and isolates the workspace", async () => {
    const ids = await Promise.all([
      provisionGoogleAccount(profile),
      provisionGoogleAccount(profile),
    ]);
    userIds.push(ids[0]!);
    expect(ids[0]).toBe(ids[1]);
    const rows = await db()
      .select()
      .from(accounts)
      .where(eq(accounts.userId, ids[0]!));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.encryptedRefreshCredential).toBeNull();
    const membership = await db()
      .select()
      .from(memberships)
      .where(eq(memberships.userId, ids[0]!));
    expect(membership).toHaveLength(1);
    expect(membership[0]?.role).toBe("owner");
    expect(membership[0]?.organizationId).not.toBe(
      "org_local_01J000000000000000000001",
    );
    const changedEmail = await provisionGoogleAccount({
      ...profile,
      email: `changed-${suffix}@example.invalid`,
    });
    expect(changedEmail).toBe(ids[0]);
  });
  it("does not link a different Google subject by matching email", async () => {
    await expect(
      provisionGoogleAccount({ ...profile, sub: `${profile.sub}-other` }),
    ).rejects.toThrow("automatic linking is disabled");
  });
  it("rejects unverified profiles before creating data", async () => {
    await expect(
      provisionGoogleAccount({ ...profile, email_verified: false }),
    ).rejects.toThrow("verified Google account");
  });
});
