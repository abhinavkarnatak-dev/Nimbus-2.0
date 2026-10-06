import { createHash } from "node:crypto";
import { googleAuthOrigin } from "./google-auth-policy";
export const GITHUB_BROWSER_COOKIE = "nimbus_github_oauth";

export function isGitHubSyncOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  const allowed = new Set([new URL(request.url).origin]);
  const authOrigin = googleAuthOrigin();
  if (authOrigin) allowed.add(authOrigin);
  try {
    allowed.add(new URL(gitHubCallbackUrl()).origin);
  } catch {
    // An unconfigured GitHub callback must not expand the origin allowlist.
  }
  // Trust configured public origins, never client-supplied forwarding headers.
  return allowed.has(origin);
}

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
