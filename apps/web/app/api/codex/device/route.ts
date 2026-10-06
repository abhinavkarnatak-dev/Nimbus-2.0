import { NextResponse } from "next/server";
import { currentIdentity } from "@/lib/auth";
import { deviceMutationAllowed } from "@nimbus/codex";
import {
  deviceConnection,
  DeviceConnectionError,
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
      {
        error:
          "Codex device login is not enabled for this server origin. Check NIMBUS_DEVICE_AUTH_ENABLED and AUTH_URL.",
      },
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
    if (!deviceMutationAllowed(request))
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const key = `${identity.organizationId}:${identity.userId}`;
  try {
    if (action === "disconnect") await disconnectDevice(key);
    return NextResponse.json(await deviceConnection(key, action === "start"), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof DeviceConnectionError
            ? error.message
            : "Codex device login failed. Check the server configuration and enable device-code login in ChatGPT security settings, then try again.",
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
