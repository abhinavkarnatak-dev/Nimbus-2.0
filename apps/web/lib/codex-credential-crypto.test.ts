import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CREDENTIAL_BLOB_VERSION,
  credentialDigest,
  credentialPersistenceAvailable,
  decryptCredential,
  encryptCredential,
} from "./codex-credential-crypto";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

afterEach(() => vi.unstubAllEnvs());

describe("Codex credential encryption", () => {
  it("round trips a credential blob for its own identity", () => {
    vi.stubEnv("NIMBUS_CREDENTIAL_KEY", KEY_A);
    const blob = encryptCredential("org:user", '{"tokens":{"access":"x"}}');
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob).not.toContain("tokens");
    expect(decryptCredential("org:user", blob)).toBe(
      '{"tokens":{"access":"x"}}',
    );
    expect(CREDENTIAL_BLOB_VERSION).toBe(1);
  });

  it("fails closed for a different identity, a rotated key, or a tampered blob", () => {
    vi.stubEnv("NIMBUS_CREDENTIAL_KEY", KEY_A);
    const blob = encryptCredential("org:user", "secret");
    expect(decryptCredential("org:other-user", blob)).toBeNull();
    const parts = blob.split(".");
    const flipped = Buffer.from(parts[3]!, "base64url");
    flipped[0] = (flipped[0]! + 1) % 256;
    expect(
      decryptCredential(
        "org:user",
        [parts[0], parts[1], parts[2], flipped.toString("base64url")].join("."),
      ),
    ).toBeNull();
    vi.stubEnv("NIMBUS_CREDENTIAL_KEY", KEY_B);
    expect(decryptCredential("org:user", blob)).toBeNull();
  });

  it("rejects malformed blobs without throwing", () => {
    vi.stubEnv("NIMBUS_CREDENTIAL_KEY", KEY_A);
    for (const blob of ["", "v1", "v2.a.b.c", "v1..", "v1.a.b.c.d"])
      expect(decryptCredential("org:user", blob)).toBeNull();
  });

  it("reports an unusable key instead of storing plaintext", () => {
    vi.stubEnv("NIMBUS_CREDENTIAL_KEY", "short");
    expect(credentialPersistenceAvailable()).toBe(false);
    expect(() => encryptCredential("org:user", "secret")).toThrow();
    vi.stubEnv("NIMBUS_CREDENTIAL_KEY", KEY_A.toUpperCase());
    expect(credentialPersistenceAvailable()).toBe(false);
    vi.stubEnv("NIMBUS_CREDENTIAL_KEY", KEY_A);
    expect(credentialPersistenceAvailable()).toBe(true);
  });

  it("digests identical content to the same value", () => {
    expect(credentialDigest("a")).toBe(credentialDigest(Buffer.from("a")));
    expect(credentialDigest("a")).not.toBe(credentialDigest("b"));
  });
});
