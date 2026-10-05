import { randomBytes } from "node:crypto";
import { db, githubAuthorizations } from "@nimbus/database";
import { hasGitHubAppConfig } from "@nimbus/github";
import { currentIdentity, SESSION_COOKIE } from "@/lib/auth";
import { gitHubCallbackUrl, hashGitHubState } from "@/lib/github-security";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Sign in to Nimbus first" },
      { status: 401 },
    );
  if (!["owner", "admin"].includes(identity.role))
    return NextResponse.json(
      { error: "Organization administrator required" },
      { status: 403 },
    );
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  if (!hasGitHubAppConfig())
    return NextResponse.json(
      { error: "GitHub App configuration is incomplete" },
      { status: 503 },
    );
  let redirectUri: string;
  try {
    redirectUri = gitHubCallbackUrl();
  } catch {
    return NextResponse.json(
      { error: "GitHub callback URL is not configured" },
      { status: 503 },
    );
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token)
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const state = randomBytes(32).toString("base64url");
  await db()
    .insert(githubAuthorizations)
    .values({
      stateHash: hashGitHubState(state),
      userId: identity.userId,
      organizationId: identity.organizationId,
      browserHash: hashGitHubState(token),
      redirectUri,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
  const target = new URL("https://github.com/login/oauth/authorize");
  target.searchParams.set("client_id", process.env.GITHUB_APP_CLIENT_ID!);
  target.searchParams.set("redirect_uri", redirectUri);
  target.searchParams.set("state", state);
  return new NextResponse(null, {
    status: 303,
    headers: { location: target.toString(), "cache-control": "no-store" },
  });
}
