import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, it, expect } from "vitest";
import { validatePublishingChanges } from "./task-publishing";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nimbus-publish-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("allows moved source files and tracked deletions", async () => {
  await mkdir(join(root, "phase 1"));
  await writeFile(join(root, "phase 1", "hello.py"), "print('Hello')");
  await expect(
    validatePublishingChanges(root, ["hello.py", "phase 1/hello.py"]),
  ).resolves.toBeUndefined();
});
it.each([
  "../private",
  ".git/config",
  "phase 1/.env",
  "id_rsa",
  "credentials.json",
  "secret.pem",
])("rejects unsafe paths: %s", async (path) => {
  await expect(validatePublishingChanges(root, [path])).rejects.toThrow();
});
it("rejects secret content even in ordinary source files", async () => {
  await writeFile(
    join(root, "hello.py"),
    "token = 'ghp_" + "A".repeat(36) + "'",
  );
  await expect(validatePublishingChanges(root, ["hello.py"])).rejects.toThrow(
    "credential",
  );
});
it("rejects linked directories instead of reading or publishing outside files", async () => {
  const outside = await mkdtemp(join(tmpdir(), "nimbus-publish-outside-"));
  try {
    await writeFile(join(outside, "private.txt"), "private");
    await symlink(outside, join(root, "linked"), "junction");
    await expect(
      validatePublishingChanges(root, ["linked/private.txt"]),
    ).rejects.toThrow("Linked");
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});
