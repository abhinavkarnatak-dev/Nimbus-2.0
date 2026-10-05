import { createLocalSession, SESSION_COOKIE } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "";
  if (
    request.headers.has("cf-connecting-ip") ||
    !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
  ) {
    return NextResponse.json(
      { error: "Development sign-in is available only on localhost" },
      { status: 403 },
    );
  }
  try {
    const token = await createLocalSession();
    const response = new NextResponse(null, {
      status: 303,
      headers: { location: "/" },
    });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: "Local authentication is unavailable" },
      { status: 404 },
    );
  }
}
