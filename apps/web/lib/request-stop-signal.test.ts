import { afterEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ stopped: false }));
vi.mock("@nimbus/database", () => ({
  requestWasStopped: vi.fn(async () => fixture.stopped),
}));
import { requestStopSignal } from "./request-stop-signal";
afterEach(() => {
  vi.useRealTimers();
  fixture.stopped = false;
});
it("interrupts only the selected request and cleans up polling", async () => {
  vi.useFakeTimers();
  const upstream = new AbortController();
  const stop = requestStopSignal("message", upstream.signal);
  await vi.advanceTimersByTimeAsync(250);
  expect(stop.signal.aborted).toBe(false);
  fixture.stopped = true;
  await vi.advanceTimersByTimeAsync(250);
  expect(stop.signal.aborted).toBe(true);
  stop.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
it("propagates an upstream abort and handles already aborted requests", () => {
  const upstream = new AbortController();
  upstream.abort();
  const stop = requestStopSignal("message", upstream.signal);
  expect(stop.signal.aborted).toBe(true);
  stop.dispose();
});
