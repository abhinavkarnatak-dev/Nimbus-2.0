export const SANDBOX_IDLE_PAUSE_MS = 2 * 60_000;

/** One cancellable idle deadline per chat, never a blocking wait in the worker. */
export class IdlePauseScheduler {
  readonly #pending = new Map<string, ReturnType<typeof setTimeout>>();
  schedule(taskId: string, pause: (isCurrent: () => boolean) => Promise<void>) {
    this.cancel(taskId);
    const timer = setTimeout(() => {
      if (this.#pending.get(taskId) !== timer) return;
      void pause(() => this.#pending.get(taskId) === timer)
        .catch(() =>
          console.warn(
            "Idle sandbox pause failed; retaining the provider timeout as a fallback",
          ),
        )
        .finally(() => {
          if (this.#pending.get(taskId) === timer) this.#pending.delete(taskId);
        });
    }, SANDBOX_IDLE_PAUSE_MS);
    timer.unref();
    this.#pending.set(taskId, timer);
  }
  cancel(taskId: string) {
    const timer = this.#pending.get(taskId);
    if (timer) clearTimeout(timer);
    this.#pending.delete(taskId);
  }
  clear() {
    for (const taskId of this.#pending.keys()) this.cancel(taskId);
  }
}
