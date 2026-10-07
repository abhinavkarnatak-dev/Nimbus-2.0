import { internalServiceUrl, localBridgeKey } from "@nimbus/codex";
import type { PublicRepository } from "./e2b-workspace-provider.js";

export async function authorizeRepository(
  repositoryRoot: string,
  taskId: string,
  repository: PublicRepository,
  transport: typeof fetch = fetch,
) {
  if (!/^task_[a-f0-9]{32}$/.test(taskId))
    throw new Error("Invalid task identity");
  const response = await transport(
    `${internalServiceUrl("NIMBUS_WEB_INTERNAL_URL", "http://127.0.0.1:3000")}/api/internal/repositories/${taskId}`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
      headers: {
        "x-nimbus-executor-key": await localBridgeKey(repositoryRoot),
      },
    },
  );
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : `Repository validation failed (HTTP ${response.status})`,
    );
  if (
    data.public !== true ||
    data.owner !== repository.owner ||
    data.name !== repository.name ||
    data.baseRef !== repository.baseRef
  )
    throw new Error("Verified repository does not match this task");
}
