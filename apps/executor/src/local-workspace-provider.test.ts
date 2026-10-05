import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LocalWorkspaceProvider } from "./local-workspace-provider.js";

describe("LocalWorkspaceProvider", () => {
  it("rejects paths that escape the task workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "nimbus-workspace-test-"));
    const provider = new LocalWorkspaceProvider(root);
    const workspace = await provider.provision("task-safe");
    await expect(
      provider.readFile(workspace, "../../secret.txt"),
    ).rejects.toThrow("escaped");
  });
});
