import { beforeEach, describe, expect, it, vi } from "vitest";
import { manualTaskTitleSchema } from "./manual-task-title";
const state = vi.hoisted(() => ({
  identity: { organizationId: "org", role: "owner" } as {
    organizationId: string;
    role: string;
  } | null,
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ currentIdentity: async () => state.identity }));
vi.mock("@nimbus/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nimbus/database")>()),
  db: () => ({ update: () => ({ set: state.set }) }),
}));
import { PATCH } from "../app/api/tasks/[taskId]/title/route";
const context = { params: Promise.resolve({ taskId: "task_test" }) };
function request(
  title: unknown = "My custom title",
  origin = "http://localhost:3000",
) {
  return new Request("http://localhost:3000/api/tasks/task_test/title", {
    method: "PATCH",
    headers: {
      host: "localhost:3000",
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify({ title }),
  });
}
beforeEach(() => {
  state.identity = { organizationId: "org", role: "owner" };
  state.set.mockReset().mockReturnValue({ where: state.where });
  state.where.mockReset().mockReturnValue({ returning: state.returning });
  state.returning
    .mockReset()
    .mockResolvedValue([{ id: "task_test", title: "My custom title" }]);
});
describe("manual titles", () => {
  it("trims titles and rejects empty, multiline, oversized and non-string input", () => {
    expect(manualTaskTitleSchema.parse({ title: "  My title  " }).title).toBe(
      "My title",
    );
    for (const title of [
      " ",
      "a".repeat(121),
      "two\nlines",
      "null\u0000byte",
      42,
    ])
      expect(manualTaskTitleSchema.safeParse({ title }).success).toBe(false);
  });
  it("requires authentication", async () => {
    state.identity = null;
    expect((await PATCH(request(), context)).status).toBe(401);
    expect(state.set).not.toHaveBeenCalled();
  });
  it("rejects viewers and cross-site writes", async () => {
    state.identity!.role = "viewer";
    expect((await PATCH(request(), context)).status).toBe(403);
    state.identity!.role = "owner";
    expect(
      (await PATCH(request("title", "https://attacker.invalid"), context))
        .status,
    ).toBe(403);
    expect(state.set).not.toHaveBeenCalled();
  });
  it("rejects invalid titles before touching storage", async () => {
    expect((await PATCH(request(""), context)).status).toBe(400);
    expect(state.set).not.toHaveBeenCalled();
  });
  it("saves normalized title and locks out automatic generation with tenant-scoped update", async () => {
    const response = await PATCH(request("  My custom title  "), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "task_test",
      title: "My custom title",
    });
    expect(state.set).toHaveBeenCalledWith({
      title: "My custom title",
      titleGeneratedAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    // Drizzle predicate includes both the requested task and authenticated tenant.
    const predicate = state.where.mock.calls[0]![0];
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const query = new PgDialect().sqlToQuery(predicate);
    expect(query.params).toEqual(["task_test", "org"]);
  });
  it("returns not found for missing or other-tenant sessions", async () => {
    state.returning.mockResolvedValue([]);
    expect((await PATCH(request(), context)).status).toBe(404);
  });
});
