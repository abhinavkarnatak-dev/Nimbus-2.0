import { NextResponse } from "next/server";
import { currentIdentity } from "@/lib/auth";
import {
  deviceConnection,
  disconnectDevice,
  isLocalDeviceRequest,
} from "@/lib/codex-device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(
  request: Request,
  action: "read" | "start" | "disconnect",
) {
  if (!isLocalDeviceRequest(request))
    return NextResponse.json(
      { error: "Codex device connection is available only on localhost" },
      { status: 403 },
    );
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (action !== "read") {
    if (identity.role === "viewer")
      return NextResponse.json(
        { error: "Write permission required" },
        { status: 403 },
      );
    let origin: URL;
    try {
      origin = new URL(request.headers.get("origin") ?? "");
    } catch {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }
    if (origin.host !== request.headers.get("host"))
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const key = `${identity.organizationId}:${identity.userId}`;
  try {
    if (action === "disconnect") await disconnectDevice(key);
    return NextResponse.json(await deviceConnection(key, action === "start"), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Codex could not start device login. Check that Codex CLI is installed and device-code login is enabled in ChatGPT security settings.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
export async function GET(request: Request) {
  return handle(request, "read");
}
export async function POST(request: Request) {
  return handle(request, "start");
}
export async function DELETE(request: Request) {
  return handle(request, "disconnect");
}
