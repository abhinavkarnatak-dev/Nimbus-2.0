import { readFile } from "node:fs/promises";

export async function readContainerMemory() {
  for (const [usagePath, limitPath] of [
    ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.max"],
    [
      "/sys/fs/cgroup/memory/memory.usage_in_bytes",
      "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    ],
  ]) {
    try {
      const usage = Number(await readFile(usagePath, "utf8"));
      const limit = Number(await readFile(limitPath, "utf8"));
      if (Number.isFinite(usage))
        return {
          usedMiB: Math.round(usage / 1048576),
          limitMiB: Number.isFinite(limit) ? Math.round(limit / 1048576) : null,
        };
    } catch {
      /* Non-Linux development machines have no cgroup. */
    }
  }
  return null;
}
