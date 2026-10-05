import { createLocalSession, SESSION_COOKIE } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST() {
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
