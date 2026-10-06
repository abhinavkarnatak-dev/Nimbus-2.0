import { describe, expect, it } from "vitest";
import { skillSchema, skillIdsSchema, withSelectedSkills } from "./skills.js";
describe("selected chat skills", () => {
  it("requires all fields, bounds content, and rejects binary text", () => {
    expect(
      skillSchema.safeParse({ name: "Skill", description: "", summary: "text" })
        .success,
    ).toBe(false);
    expect(
      skillSchema.safeParse({
        name: "Skill",
        description: "desc",
        summary: "bad\0file",
      }).success,
    ).toBe(false);
    expect(
      skillSchema.safeParse({
        name: "Skill",
        description: "desc",
        summary: "x".repeat(20001),
      }).success,
    ).toBe(false);
    expect(
      skillSchema.parse({
        name: " Skill ",
        description: " desc ",
        summary: " summary ",
      }).summary,
    ).toBe("summary");
  });
  it("limits and deduplicates selection", () => {
    expect(skillIdsSchema.safeParse(["a", "a"]).success).toBe(false);
    expect(skillIdsSchema.safeParse(["a", "b", "c", "d"]).success).toBe(false);
    expect(skillIdsSchema.parse([])).toEqual([]);
  });
  it("keeps current skills distinct from authority and revokes previous selection", () => {
    const result = withSelectedSkills("Read README", [
      {
        id: "a",
        name: "Clear writing",
        description: "Short answers",
        summary: "Use short sentences.",
      },
    ]);
    expect(result).toContain("Read README");
    expect(result).toContain('"summary":"Use short sentences."');
    expect(result).toContain("does not grant tools");
    expect(result).toContain("not enabled for this request");
    expect(withSelectedSkills("Continue", [])).toContain(
      "Previously selected skills do not apply",
    );
  });
});
