import { agentInstructions, db, readAgentInstructions } from "@nimbus/database";
import { agentInstructionsSchema } from "@nimbus/shared";
import { currentIdentity } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.json(
    {
      content: await readAgentInstructions(
        identity.organizationId,
        identity.userId,
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  let origin: URL;
  try {
    origin = new URL(request.headers.get("origin") ?? "");
  } catch {
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  }
  if (
    origin.host !== request.headers.get("host") ||
    !["http:", "https:"].includes(origin.protocol)
  )
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json(
      { error: "Send instructions as JSON" },
      { status: 415 },
    );
  const reader = request.body?.getReader();
  if (!reader)
    return NextResponse.json(
      { error: "Missing instructions" },
      { status: 400 },
    );
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 130_000) {
        await reader.cancel();
        return NextResponse.json(
          { error: "Instructions are too large" },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return NextResponse.json(
      { error: "Invalid instructions" },
      { status: 400 },
    );
  }
  const parsed = agentInstructionsSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Use plain text up to 20,000 characters" },
      { status: 400 },
    );
  const updatedAt = new Date().toISOString();
  await db()
    .insert(agentInstructions)
    .values({
      organizationId: identity.organizationId,
      userId: identity.userId,
      content: parsed.data.content,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [agentInstructions.organizationId, agentInstructions.userId],
      set: { content: parsed.data.content, updatedAt },
    });
  return NextResponse.json({ content: parsed.data.content, updatedAt });
}
