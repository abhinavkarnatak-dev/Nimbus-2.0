export function deriveTaskTitle(
  objective: string,
  mode: "repository" | "chat" = "repository",
): string {
  const file = objective.match(
    /\b[\w.-]+\.(?:tsx?|jsx?|py|cpp|java|go|rs|md|json|css|html|sql)\b/i,
  )?.[0];
  const intent = file ? objective.replace(file, "") : objective;
  const action = /\b(fix|bug|broken|error|failure|failures|recovery)\b/i.test(
    intent,
  )
    ? "Fix"
    : /\b(add|create|build|implement)\b/i.test(intent)
      ? "Implement"
      : /\b(change|update|modify|refactor|rename|remove|delete)\b/i.test(intent)
        ? "Update"
        : "Explore";
  if (file) return `${action === "Explore" ? "Inspect" : action} ${file}`;
  const topics: Array<[RegExp, string]> = [
    [/\b(stream|events?|reconnect)\b/i, "event streaming"],
    [/\b(auth|login|sign.?in|oauth)\b/i, "authentication"],
    [/\b(deploy|deployment|workers?|executor)\b/i, "deployment reliability"],
    [/\b(tests?|testing)\b/i, "tests"],
    [/\b(ui|layout|styles?|design|spacing)\b/i, "interface"],
    [/\b(database|schema|migration)\b/i, "database"],
  ];
  const topic = topics.find(([pattern]) => pattern.test(objective))?.[1];
  return topic
    ? `${action} ${topic}`
    : action === "Explore"
      ? mode === "chat"
        ? "General conversation"
        : "Repository overview"
      : mode === "chat"
        ? `${action} request`
        : `${action} repository code`;
}
