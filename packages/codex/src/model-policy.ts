import type { CodingAgentModel } from "./provider.js";
import { codexLimitReached, type CodexRateLimit } from "./rate-limits.js";

export function preferredCodexModel<T extends CodingAgentModel>(
  models: readonly T[],
): T | undefined {
  return (
    models.find((model) => model.id === "gpt-5.6-sol") ??
    models.find((model) => model.isDefault) ??
    models[0]
  );
}
export function preferredCodexEffort(
  model: CodingAgentModel | undefined,
): string {
  const efforts = model?.supportedReasoningEfforts ?? [];
  return (
    efforts.find((effort) => effort.reasoningEffort === "medium")
      ?.reasoningEffort ??
    efforts.find(
      (effort) => effort.reasoningEffort === model?.defaultReasoningEffort,
    )?.reasoningEffort ??
    efforts[0]?.reasoningEffort ??
    ""
  );
}
export function reserveCodexModel<T extends CodingAgentModel>(
  models: readonly T[],
  selected: T,
  limits: readonly CodexRateLimit[],
): T {
  const main = limits.find((limit) => limit.id === "codex");
  const reserve = limits.find(
    (limit) =>
      limit.id === "base_model_inference" && limit.name === "gpt-reserve",
  );
  if (
    !main ||
    !codexLimitReached(main) ||
    !reserve ||
    codexLimitReached(reserve) ||
    !reserve.primary ||
    selected.id.endsWith("-luna")
  )
    return selected;
  return (
    models.find((model) => model.id === "gpt-6-luna") ??
    models.find((model) => model.id === "gpt-5.6-luna") ??
    selected
  );
}
