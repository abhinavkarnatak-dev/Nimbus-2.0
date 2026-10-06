// Explicit opt-in, bounded live test. No GitHub write/PR/merge operations.
import assert from "node:assert/strict";
import { E2BWorkspaceProvider } from "./e2b-workspace-provider.js";
import type { WorkspaceHandle } from "./workspace-provider.js";

if (process.env.NIMBUS_E2B_LIVE_TEST !== "true")
  throw new Error(
    "Set NIMBUS_E2B_LIVE_TEST=true to authorize this bounded live test",
  );
const provider = new E2BWorkspaceProvider();
const taskId = `task_e2b_test_${Date.now()}`;
let workspace: WorkspaceHandle | undefined;
let stage = "provision";
try {
  workspace = await provider.provision(taskId, "nimbus_live_test", {
    owner: "abhinavkarnatak-dev",
    name: "Testing-Nimbus-PRs",
    baseRef: "main",
  });
  console.log(
    "PASS: public checkout and pinned Codex installation (no GitHub token)",
  );
  stage = "remote identity and credential separation";
  const identity = await provider.execute(workspace, {
    argv: [
      "python3",
      "-c",
      "import os,platform; assert platform.system()=='Linux'; assert os.getcwd()=='/workspace/repo'; assert not any(k in os.environ for k in ['E2B_API_KEY','OPENAI_API_KEY','ACCESS_TOKEN','DATABASE_URL','GITHUB_APP_PRIVATE_KEY_BASE64','CODEX_ACCESS_TOKEN']); print('Linux repository workspace; no backend credentials')",
    ],
    timeoutMs: 10_000,
  });
  assert.equal(identity.exitCode, 0);
  console.log(
    "PASS: commands run on Linux, with no injected backend credentials",
  );
  stage = "edit, execution, tests and file round-trip";
  await provider.writeFile(
    workspace,
    "nimbus-test/check.py",
    Buffer.from(
      "def add(a,b): return a+b\nassert add(2,3)==5\nprint('verified')\n",
    ),
  );
  const result = await provider.execute(workspace, {
    argv: ["python3", "nimbus-test/check.py"],
    timeoutMs: 10_000,
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /verified/);
  const binary = new Uint8Array([0, 1, 255, 123]);
  await provider.writeFile(workspace, "nimbus-test/output.bin", binary);
  assert.deepEqual(
    await provider.readFile(workspace, "nimbus-test/output.bin"),
    binary,
  );
  console.log(
    "PASS: editing, Python execution/assertions, binary download round-trip",
  );
  stage = "dependency installation";
  await provider.checked(
    workspace,
    [
      "python3",
      "-m",
      "pip",
      "install",
      "--target",
      "/tmp/nimbus-packages",
      "six==1.17.0",
    ],
    undefined,
    90_000,
  );
  console.log("PASS: public dependency installation");
  stage = "streaming and process stdin";
  let output = "";
  const command = await provider.startProcess(
    workspace,
    {
      argv: [
        "python3",
        "-u",
        "-c",
        "import sys; print('ready',flush=True); print(sys.stdin.readline().strip(),flush=True)",
      ],
    },
    (data) => {
      output += data;
    },
  );
  await command.write("remote-stdin\n");
  for (let n = 0; n < 100 && !output.includes("remote-stdin"); n++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(output, /ready/);
  assert.match(output, /remote-stdin/);
  console.log("PASS: live stdout and stdin streaming");
  stage = "nonzero results";
  const failed = await provider.execute(workspace, {
    argv: ["python3", "-c", "raise SystemExit(7)"],
    timeoutMs: 10_000,
  });
  assert.equal(failed.exitCode, 7);
  console.log("PASS: failed commands are recorded as failures, not success");
  stage = "pause/resume and ownership";
  await provider.pause(workspace);
  await assert.rejects(
    provider.resume(workspace.id, "task_foreign", "nimbus_live_test"),
    /does not belong/,
  );
  workspace = await provider.resume(workspace.id, taskId, "nimbus_live_test");
  assert.deepEqual(
    await provider.readFile(workspace, "nimbus-test/output.bin"),
    binary,
  );
  console.log(
    "PASS: follow-up state survives pause/resume; foreign ownership rejected",
  );
} catch (error) {
  console.error(
    `FAIL: ${stage}. Credentials and raw provider errors are intentionally not printed.`,
  );
  if (
    error instanceof Error &&
    error.message.startsWith("Remote sandbox initialization failed")
  )
    console.error(error.message);
  process.exitCode = 1;
} finally {
  if (workspace) {
    await provider.destroy(workspace);
    console.log("Test sandbox destroyed; no repository changes published");
  }
}
