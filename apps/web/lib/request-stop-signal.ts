import { requestWasStopped } from "@nimbus/database";

// Interrupt the actual provider turn and wait for its terminal acknowledgement.
// Do not merely close the browser stream and leave execution running.
export function requestStopSignal(messageId: string, upstream: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  upstream.addEventListener("abort", abort, { once: true });
  if (upstream.aborted) abort();
  let checking = false;
  const check = async () => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try {
      if (await requestWasStopped(messageId)) abort();
    } catch {
      /* A transient DB read failure is not user cancellation. */
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => void check(), 250);
  timer.unref();
  void check();
  return {
    signal: controller.signal,
    dispose: () => {
      clearInterval(timer);
      upstream.removeEventListener("abort", abort);
    },
  };
}
