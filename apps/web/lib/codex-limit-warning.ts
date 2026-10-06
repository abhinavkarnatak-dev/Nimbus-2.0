import {
  codexLimitReached,
  type CodexRateLimit,
} from "@nimbus/codex/rate-limits";

export function codexLimitWarning(limits: readonly CodexRateLimit[]) {
  if (limits.some(codexLimitReached))
    return { severity: "exhausted", label: "Codex limit reached" } as const;
  const highest = Math.max(
    0,
    ...limits.flatMap((limit) => [
      limit.primary?.usedPercent ?? 0,
      limit.secondary?.usedPercent ?? 0,
    ]),
  );
  return highest >= 90
    ? ({
        severity: "near",
        label: "Codex limit nearly reached",
      } as const)
    : null;
}
