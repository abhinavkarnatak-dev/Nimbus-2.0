export function sessionPresentation(
  status: string,
  archivedAt?: string | null,
) {
  if (archivedAt) return { state: "queued", label: "Archived" };
  if (status === "completed" || status === "pr_open")
    return { state: "idle", label: "Idle" };
  const label = status.replaceAll("_", " ");
  return {
    state: status,
    label: label.charAt(0).toUpperCase() + label.slice(1),
  };
}
