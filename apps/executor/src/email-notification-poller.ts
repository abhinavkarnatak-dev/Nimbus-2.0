import { internalServiceUrl } from "@nimbus/codex";

export function startEmailNotificationPoller(
  key: string,
  transport: typeof fetch = fetch,
) {
  let stopped = false;
  let busy = false;
  const controller = new AbortController();
  let lastWarning = 0;
  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const response = await transport(
        `${internalServiceUrl("NIMBUS_WEB_INTERNAL_URL", "http://127.0.0.1:3000")}/api/internal/notifications`,
        {
          method: "POST",
          redirect: "error",
          headers: { "x-nimbus-executor-key": key },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(45_000),
          ]),
        },
      );
      if (!response.ok) throw new Error("Email worker unavailable");
      await response.body?.cancel();
    } catch {
      if (!stopped && Date.now() - lastWarning > 5 * 60_000) {
        console.warn(
          "Email notification worker unavailable; task execution is unaffected.",
        );
        lastWarning = Date.now();
      }
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 15_000);
  timer.unref();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
    controller.abort();
  };
}
