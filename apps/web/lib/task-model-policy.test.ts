import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  currentIdentity: async () => ({ userId: "user-a", organizationId: "org-a" }),
}));
vi.mock("./codex-models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./codex-models")>();
  return {
    ...actual,
    getSelectableCodexModels: async () => [
      {
        id: "real-account-model",
        label: "Account model",
        isDefault: true,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [
          { reasoningEffort: "high", description: "Thorough" },
        ],
      },
    ],
  };
});
import { POST } from "../app/api/tasks/route";

function request(model: string, effort?: string) {
  const body = new FormData();
  body.set("repositoryId", "repo_000000000000001");
  body.set("objective", "Implement an accessible search form");
  body.set("model", model);
  body.set("idempotencyKey", "test-model-selection-00001");
  if (effort) body.set("reasoningEffort", effort);
  return new Request("http://localhost:3000/api/tasks", {
    method: "POST",
    body,
  });
}
afterEach(() => vi.unstubAllEnvs());
describe("task model selection policy", () => {
  it("rejects a model not returned by the account", async () => {
    expect((await POST(request("invented-model"))).status).toBe(400);
  });
  it("rejects thinking effort not supported by the chosen model", async () => {
    const response = await POST(request("real-account-model", "low"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Thinking effort is not supported by the selected model",
    });
  });
  it("does not silently execute a real-model task through a fake provider", async () => {
    vi.stubEnv("NIMBUS_CODING_PROVIDER", "fake");
    const response = await POST(request("real-account-model", "high"));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toContain(
      "will not simulate this model",
    );
  });
});
