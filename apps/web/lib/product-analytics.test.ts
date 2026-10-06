import { describe, expect, it } from "vitest";

import { safeAnalyticsPage } from "./product-analytics";

describe("safeAnalyticsPage", () => {
  it("maps known pages to bounded analytics labels", () => {
    expect(safeAnalyticsPage("/skills")).toBe("skills");
    expect(safeAnalyticsPage("/settings")).toBe("connections");
    expect(safeAnalyticsPage("/tasks/new")).toBe("new_task");
  });

  it("never emits task IDs or unknown paths", () => {
    expect(safeAnalyticsPage("/tasks/task_sensitive_identifier")).toBe(
      "task_conversation",
    );
    expect(safeAnalyticsPage("/private/value")).toBe("other");
  });
});
