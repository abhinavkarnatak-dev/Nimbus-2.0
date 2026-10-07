// Conservative authorization gate. The model resolves the repository, but it
// cannot turn a read-only question, quoted command, or negated request into work.
export function requestsRepositoryExecution(message: string): boolean {
  const text = message
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/^\s*>.*$/gm, "")
    .replace(/"[^"\n]*"|“[^”\n]*”/g, "");
  if (
    /^\s*(?:(?:bro|hey|hi)[,\s]+)?(?:how|why|what|where|when|which|does|is|are|explain|describe|summarize|inspect|review|tell me|show me)\b/i.test(
      text,
    )
  )
    return false;
  if (
    /\b(?:can|could|would)\s+(?:we|I)\b|\b(?:want|need)\s+to\s+(?:know|understand)\b/i.test(
      text,
    )
  )
    return false;
  if (
    /\b(?:excel|spreadsheet|pdf|word document|downloadable|csv)\b/i.test(
      text,
    ) &&
    !/\b(?:repo(?:sitory)?|commit|source|codebase)\b/i.test(text)
  )
    return false;
  if (
    /\b(?:don't|do not|never|without)\b.{0,60}\b(?:chang(?:e|ing)|edit|modify|run|execute|start|work|fix|implement|build|create)\b/i.test(
      text,
    )
  )
    return false;
  if (
    /\b(?:how (?:can|could|would|do|should)|explain how|tell me how|what (?:would|happens)|only (?:explain|read|inspect)|just (?:explain|read|inspect))\b/i.test(
      text,
    )
  )
    return false;
  return /\b(?:(?:start|begin|continue) (?:working|work|coding)|work on|make (?:the |some )?changes|(?:fix|implement|refactor|modify|edit|update|change|build|create|add|remove|delete)\b|(?:run|execute)\s+(?:the\s+)?(?:tests?|test suite|build|command|script|lint|app))\b/i.test(
    text,
  );
}
