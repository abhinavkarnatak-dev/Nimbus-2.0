import { describe, expect, it } from "vitest";
import { sessionPrBranch } from "./pr-branches";
describe("session PR branches", () => {
  it("keeps the original branch and scopes each later generation", () => {
    expect(sessionPrBranch("task_test", 1)).toBe("nimbus/task_test");
    expect(sessionPrBranch("task_test", 2)).toBe("nimbus/task_test-pr-2");
  });
  it("rejects traversal and invalid generations", () => {
    expect(() => sessionPrBranch("task_test/../../main", 2)).toThrow();
    expect(() => sessionPrBranch("task_test", 0)).toThrow();
  });
});
