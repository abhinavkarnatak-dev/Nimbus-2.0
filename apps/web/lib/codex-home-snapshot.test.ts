import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HOME_SNAPSHOT_VERSION,
  restoreCodexHome,
  snapshotCodexHome,
} from "./codex-home-snapshot";

let root = "";

async function home(name: string) {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nimbus-home-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Codex credential home snapshot", () => {
  it("keeps the credential and rollout files and skips temporary state", async () => {
    const directory = await home("source");
    await writeFile(join(directory, "auth.json"), '{"stub":"credential"}');
    await mkdir(join(directory, "sessions", "2026"), { recursive: true });
    await writeFile(join(directory, "sessions", "2026", "a.jsonl"), "rollout");
    await mkdir(join(directory, "tmp"), { recursive: true });
    await writeFile(join(directory, "tmp", "junk"), "junk");
    await symlink("/etc/passwd", join(directory, "escape"));

    const snapshot = await snapshotCodexHome(directory);
    expect(snapshot).not.toBeNull();
    const parsed = JSON.parse(snapshot!) as {
      version: number;
      files: Record<string, string>;
    };
    expect(parsed.version).toBe(HOME_SNAPSHOT_VERSION);
    expect(Object.keys(parsed.files).sort()).toEqual([
      "auth.json",
      "sessions/2026/a.jsonl",
    ]);
    expect(
      Buffer.from(parsed.files["sessions/2026/a.jsonl"]!, "base64").toString(),
    ).toBe("rollout");
  });

  it("does not snapshot a home without a credential", async () => {
    const directory = await home("empty");
    await writeFile(join(directory, "notes.txt"), "nothing to keep");
    expect(await snapshotCodexHome(directory)).toBeNull();
  });

  it("round trips a snapshot into a replaced container", async () => {
    const source = await home("source");
    await writeFile(join(source, "auth.json"), '{"stub":"credential"}');
    await mkdir(join(source, "sessions"), { recursive: true });
    await writeFile(join(source, "sessions", "rollout.jsonl"), "resumable");
    const snapshot = await snapshotCodexHome(source);

    const restored = await home("restored");
    expect(await restoreCodexHome(restored, snapshot!)).toBe(2);
    expect(await readFile(join(restored, "auth.json"), "utf8")).toBe(
      '{"stub":"credential"}',
    );
    expect(
      await readFile(join(restored, "sessions", "rollout.jsonl"), "utf8"),
    ).toBe("resumable");
  });

  it("never overwrites a file that already exists", async () => {
    const directory = await home("live");
    await writeFile(join(directory, "auth.json"), "current");
    const snapshot = JSON.stringify({
      version: HOME_SNAPSHOT_VERSION,
      files: { "auth.json": Buffer.from("stale").toString("base64") },
    });
    expect(await restoreCodexHome(directory, snapshot)).toBe(0);
    expect(await readFile(join(directory, "auth.json"), "utf8")).toBe(
      "current",
    );
  });

  it("refuses to write outside the credential directory", async () => {
    const directory = await home("guarded");
    const snapshot = JSON.stringify({
      version: HOME_SNAPSHOT_VERSION,
      files: {
        "../escape.txt": Buffer.from("escape").toString("base64"),
        "/etc/passwd": Buffer.from("escape").toString("base64"),
        "a/../../escape.txt": Buffer.from("escape").toString("base64"),
        "..\\escape.txt": Buffer.from("escape").toString("base64"),
        "": Buffer.from("escape").toString("base64"),
      },
    });
    expect(await restoreCodexHome(directory, snapshot)).toBe(0);
    await expect(readFile(join(root, "escape.txt"), "utf8")).rejects.toThrow();
  });

  it("ignores unusable snapshots", async () => {
    const directory = await home("invalid");
    expect(await restoreCodexHome(directory, "not json")).toBe(0);
    expect(
      await restoreCodexHome(
        directory,
        JSON.stringify({ version: 99, files: { "auth.json": "x" } }),
      ),
    ).toBe(0);
    expect(
      await restoreCodexHome(directory, JSON.stringify({ files: {} })),
    ).toBe(0);
  });
});
