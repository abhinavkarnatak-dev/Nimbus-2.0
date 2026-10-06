import { describe, expect, it } from "vitest";

import { allowedTaskTargets, assertTaskTransition } from "./task-state.js";

const base = {
  actor: "executor" as const,
  reason: "Workspace accepted by executor",
  at: "2026-10-05T12:00:00.000Z",
  idempotencyKey: "idem_01KTEST0000000000000000",
  correlationId: "corr_01KTEST0000000000000000",
};

describe("task state machine", () => {
  it("keeps completed sessions resumable and drains queued follow-ups", () => {
    expect(
      assertTaskTransition({
        ...base,
        from: "completed",
        to: "queued",
        actor: "user",
      }).to,
    ).toBe("queued");
    expect(
      assertTaskTransition({ ...base, from: "running", to: "queued" }).to,
    ).toBe("queued");
    expect(allowedTaskTargets("pr_open")).toContain("queued");
  });
  it("allows the normal adaptive execution path", () => {
    expect(
      assertTaskTransition({ ...base, from: "queued", to: "provisioning" }).to,
    ).toBe("provisioning");
    expect(allowedTaskTargets("running")).toContain("awaiting_user");
    expect(allowedTaskTargets("running")).toContain("preparing_pr");
  });

  it("rejects arbitrary client-style status assignment", () => {
    expect(() =>
      assertTaskTransition({ ...base, from: "queued", to: "completed" }),
    ).toThrow("Invalid task transition");
  });

  it("supports safe retry from a terminal failure", () => {
    expect(
      assertTaskTransition({ ...base, from: "failed", to: "queued" }).to,
    ).toBe("queued");
  });
});
