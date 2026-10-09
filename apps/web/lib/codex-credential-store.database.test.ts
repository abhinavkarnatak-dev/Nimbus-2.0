import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, codexCredentials, db, eq } from "@nimbus/database";

import {
  readCredential,
  revokeCredential,
  writeCredential,
} from "./codex-credential-store";

// The fencing that keeps a disconnected account disconnected is the part a mock
// cannot prove, so it is checked against a real Postgres.
describe.runIf(process.env.NIMBUS_CODEX_DATABASE_TEST === "true")(
  "durable Codex credential store",
  () => {
    const accountKey = `codex_store_org:codex_store_user_${Date.now()}`;
    const rows = () =>
      db()
        .select({
          kind: codexCredentials.kind,
          blob: codexCredentials.blob,
          revokedAt: codexCredentials.revokedAt,
        })
        .from(codexCredentials)
        .where(eq(codexCredentials.accountKey, accountKey));

    beforeAll(() => {
      vi.stubEnv("NIMBUS_CREDENTIAL_KEY", "11".repeat(32));
    });
    afterAll(async () => {
      await db()
        .delete(codexCredentials)
        .where(eq(codexCredentials.accountKey, accountKey));
      await closeDatabase();
      vi.unstubAllEnvs();
    });
    it("round trips a credential without storing it in the clear", async () => {
      expect(
        await writeCredential(accountKey, "auth", '{"token":"secret"}'),
      ).toBe("ok");
      expect(await readCredential(accountKey, "auth")).toBe(
        '{"token":"secret"}',
      );
      const [row] = await rows();
      expect(row?.blob?.startsWith("v1.")).toBe(true);
      expect(row?.blob).not.toContain("secret");
    });
    it("revokes a kind that was never written, so it cannot be inserted later", async () => {
      expect(await revokeCredential(accountKey)).toBe("ok");
      expect(await readCredential(accountKey, "auth")).toBeNull();
      expect(await readCredential(accountKey, "home")).toBeNull();
      const revoked = await rows();
      expect(revoked.map((row) => row.kind).sort()).toEqual(["auth", "home"]);
      expect(revoked.every((row) => row.revokedAt !== null)).toBe(true);
    });
    it("rejects a write that arrives after the revoke", async () => {
      expect(await writeCredential(accountKey, "home", '{"version":1}')).toBe(
        "ok",
      );
      expect(await readCredential(accountKey, "home")).toBeNull();
    });
    it("lets a confirmed new login clear the revocation", async () => {
      expect(
        await writeCredential(accountKey, "home", '{"version":1}', {
          clearRevocation: true,
        }),
      ).toBe("ok");
      expect(await readCredential(accountKey, "home")).toBe('{"version":1}');
    });
  },
);
