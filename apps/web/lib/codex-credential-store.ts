// Operators come from the database package so the web app and the schema share
// one drizzle-orm resolution.
import { and, codexCredentials, db, eq, isNull } from "@nimbus/database";

import {
  CREDENTIAL_ALGORITHM,
  CREDENTIAL_BLOB_VERSION,
  credentialPersistenceAvailable,
  decryptCredential,
  encryptCredential,
} from "./codex-credential-crypto";

// "auth" is the Codex auth.json credential file; "home" is a bounded snapshot of
// the rest of the credential directory, which holds the thread rollout files a
// resumed follow-up needs.
export type CredentialKind = "auth" | "home";

// "skipped" means the store is not configured, which is a supported state.
// "failed" means a configured store could not be reached.
export type StoreOutcome = "ok" | "skipped" | "failed";

let warned = false;

function warnUnavailable(error: unknown) {
  if (warned) return;
  warned = true;
  console.error(
    "The Codex credential store is unreachable, so connections will not survive a restart.",
    error instanceof Error ? error.message : error,
  );
}

// The account key is the only lookup identity. The split parts are metadata for
// scoping and cleanup, and a key that does not split cleanly still works.
function identity(accountKey: string): {
  organizationId: string | null;
  userId: string | null;
} {
  const index = accountKey.indexOf(":");
  if (index <= 0 || index === accountKey.length - 1)
    return { organizationId: null, userId: null };
  return {
    organizationId: accountKey.slice(0, index),
    userId: accountKey.slice(index + 1),
  };
}

export async function readCredential(
  accountKey: string,
  kind: CredentialKind,
): Promise<string | null> {
  if (!credentialPersistenceAvailable()) return null;
  try {
    const [row] = await db()
      .select({
        blob: codexCredentials.blob,
        revokedAt: codexCredentials.revokedAt,
      })
      .from(codexCredentials)
      .where(
        and(
          eq(codexCredentials.accountKey, accountKey),
          eq(codexCredentials.kind, kind),
        ),
      )
      .limit(1);
    if (!row?.blob || row.revokedAt) return null;
    return decryptCredential(accountKey, row.blob);
  } catch (error) {
    warnUnavailable(error);
    return null;
  }
}

export async function writeCredential(
  accountKey: string,
  kind: CredentialKind,
  plaintext: string,
  options: { clearRevocation?: boolean } = {},
): Promise<StoreOutcome> {
  if (!credentialPersistenceAvailable()) return "skipped";
  const now = new Date().toISOString();
  try {
    const blob = encryptCredential(accountKey, plaintext);
    await db()
      .insert(codexCredentials)
      .values({
        accountKey,
        kind,
        ...identity(accountKey),
        blob,
        algorithm: CREDENTIAL_ALGORITHM,
        blobVersion: CREDENTIAL_BLOB_VERSION,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [codexCredentials.accountKey, codexCredentials.kind],
        set: {
          blob,
          algorithm: CREDENTIAL_ALGORITHM,
          blobVersion: CREDENTIAL_BLOB_VERSION,
          updatedAt: now,
          // Only an explicit new login may clear a revocation.
          ...(options.clearRevocation ? { revokedAt: null } : {}),
        },
        // A write queued before a disconnect must never restore a revoked
        // account, so an ordinary sync only updates a live row.
        ...(options.clearRevocation
          ? {}
          : { setWhere: isNull(codexCredentials.revokedAt) }),
      });
    return "ok";
  } catch (error) {
    warnUnavailable(error);
    return "failed";
  }
}

// Disconnect revokes every kind for this identity: the home snapshot also
// contains the credential file, so leaving it behind would restore the account.
export async function revokeCredential(
  accountKey: string,
): Promise<StoreOutcome> {
  if (!credentialPersistenceAvailable()) return "skipped";
  const now = new Date().toISOString();
  try {
    await db()
      .update(codexCredentials)
      .set({ blob: null, revokedAt: now, updatedAt: now })
      .where(eq(codexCredentials.accountKey, accountKey));
    return "ok";
  } catch (error) {
    warnUnavailable(error);
    return "failed";
  }
}
