import { afterEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  limit: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@nimbus/database", async (original) => ({
  ...(await original<typeof import("@nimbus/database")>()),
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: fixture.limit }) }),
      }),
    }),
  }),
}));
vi.mock("./provider-factory.js", () => ({
  createProviderConfiguration: () => ({
    provider: { kind: "fake", start: fixture.start, stop: fixture.stop },
  }),
}));
vi.mock("@nimbus/observability", () => ({
  createObservability: () => ({ shutdown: async () => {} }),
}));
import { TaskWorker } from "./worker.js";
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
describe("single-task worker and startup recovery", () => {
  it("does not poll or claim another task while its current tick is still running", async () => {
    let release!: (tasks: []) => void;
    fixture.limit
      .mockReturnValueOnce(
        new Promise<[]>((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValue([]);
    const worker = new TaskWorker("unused");
    const first = worker.tick();
    await worker.tick();
    expect(fixture.limit).toHaveBeenCalledOnce();
    release([]);
    await first;
    await worker.tick();
    expect(fixture.limit).toHaveBeenCalledTimes(2);
  });
  it("survives an initial database failure and retries without restarting the service", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    fixture.limit
      .mockRejectedValueOnce(new Error("temporary database failure"))
      .mockResolvedValue([]);
    const worker = new TaskWorker("unused");
    try {
      await expect(worker.start()).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(2000);
      expect(fixture.limit).toHaveBeenCalledTimes(2);
      expect(warning).toHaveBeenCalledWith(
        "Executor initial polling failed; retrying on next tick",
      );
    } finally {
      await worker.stop();
      warning.mockRestore();
    }
  });
});
