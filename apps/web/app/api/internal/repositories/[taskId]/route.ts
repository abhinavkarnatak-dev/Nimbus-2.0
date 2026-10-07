import { localBridgeKey, validBridgeKey } from "@nimbus/codex";
import { GitHubApiError } from "@nimbus/github";
import { nimbusRepositoryRoot } from "@/lib/repository-root";
import { authorizeTaskRepository } from "@/lib/repository-authorization";

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  if (
    !validBridgeKey(
      request.headers.get("x-nimbus-executor-key") ?? "",
      await localBridgeKey(nimbusRepositoryRoot()),
    )
  )
    return Response.json({ error: "Unauthorized executor" }, { status: 401 });
  const { taskId } = await context.params;
  if (!/^task_[a-f0-9]{32}$/.test(taskId))
    return Response.json({ error: "Invalid task" }, { status: 400 });
  try {
    return Response.json(await authorizeTaskRepository(taskId), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof GitHubApiError
        ? error.message
        : error instanceof Error &&
            /^(Repository |GitHub installation |Repository validation |This repository |This GitHub repository )/.test(
              error.message,
            )
          ? error.message
          : "GitHub repository validation failed. Check server configuration and retry.";
    return Response.json({ error: message }, { status: 503 });
  }
}
