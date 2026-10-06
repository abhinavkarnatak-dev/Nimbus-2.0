import { NextResponse } from "next/server";
import { z } from "zod";
import { currentIdentity } from "@/lib/auth";
import { manageTaskPullRequest } from "@/lib/pr-actions";
const schema = z.object({
  action: z.enum(["close", "merge"]),
  expectedHeadSha: z.string().regex(/^[a-f0-9]{40}$/),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
  confirmed: z.literal(true),
  number: z.number().int().positive().optional(),
});
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const identity = await currentIdentity();
  if (!identity)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (identity.role === "viewer")
    return NextResponse.json(
      { error: "PR write permission required" },
      { status: 403 },
    );
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
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Confirm a valid PR action" },
      { status: 400 },
    );
  const { taskId } = await context.params;
  try {
    return NextResponse.json(
      await manageTaskPullRequest(identity.organizationId, taskId, parsed.data),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "GitHub action failed",
      },
      { status: 409 },
    );
  }
}
