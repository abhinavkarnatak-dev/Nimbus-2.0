import { currentIdentity } from "@/lib/auth";
import { onboardingStatus } from "@/lib/onboarding";
import { googleAuthOrigin } from "@/lib/google-auth-policy";
import { db, eq, users } from "@nimbus/database";
import { NextResponse } from "next/server";

export async function GET() {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.json(await onboardingStatus(identity), {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (
    request.headers.get("origin") !==
    (googleAuthOrigin() ?? new URL(request.url).origin)
  )
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const state = await onboardingStatus(identity);
  if (!state.completed && !state.ready)
    return NextResponse.json(
      {
        error: "Connect Codex first. GitHub is optional for repository work",
      },
      { status: 409 },
    );
  if (!state.completed)
    await db()
      .update(users)
      .set({ onboardingCompletedAt: new Date().toISOString() })
      .where(eq(users.id, identity.userId));
  return NextResponse.json({ completed: true });
}
