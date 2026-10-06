import { describe, expect, it } from "vitest";
import { integrationStatus } from "./integration-status";

describe("integration status presentation", () => {
  it("uses a capitalized Active label and connected treatment", () => {
    expect(integrationStatus("active")).toEqual({
      label: "Active",
      tone: "connected",
    });
  });
  it("makes missing and disconnected accounts visibly disconnected", () => {
    for (const status of [undefined, null, "disconnected"]) {
      expect(integrationStatus(status)).toEqual({
        label: "Not Connected",
        tone: "disconnected",
      });
    }
  });
  it("distinguishes waiting, revoked, failed, and unknown states", () => {
    expect(integrationStatus("suspended").tone).toBe("waiting");
    expect(integrationStatus("pending").label).toBe("Connecting");
    expect(integrationStatus("revoked").label).toBe("Access Revoked");
    expect(integrationStatus("failed").tone).toBe("disconnected");
    expect(integrationStatus("unexpected").tone).toBe("unknown");
  });
});
