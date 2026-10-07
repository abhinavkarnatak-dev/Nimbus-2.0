import { describe, expect, it } from "vitest";
import { sessionPresentation } from "./session-presentation";
describe("persistent session labels", () => {
  it("shows successful finished turns as idle without changing persisted results", () => {
    for (const status of ["completed", "pr_open"])
      expect(sessionPresentation(status)).toEqual({
        state: "idle",
        label: "Online",
      });
    expect(sessionPresentation("running")).toEqual({
      state: "running",
      label: "Running",
    });
    expect(sessionPresentation("queued").label).toBe("Queued");
  });
  it("shows sleeping only after the workspace actually pauses", () => {
    expect(sessionPresentation("completed", null, "ready").label).toBe(
      "Online",
    );
    expect(sessionPresentation("completed", null, "paused").label).toBe(
      "Sleeping",
    );
    expect(sessionPresentation("running", null, "paused").label).toBe(
      "Running",
    );
  });
  it("does not disguise failed, stopped or archived sessions as ready", () => {
    expect(sessionPresentation("failed").label).toBe("Failed");
    expect(sessionPresentation("cancelled").label).toBe("Cancelled");
    expect(sessionPresentation("completed", "2026-10-06").label).toBe(
      "Archived",
    );
  });
});
