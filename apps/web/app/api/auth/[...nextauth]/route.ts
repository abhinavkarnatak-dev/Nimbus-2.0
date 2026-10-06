import { handlers } from "@/auth";
import {
  googleAuthConfigured,
  googleAuthOrigin,
} from "@/lib/google-auth-policy";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

async function handle(request: NextRequest) {
  if (!googleAuthConfigured())
    return NextResponse.json(
      { error: "Google sign-in is not configured" },
      { status: 503 },
    );
  const origin = googleAuthOrigin()!;
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host !== new URL(origin).host)
    return NextResponse.json(
      { error: "Use the configured Nimbus sign-in origin" },
      { status: 403 },
    );
  return request.method === "POST"
    ? handlers.POST(request)
    : handlers.GET(request);
}

export const GET = handle;
export const POST = handle;
