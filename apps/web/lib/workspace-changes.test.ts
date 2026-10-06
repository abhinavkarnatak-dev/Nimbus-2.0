import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, unlink, rm } from "node:fs/promises";
import { join, resolve, relative, basename } from "node:path";
import { workspaceChanges } from "./workspace-files";
const base = resolve(__dirname, "../../../.nimbus/workspaces");
let root: string;
const git = (...args: string[]) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Diff Test",
      "-c",
      "user.email=diff@example.invalid",
      ...args,
    ],
    { cwd: root, windowsHide: true },
  ).toString();
beforeAll(async () => {
  await mkdir(base, { recursive: true });
  root = await mkdtemp(join(base, "task_diff_test_"));
  git("init", "-q");
  for (const [name, text] of [
    ["move.txt", "move me\n"],
    ["edit.txt", "before\n"],
    ["delete.txt", "remove me\n"],
    [".env", "SECRET=private\n"],
  ])
    await writeFile(join(root, name!), text!);
  git("add", ".");
  git("commit", "-qm", "Baseline");
  git(
    "update-ref",
    "refs/remotes/origin/main",
    git("rev-parse", "HEAD").trim(),
  );
  git("checkout", "-qb", `nimbus/${basename(root)}`);
  await mkdir(join(root, "folder"));
  git("mv", "move.txt", "folder/move.txt");
  await writeFile(join(root, "edit.txt"), "++after\n");
  await unlink(join(root, "delete.txt"));
  await writeFile(join(root, "new.txt"), "new line\n");
  await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2]));
  await writeFile(join(root, ".env"), "SECRET=changed\n");
});
afterAll(async () => {
  if (root && /^task_diff_test_[^/\\]+$/.test(relative(base, root)))
    await rm(root, { recursive: true, force: true });
});
describe("real workspace diffs", () => {
  it("shows moves, untracked additions, removed lines, binary changes and exact totals without staging", async () => {
    const before = git("status", "--porcelain");
    const result = await workspaceChanges(root, "main");
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "folder/move.txt",
          previousPath: "move.txt",
          status: "renamed",
          additions: 0,
          deletions: 0,
        }),
        expect.objectContaining({
          path: "edit.txt",
          status: "modified",
          additions: 1,
          deletions: 1,
        }),
        expect.objectContaining({
          path: "delete.txt",
          status: "deleted",
          additions: 0,
          deletions: 1,
        }),
        expect.objectContaining({
          path: "new.txt",
          status: "added",
          additions: 1,
          deletions: 0,
        }),
        expect.objectContaining({ path: "binary.bin", binary: true }),
      ]),
    );
    expect(
      result.files.find((file) => file.path === "edit.txt")?.patch,
    ).toContain("+++after");
    expect(result.files.some((file) => file.path === ".env")).toBe(false);
    expect(git("status", "--porcelain")).toBe(before);
  });
  it("rejects unsafe comparison references", async () => {
    await expect(workspaceChanges(root, "--output=/tmp/file")).rejects.toThrow(
      "Invalid base",
    );
  });
  it("keeps session diffs after publishing and advancement of the default branch", async () => {
    git("add", ".");
    git("commit", "-qm", "Session edits");
    git(
      "update-ref",
      "refs/remotes/origin/main",
      git("rev-parse", "HEAD").trim(),
    );
    const result = await workspaceChanges(root, "main");
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "folder/move.txt",
          previousPath: "move.txt",
          status: "renamed",
        }),
        expect.objectContaining({
          path: "edit.txt",
          additions: 1,
          deletions: 1,
        }),
      ]),
    );
  });
});
