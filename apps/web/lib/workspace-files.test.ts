import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { resolve, join, basename, relative } from "node:path";
import {
  filePath,
  listWorkspaceDirectory,
  readWorkspaceFile,
  readWorkspaceVersion,
  taskFileRoot,
  workspaceFileHistory,
} from "./workspace-files";
const repositoryRoot = resolve(__dirname, "../../..");
const base = join(repositoryRoot, ".nimbus/workspaces");
let root: string;
let first: string;
function git(...args: string[]) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=File Browser Test",
      "-c",
      "user.email=files@example.invalid",
      ...args,
    ],
    { cwd: root, windowsHide: true },
  )
    .toString()
    .trim();
}
beforeAll(async () => {
  await mkdir(base, { recursive: true });
  root = await mkdtemp(join(base, "files-test-"));
  git("init", "-q");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/hello.ts"), "const hello = 1;\n");
  git("add", ".");
  git("commit", "-qm", "Initial file");
  first = git("rev-parse", "HEAD");
  git("mv", "src/hello.ts", "src/greeting.ts");
  git("commit", "-qm", "Rename file");
  await writeFile(join(root, "src/greeting.ts"), "const hello = 2;\n");
  git("add", ".");
  git("commit", "-qm", "Update greeting");
});
afterAll(async () => {
  if (
    root &&
    relative(base, root).startsWith("files-test-") &&
    !relative(base, root).includes("/")
  )
    await rm(root, { recursive: true, force: true });
});
describe("task workspace file reads", () => {
  it("browses unchanged files and directories without exposing Git internals", async () => {
    expect(await taskFileRoot(repositoryRoot, basename(root))).toBe(root);
    expect(await listWorkspaceDirectory(root, "")).toEqual([
      { name: "src", path: "src", kind: "directory" },
    ]);
    expect(await readWorkspaceFile(root, "src/greeting.ts")).toBe(
      "const hello = 2;\n",
    );
  });
  it("shows file history through renames and reads an older version", async () => {
    const history = await workspaceFileHistory(root, "src/greeting.ts", 0);
    expect(history.entries.map((entry) => entry.subject)).toEqual([
      "Update greeting",
      "Rename file",
      "Initial file",
    ]);
    expect(history.entries.at(-1)?.path).toBe("src/hello.ts");
    expect(await readWorkspaceVersion(root, "src/hello.ts", first)).toBe(
      "const hello = 1;\n",
    );
    expect(history.nextOffset).toBeNull();
  });
  it("rejects traversal, absolute paths, Git internals, and arbitrary revision syntax", async () => {
    for (const path of [
      "../secret",
      "src/../../secret",
      "C:/secret",
      "src\\secret",
      "/etc/passwd",
      ".git/config",
      "src/.GIT/config",
      "src//hello",
      "src/hello:stream",
      "src/hello\0",
    ])
      expect(() => filePath(path)).toThrow();
    await expect(
      readWorkspaceVersion(root, "src/greeting.ts", "HEAD:../../secret"),
    ).rejects.toThrow("Invalid file revision");
    await expect(taskFileRoot(repositoryRoot, "../task")).rejects.toThrow();
  });
  it("refuses binary and oversized previews", async () => {
    await writeFile(join(root, "binary"), Buffer.from([0, 1, 2]));
    await writeFile(join(root, "large"), Buffer.alloc(1_000_001, 97));
    await expect(readWorkspaceFile(root, "binary")).rejects.toThrow("Binary");
    await expect(readWorkspaceFile(root, "large")).rejects.toThrow("1 MB");
  });
  it("does not follow directory links outside the assigned workspace", async () => {
    await symlink(repositoryRoot, join(root, "outside"), "junction");
    await expect(listWorkspaceDirectory(root, "outside")).rejects.toThrow(
      "Symbolic links",
    );
    await expect(
      readWorkspaceFile(root, "outside/package.json"),
    ).rejects.toThrow("Symbolic links");
    expect(
      (await listWorkspaceDirectory(root, "")).find(
        (entry) => entry.name === "outside",
      )?.kind,
    ).toBe("link");
  });
  it("paginates file history without dropping older commits", async () => {
    for (let index = 0; index < 26; index++) {
      await writeFile(
        join(root, "src/greeting.ts"),
        `const hello = ${index + 3};\n`,
      );
      git("add", "src/greeting.ts");
      git("commit", "-qm", `History ${index}`);
    }
    const firstPage = await workspaceFileHistory(root, "src/greeting.ts", 0);
    expect(firstPage.entries).toHaveLength(25);
    expect(firstPage.nextOffset).toBe(25);
    const finalPage = await workspaceFileHistory(root, "src/greeting.ts", 25);
    expect(finalPage.entries).toHaveLength(4);
    expect(finalPage.nextOffset).toBeNull();
    expect(
      new Set(
        [...firstPage.entries, ...finalPage.entries].map(
          (entry) => entry.revision,
        ),
      ).size,
    ).toBe(29);
  }, 30000);
});
