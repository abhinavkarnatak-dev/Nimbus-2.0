import { describe, expect, it } from "vitest";
import { checkPresentation } from "./check-presentation";
describe("check status presentation", () => {
  it("shows successful completed and succeeded commands as green completion", () => {
    for (const status of ["completed", "succeeded"])
      expect(checkPresentation(status, 0)).toMatchObject({
        state: "completed",
        label: "Completed",
        passed: true,
        failed: false,
      });
  });
  it("keeps failures red and missing exit evidence or unfinished commands neutral", () => {
    for (const status of ["completed", "succeeded", "failed"])
      expect(checkPresentation(status, 1).state).toBe("failed");
    expect(checkPresentation("completed", null)).toMatchObject({
      state: "queued",
      passed: false,
    });
    expect(checkPresentation("running", null)).toMatchObject({
      state: "running",
      label: "Running",
      failed: false,
    });
    expect(checkPresentation("queued", null).state).toBe("queued");
    expect(checkPresentation("cancelled", null).failed).toBe(false);
  });
});
