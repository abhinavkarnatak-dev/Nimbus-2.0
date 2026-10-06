import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const { where } = vi.hoisted(() => ({ where: vi.fn() }));
vi.mock("./index.js", () => ({
  db: () => ({ select: () => ({ from: () => ({ where }) }) }),
}));
import { readAgentInstructions } from "./agent-instructions.js";

beforeEach(() => {
  where.mockReset();
});
it("loads only the submitting user's preferences in the task organization", async () => {
  where.mockResolvedValue([{ content: "Use hyphens only." }]);
  expect(await readAgentInstructions("org-a", "user-a")).toBe(
    "Use hyphens only.",
  );
  const query = new PgDialect().sqlToQuery(where.mock.calls[0]![0]);
  expect(query.params).toEqual(["org-a", "user-a"]);
  expect(query.sql).toContain('"organization_id"');
  expect(query.sql).toContain('"user_id"');
  expect(query.sql).toContain(" and ");
});
it("absent preferences leave an empty current snapshot", async () => {
  where.mockResolvedValue([]);
  expect(await readAgentInstructions("org-b", "user-b")).toBe("");
});
