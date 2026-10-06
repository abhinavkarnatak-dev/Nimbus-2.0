import { NextResponse } from "next/server";
import { currentIdentity } from "@/lib/auth";
import { reconcileGitHubRepositories } from "@/lib/github-repositories";
import { isGitHubSyncOrigin } from "@/lib/github-security";

export async function POST(request: Request) {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!isGitHubSyncOrigin(request))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  try {
    return NextResponse.json(
      await reconcileGitHubRepositories(identity.organizationId),
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not refresh repository access from GitHub. Try again." },
      { status: 502 },
    );
  }
}
