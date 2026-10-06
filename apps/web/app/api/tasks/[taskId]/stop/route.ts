import { NextResponse } from "next/server";
import { stopRequest } from "@nimbus/database";
import { currentIdentity } from "@/lib/auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (identity.role === "viewer")
    return NextResponse.json(
      { error: "Task write permission required" },
      { status: 403 },
    );
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    if (
      origin.host !== request.headers.get("host") ||
      !["http:", "https:"].includes(origin.protocol)
    )
      throw new Error("origin");
  } catch {
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  }
  const input = (await request.json().catch(() => null)) as {
    messageId?: unknown;
  } | null;
  if (typeof input?.messageId !== "string" || input.messageId.length > 100)
    return NextResponse.json({ error: "Request ID required" }, { status: 400 });
  const { taskId } = await context.params;
  const result = await stopRequest(
    taskId,
    identity.organizationId,
    input.messageId,
  );
  return NextResponse.json(result, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
