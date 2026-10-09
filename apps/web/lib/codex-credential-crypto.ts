import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

// Codex stores its device-login credential in one file on the container
// filesystem. A free web service replaces that container on every restart,
// redeploy, and spin-down, so the file is only a cache: the encrypted blob in
// Postgres is the source of truth. Losing this key is not a credential leak, it
// only makes stored connections unreadable, and the user reconnects once.
export const CREDENTIAL_ALGORITHM = "aes-256-gcm";
export const CREDENTIAL_BLOB_VERSION = 1;

const KEY_PATTERN = /^[a-f0-9]{64}$/;
const BLOB_PREFIX = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

let warned = false;

export function credentialKeyConfigured(): boolean {
  return KEY_PATTERN.test(process.env.NIMBUS_CREDENTIAL_KEY ?? "");
}

function encryptionKey(): Buffer | null {
  const configured = process.env.NIMBUS_CREDENTIAL_KEY ?? "";
  if (KEY_PATTERN.test(configured)) return Buffer.from(configured, "hex");
  if (!warned) {
    warned = true;
    console.error(
      "NIMBUS_CREDENTIAL_KEY is missing or not a 64-character lowercase hex secret, so Codex connections cannot be stored durably and are lost whenever the service restarts.",
    );
  }
  return null;
}

// The key is the only deploy-stable input. A per-deploy key would make every
// stored blob undecryptable, which is the same bug with more steps.
export function credentialPersistenceAvailable(): boolean {
  return encryptionKey() !== null;
}

export function encryptCredential(
  accountKey: string,
  plaintext: string,
): string {
  const key = encryptionKey();
  if (!key) throw new Error("NIMBUS_CREDENTIAL_KEY is required");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CREDENTIAL_ALGORITHM, key, iv);
  // Bind the row to its identity so a blob copied between accounts fails closed.
  cipher.setAAD(Buffer.from(accountKey, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  return [
    BLOB_PREFIX,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

// Returns null for a missing key, a rotated key, or a tampered blob. Callers
// treat that as "no saved login", never as an error the user must see.
export function decryptCredential(
  accountKey: string,
  blob: string,
): string | null {
  const key = encryptionKey();
  if (!key) return null;
  const [prefix, ivPart, tagPart, cipherPart] = blob.split(".");
  if (
    prefix !== BLOB_PREFIX ||
    ivPart === undefined ||
    tagPart === undefined ||
    cipherPart === undefined
  )
    return null;
  try {
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv(CREDENTIAL_ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(accountKey, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(cipherPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function credentialDigest(plaintext: string | Buffer): string {
  return createHash("sha256").update(plaintext).digest("hex");
}
