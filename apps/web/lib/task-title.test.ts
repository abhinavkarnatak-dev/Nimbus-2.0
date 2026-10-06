import { describe, expect, it } from "vitest";

import { deriveTaskTitle } from "./task-title";

describe("deriveTaskTitle", () => {
  it("does not label a general conversation as repository work", () => {
    expect(deriveTaskTitle("Hi", "chat")).toBe("General conversation");
    expect(deriveTaskTitle("Please fix my wording", "chat")).toBe(
      "Fix request",
    );
    expect(deriveTaskTitle("Hi")).toBe("Repository overview");
  });
  it("turns the objective into concise session metadata", () => {
    expect(
      deriveTaskTitle(
        "Please fix task stream recovery after a browser refresh. Preserve event ordering.",
      ),
    ).toBe("Fix event streaming");
  });

  it("summarizes intent rather than truncating a long prompt", () => {
    const title = deriveTaskTitle(
      "- **Investigate** the intermittent deployment failures affecting the production executor workers and implement a durable recovery path",
    );

    expect(title).toBe("Fix deployment reliability");
    expect(title.length).toBeLessThanOrEqual(80);
  });
  it("names repository inquiries and file-focused requests", () => {
    expect(deriveTaskTitle("what is the code inside add.py")).toBe(
      "Inspect add.py",
    );
    expect(deriveTaskTitle("Hi bro what's this repo about?")).toBe(
      "Repository overview",
    );
    expect(deriveTaskTitle("what is the code inside HelloName.cpp")).toBe(
      "Inspect HelloName.cpp",
    );
    expect(deriveTaskTitle("Please update the greeting in hello.py")).toBe(
      "Update hello.py",
    );
  });
});
