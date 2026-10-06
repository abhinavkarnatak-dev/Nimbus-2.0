import { resolve } from "node:path";
import { localBridgeKey, validBridgeKey } from "@nimbus/codex";
import { processPrEmails } from "@/lib/pr-email-outbox";

export async function POST(request: Request) {
  const key = await localBridgeKey(resolve(process.cwd(), "../.."));
  if (!validBridgeKey(request.headers.get("x-nimbus-executor-key") ?? "", key))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await processPrEmails(), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    // This endpoint never alters task state. Missing migrations/configuration are
    // an email-only outage, not a task execution or PR publishing failure.
    return Response.json(
      { error: "Email notifications unavailable" },
      { status: 503 },
    );
  }
}
