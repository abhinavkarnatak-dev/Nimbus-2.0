import { randomBytes } from "node:crypto";
import { db, githubAuthorizations } from "@nimbus/database";
import { hasGitHubAppConfig } from "@nimbus/github";
import { currentIdentity } from "@/lib/auth";
import {
  gitHubCallbackUrl,
  hashGitHubState,
  GITHUB_BROWSER_COOKIE,
} from "@/lib/github-security";
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
  if (request.headers.get("origin") !== new URL(redirectUri).origin)
    return NextResponse.json(
      { error: "Start GitHub connection from the configured Nimbus origin" },
      { status: 403 },
    );
  const token = randomBytes(32).toString("base64url");
  const form = request.headers
    .get("content-type")
    ?.includes("application/x-www-form-urlencoded")
    ? await request.formData()
    : null;
  const onboarding = form?.get("returnTo") === "/onboarding";
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
  const target = new URL(
    `https://github.com/apps/${encodeURIComponent(process.env.GITHUB_APP_SLUG!)}/installations/new`,
  );
  target.searchParams.set("state", state);
  const response = new NextResponse(null, {
    status: 303,
    headers: { location: target.toString(), "cache-control": "no-store" },
  });
  response.cookies.set(GITHUB_BROWSER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(redirectUri).protocol === "https:",
    path: "/api/github",
    maxAge: 600,
  });
  response.cookies.set(
    "nimbus_github_return",
    onboarding ? "/onboarding" : "/settings#connections",
    {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(redirectUri).protocol === "https:",
      path: "/api/github",
      maxAge: 600,
    },
  );
  return response;
}
