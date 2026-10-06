export interface CodexRateWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}
export interface CodexRateLimit {
  id: string;
  name: string;
  planType: string | null;
  primary: CodexRateWindow | null;
  secondary: CodexRateWindow | null;
  reachedType: string | null;
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string | null;
  } | null;
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function window(value: unknown): CodexRateWindow | null {
  const data = record(value);
  if (
    typeof data.usedPercent !== "number" ||
    !Number.isFinite(data.usedPercent) ||
    data.usedPercent < 0
  )
    return null;
  return {
    usedPercent: data.usedPercent,
    windowDurationMins:
      typeof data.windowDurationMins === "number" && data.windowDurationMins > 0
        ? data.windowDurationMins
        : null,
    resetsAt:
      typeof data.resetsAt === "number" && data.resetsAt > 0
        ? data.resetsAt
        : null,
  };
}
export function parseCodexRateLimits(value: unknown): CodexRateLimit[] {
  const data = record(value);
  const buckets = Object.entries(record(data.rateLimitsByLimitId));
  if (!buckets.length && data.rateLimits)
    buckets.push(["codex", data.rateLimits]);
  return orderCodexRateLimits(
    buckets.map(([id, value]) => {
      const data = record(value);
      const credits = record(data.credits);
      return {
        id: typeof data.limitId === "string" ? data.limitId : id,
        name:
          typeof data.limitName === "string" && data.limitName
            ? data.limitName
            : id,
        planType: typeof data.planType === "string" ? data.planType : null,
        primary: window(data.primary),
        secondary: window(data.secondary),
        reachedType:
          typeof data.rateLimitReachedType === "string"
            ? data.rateLimitReachedType
            : null,
        credits:
          typeof credits.hasCredits === "boolean" &&
          typeof credits.unlimited === "boolean"
            ? {
                hasCredits: credits.hasCredits,
                unlimited: credits.unlimited,
                balance:
                  typeof credits.balance === "string" ? credits.balance : null,
              }
            : null,
      };
    }),
  );
}
export function orderCodexRateLimits(
  limits: readonly CodexRateLimit[],
): CodexRateLimit[] {
  return [...limits].sort((a, b) =>
    a.id === b.id
      ? 0
      : a.id === "codex"
        ? -1
        : b.id === "codex"
          ? 1
          : a.id < b.id
            ? -1
            : 1,
  );
}
export function codexLimitReached(limit: CodexRateLimit) {
  return (
    !!limit.reachedType ||
    (limit.primary?.usedPercent ?? 0) >= 100 ||
    (limit.secondary?.usedPercent ?? 0) >= 100
  );
}
