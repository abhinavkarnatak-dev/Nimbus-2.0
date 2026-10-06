import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdlePauseScheduler, SANDBOX_IDLE_PAUSE_MS } from "./idle-pause.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("two-minute sandbox idle grace", () => {
  it("keeps the sandbox warm until the full deadline", async () => {
    const scheduler = new IdlePauseScheduler();
    const pause = vi.fn(async () => {});
    scheduler.schedule("chat", pause);
    await vi.advanceTimersByTimeAsync(SANDBOX_IDLE_PAUSE_MS - 1);
    expect(pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(pause).toHaveBeenCalledTimes(1);
  });
  it("cancels a quick follow-up and restarts the clock after its response", async () => {
    const scheduler = new IdlePauseScheduler();
    const pause = vi.fn(async () => {});
    scheduler.schedule("chat", pause);
    await vi.advanceTimersByTimeAsync(60_000);
    scheduler.cancel("chat");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(pause).not.toHaveBeenCalled();
    scheduler.schedule("chat", pause);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(pause).toHaveBeenCalledTimes(1);
  });
  it("invalidates a deadline already waiting on an async session lock", async () => {
    const scheduler = new IdlePauseScheduler();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pause = vi.fn();
    scheduler.schedule("chat", async (isCurrent) => {
      await lock;
      if (isCurrent()) pause();
    });
    await vi.advanceTimersByTimeAsync(120_000);
    scheduler.cancel("chat");
    scheduler.schedule("chat", async () => {
      pause();
    });
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(pause).toHaveBeenCalledTimes(1);
  });
  it("keeps independent deadlines and cancels them during shutdown", async () => {
    const scheduler = new IdlePauseScheduler();
    const pause = vi.fn(async () => {});
    scheduler.schedule("a", pause);
    scheduler.schedule("b", pause);
    scheduler.cancel("a");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(pause).toHaveBeenCalledTimes(1);
    scheduler.schedule("a", pause);
    scheduler.clear();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(pause).toHaveBeenCalledTimes(1);
  });
  it("handles pause failures without an unhandled timer rejection", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scheduler = new IdlePauseScheduler();
    scheduler.schedule("chat", async () => {
      throw new Error("provider unavailable");
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(warning).toHaveBeenCalledOnce();
  });
});
