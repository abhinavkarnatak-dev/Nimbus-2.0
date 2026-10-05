import { createHash } from "node:crypto";

export function hashGitHubState(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function gitHubCallbackUrl(): string {
  const value = process.env.GITHUB_APP_CALLBACK_URL;
  if (!value) throw new Error("GITHUB_APP_CALLBACK_URL is required");
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/github/callback" ||
    (url.protocol !== "https:" &&
      !(
        loopback &&
        process.env.NODE_ENV !== "production" &&
        url.protocol === "http:"
      ))
  ) {
    throw new Error("Invalid GitHub callback URL");
  }
  return url.toString();
}

export async function readBoundedBody(
  request: Request,
  limit = 2_000_000,
): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Webhook body exceeds limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
