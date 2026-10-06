import { NextResponse } from "next/server";
import { currentIdentity } from "@/lib/auth";
import { getSelectableCodexModels } from "@/lib/codex-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(
      {
        models: await getSelectableCodexModels(
          identity.userId,
          identity.organizationId,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not refresh Codex models. Try again." },
      { status: 503 },
    );
  }
}
