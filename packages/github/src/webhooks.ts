import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

export function verifyGitHubWebhookSignature(
  body: string | Buffer,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature?.startsWith(SIGNATURE_PREFIX) || !secret) return false;
  const expected = `${SIGNATURE_PREFIX}${createHmac("sha256", secret)
    .update(body)
    .digest("hex")}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
