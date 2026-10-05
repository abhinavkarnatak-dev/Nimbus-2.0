import { describe, expect, it } from "vitest";

import { deriveTaskTitle } from "./task-title";

describe("deriveTaskTitle", () => {
  it("turns the objective into concise session metadata", () => {
    expect(
      deriveTaskTitle(
        "Please fix task stream recovery after a browser refresh. Preserve event ordering.",
      ),
    ).toBe("Fix task stream recovery after a browser refresh");
  });

  it("normalizes prompt formatting and truncates at a word boundary", () => {
    const title = deriveTaskTitle(
      "- **Investigate** the intermittent deployment failures affecting the production executor workers and implement a durable recovery path",
    );

    expect(title).toBe(
      "Investigate the intermittent deployment failures affecting the production",
    );
    expect(title.length).toBeLessThanOrEqual(80);
  });
});
