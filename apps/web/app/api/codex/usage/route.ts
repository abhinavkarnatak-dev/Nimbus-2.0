import { NextResponse } from "next/server";
import { currentIdentity } from "@/lib/auth";
import { deviceUsageProvider, isLocalDeviceRequest } from "@/lib/codex-device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers },
    );
  if (!isLocalDeviceRequest(request))
    return NextResponse.json(
      {
        status: "unavailable",
        error: "Codex account limits are not enabled for this server origin.",
      },
      { headers },
    );
  let provider;
  try {
    provider = await deviceUsageProvider(
      `${identity.organizationId}:${identity.userId}`,
    );
  } catch {
    return NextResponse.json({ status: "disconnected" }, { headers });
  }
  try {
    if (typeof provider.readRateLimits !== "function") {
      return NextResponse.json(
        {
          status: "unavailable",
          error:
            "This Codex connection was started before the limits update. Reconnect Codex once in Settings > Connections to enable account limits.",
        },
        { headers },
      );
    }
    const limits = await provider.readRateLimits();
    return NextResponse.json(
      { status: "available", limits, updatedAt: new Date().toISOString() },
      { headers },
    );
  } catch {
    return NextResponse.json(
      {
        status: "unavailable",
        error:
          "Codex could not return account limits. Refresh or reconnect Codex.",
      },
      { headers },
    );
  }
}
