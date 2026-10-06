export function sessionPrBranch(taskId: string, generation: number) {
  if (
    !/^task_[a-zA-Z0-9_-]+$/.test(taskId) ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  )
    throw new Error("Invalid session PR generation");
  return generation === 1
    ? `nimbus/${taskId}`
    : `nimbus/${taskId}-pr-${generation}`;
}
