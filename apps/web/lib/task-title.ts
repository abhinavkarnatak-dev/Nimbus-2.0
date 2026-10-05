const PREFIXES =
  /^(?:please\s+|could you\s+|can you\s+|i need you to\s+|i want you to\s+|help me\s+|we need to\s+)/i;

export function deriveTaskTitle(objective: string, maxLength = 80): string {
  const normalized = objective
    .replace(/[`*_#>]/g, "")
    .replace(/^[-+\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(PREFIXES, "");
  const firstThought = normalized.split(/(?:[.!?]\s|\n)/, 1)[0]?.trim() ?? "";
  const withoutPunctuation = firstThought.replace(/[.,;:!?-]+$/g, "").trim();
  const candidate = withoutPunctuation || "New coding task";

  if (candidate.length <= maxLength) return capitalize(candidate);

  const boundary = candidate.lastIndexOf(" ", maxLength - 1);
  const shortened = candidate.slice(0, boundary > 24 ? boundary : maxLength);
  return capitalize(shortened.trimEnd());
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
