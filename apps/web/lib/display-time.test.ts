import { describe, expect, it } from "vitest";
import {
  formatIstTime,
  formatIstDate,
  formatIstDateTime,
} from "./display-time";

describe("explicit IST presentation", () => {
  it("converts UTC instants to IST regardless of the host timezone", () => {
    expect(formatIstTime("2026-10-07T18:45:00Z")).toBe("12:15 am");
    expect(formatIstDate("2026-10-07T18:45:00Z")).toBe("08 Oct 2026");
    expect(formatIstDateTime("2026-10-07T18:45:00Z")).toContain("08 Oct 2026");
    expect(formatIstDateTime("2026-10-07T18:45:00Z")).toContain("12:15 am");
    expect(formatIstDateTime("2026-10-07T18:45:00Z")).not.toContain("IST");
  });
  it("supports precise activity times, offsets, Date objects, and epoch values", () => {
    expect(formatIstTime("2026-10-07T10:00:42Z", true)).toBe("03:30:42 pm");
    expect(formatIstTime("2026-10-07T15:30:42+05:30", true)).toBe(
      "03:30:42 pm",
    );
    const date = new Date("2026-10-07T10:00:42Z");
    expect(formatIstDateTime(date)).toBe(formatIstDateTime(date.getTime()));
  });
  it("does not crash the page on an invalid timestamp", () => {
    expect(formatIstTime("invalid")).toBe("-");
    expect(formatIstDate("invalid")).toBe("-");
    expect(formatIstDateTime("invalid")).toBe("-");
  });
});
