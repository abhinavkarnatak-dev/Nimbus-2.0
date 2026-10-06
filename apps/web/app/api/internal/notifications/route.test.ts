import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock("@nimbus/codex", () => ({
  localBridgeKey: async () => "a".repeat(64),
  validBridgeKey: (supplied: string, expected: string) => supplied === expected,
}));
vi.mock("@/lib/pr-email-outbox", () => ({ processPrEmails: state.process }));
import { POST } from "./route";
beforeEach(() => {
  state.process.mockReset();
});
describe("email-only internal endpoint", () => {
  it("rejects requests without the executor secret before processing", async () => {
    expect(
      (
        await POST(
          new Request("http://localhost/api/internal/notifications", {
            method: "POST",
          }),
        )
      ).status,
    ).toBe(401);
    expect(state.process).not.toHaveBeenCalled();
  });
  it("returns worker results", async () => {
    state.process.mockResolvedValue({ enabled: true, sent: 1, failed: 0 });
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "x-nimbus-executor-key": "a".repeat(64) },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("contains email/database failures and redacts secrets", async () => {
    state.process.mockRejectedValue(new Error("secret credential"));
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "x-nimbus-executor-key": "a".repeat(64) },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret credential");
  });
});
