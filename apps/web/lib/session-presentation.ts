export function sessionPresentation(
  status: string,
  archivedAt?: string | null,
  workspaceStatus?: string | null,
) {
  if (archivedAt) return { state: "queued", label: "Archived" };
  if (["completed", "pr_open", "idle"].includes(status))
    return {
      state: "idle",
      label: workspaceStatus === "paused" ? "Sleeping" : "Online",
    };
  const label = status.replaceAll("_", " ");
  return {
    state: status,
    label: label.charAt(0).toUpperCase() + label.slice(1),
  };
}
