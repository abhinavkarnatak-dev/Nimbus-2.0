import { afterEach, describe, expect, it, vi } from "vitest";
import { startEmailNotificationPoller } from "./email-notification-poller.js";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("independent email poller", () => {
  it("survives failures, never overlaps requests, and stops cleanly", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NIMBUS_WEB_INTERNAL_URL", "http://127.0.0.1:3000");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let reject!: (error: Error) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue(Response.json({ enabled: false }));
    const stop = startEmailNotificationPoller("a".repeat(64), fetcher);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    reject(new Error("email unavailable"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]![1].headers["x-nimbus-executor-key"]).toBe(
      "a".repeat(64),
    );
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
