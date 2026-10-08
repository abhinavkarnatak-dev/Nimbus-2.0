import { describe, expect, it } from "vitest";
import { isWebActivity, webActivityEvent } from "./web-activity.js";
const payload = (action: unknown, extra = {}) => ({
  item: { type: "webSearch", id: "search-1", action, ...extra },
});
describe("confirmed web research activity", () => {
  it("reports LinkedIn search start and completion with stable identity and queries", () => {
    const input = payload({
      type: "search",
      queries: [
        "site:linkedin.com/jobs frontend internships",
        "site:linkedin.com/jobs recent postings",
      ],
    });
    const start = webActivityEvent("item/started", input)!;
    const end = webActivityEvent("item/completed", input)!;
    expect(start).toMatchObject({
      title: "Searching LinkedIn",
      status: "running",
    });
    expect(end).toMatchObject({
      title: "Searched LinkedIn",
      status: "succeeded",
    });
    expect(start.evidence).toEqual(end.evidence);
    expect(isWebActivity(end)).toBe(true);
    expect(end.whatWasDone).toContain("recent postings");
    expect(end.whatWasDone).not.toContain("jobs found");
  });
  it("supports legacy top-level queries and missing start details", () => {
    expect(webActivityEvent("item/started", payload(null))).toMatchObject({
      title: "Searching the web",
      status: "running",
    });
    expect(
      webActivityEvent(
        "item/completed",
        payload(null, { query: "LinkedIn recent jobs" }),
      )?.title,
    ).toBe("Searched LinkedIn");
  });
  it("labels explicit websites and page reads without confusing lookalike domains", () => {
    expect(
      webActivityEvent(
        "item/started",
        payload({ type: "search", query: "site:github.com release" }),
      )?.title,
    ).toBe("Searching github.com");
    expect(
      webActivityEvent(
        "item/started",
        payload({ type: "search", query: "site:linkedin.com.evil.test jobs" }),
      )?.title,
    ).toBe("Searching linkedin.com.evil.test");
    expect(
      webActivityEvent(
        "item/started",
        payload({
          type: "openPage",
          url: "https://www.linkedin.com/jobs/view/123",
        }),
      )?.title,
    ).toBe("Reading LinkedIn");
    expect(
      webActivityEvent(
        "item/completed",
        payload({
          type: "findInPage",
          url: "https://example.com/jobs",
          pattern: "intern",
        }),
      )?.whatWasDone,
    ).toContain("Find: intern");
  });
  it("does not claim failed searches succeeded and bounds untrusted payloads", () => {
    expect(
      webActivityEvent(
        "item/completed",
        payload(
          { type: "search", query: "site:linkedin.com jobs" },
          { status: "failed" },
        ),
      ),
    ).toMatchObject({
      title: "Web research failed on LinkedIn",
      status: "failed",
    });
    const result = webActivityEvent(
      "item/completed",
      payload({ type: "search", queries: Array(100).fill("x".repeat(5000)) }),
    )!;
    expect(result.whatWasDone.length).toBeLessThanOrEqual(2000);
    expect(
      webActivityEvent(
        "item/started",
        payload({ type: "openPage", url: "javascript:alert(1)" }),
      )?.whatWasDone,
    ).not.toContain("javascript:");
  });
  it("ignores unrelated commands, messages, malformed payloads and non-lifecycle notifications", () => {
    for (const input of [
      null,
      [],
      {},
      { item: { type: "commandExecution", command: "echo hello" } },
      { item: { type: "agentMessage" } },
    ])
      expect(webActivityEvent("item/started", input)).toBeNull();
    expect(
      webActivityEvent("item/agentMessage/delta", payload({ type: "search" })),
    ).toBeNull();
  });
});
