import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeRepository } from "./repository-authorization.js";

const taskId = `task_${"a".repeat(32)}`;
const repository = { owner: "owner", name: "repo", baseRef: "main" };
afterEach(() => vi.unstubAllEnvs());
describe("trusted repository authorization bridge", () => {
  it("passes only the executor secret and rejects mismatched metadata", async () => {
    vi.stubEnv("NIMBUS_EXECUTOR_SECRET", "b".repeat(64));
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ...repository, public: true }))
      .mockResolvedValueOnce(
        Response.json({ ...repository, owner: "other", public: true }),
      );
    await authorizeRepository("unused", taskId, repository, transport);
    expect(transport.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { "x-nimbus-executor-key": "b".repeat(64) },
    });
    await expect(
      authorizeRepository("unused", taskId, repository, transport),
    ).rejects.toThrow("does not match");
  });
  it("preserves safe actionable server errors and never accepts failed checks", async () => {
    vi.stubEnv("NIMBUS_EXECUTOR_SECRET", "b".repeat(64));
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: "GitHub rate limit reached (HTTP 403)" },
          { status: 503 },
        ),
      );
    await expect(
      authorizeRepository("unused", taskId, repository, transport),
    ).rejects.toThrow("rate limit");
    await expect(
      authorizeRepository("unused", "invalid", repository, transport),
    ).rejects.toThrow("identity");
    expect(transport).toHaveBeenCalledOnce();
  });
});
