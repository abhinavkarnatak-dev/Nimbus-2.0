import { localBridgeKey } from "@nimbus/codex";
import { nimbusRepositoryRoot } from "./repository-root";

export async function remoteWorkspace(
  taskId: string,
  operation: "ensure" | "sync" | "published" | "idle",
) {
  if (!/^task_[a-f0-9]{32}$/.test(taskId))
    throw new Error("Invalid workspace session");
  const response = await fetch(
    `http://127.0.0.1:3020/internal/workspace/${taskId}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nimbus-executor-key": await localBridgeKey(nimbusRepositoryRoot()),
      },
      body: JSON.stringify({ operation }),
      cache: "no-store",
      signal: AbortSignal.timeout(300_000),
    },
  );
  const result = (await response.json()) as {
    environmentId: string;
    execServerUrl: string;
    authBearerToken: string;
    restored: boolean;
    error?: string;
  };
  if (!response.ok)
    throw new Error(
      result.error ??
        "Remote workspace unavailable; no local execution fallback",
    );
  return result;
}
