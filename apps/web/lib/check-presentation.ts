export function checkPresentation(status: string, exitCode: number | null) {
  const terminal = ["completed", "succeeded", "failed", "cancelled"].includes(
    status,
  );
  const passed =
    terminal && exitCode === 0 && ["completed", "succeeded"].includes(status);
  const failed =
    status === "failed" || (terminal && exitCode !== null && exitCode !== 0);
  return {
    state: passed
      ? "completed"
      : failed
        ? "failed"
        : status === "running"
          ? "running"
          : "queued",
    label: passed
      ? "Completed"
      : failed
        ? "Failed"
        : status === "cancelled"
          ? "Cancelled"
          : status === "running"
            ? "Running"
            : terminal
              ? "Completed"
              : "Pending",
    passed,
    failed,
  };
}
