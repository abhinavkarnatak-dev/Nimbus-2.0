import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceBrowserCache,
  workspaceBrowserCache,
} from "./workspace-browser-cache";

afterEach(() => vi.unstubAllGlobals());

describe("workspace browser cache", () => {
  it("isolates users/tasks and invalidates only when the checkpoint changes", async () => {
    vi.stubGlobal("window", {});
    const cache = workspaceBrowserCache("user-a:task-a", "checkpoint-1");
    await cache.seed("root", "files");
    expect(
      workspaceBrowserCache("user-a:task-a", "checkpoint-1").peek("root"),
    ).toBe("files");
    expect(
      workspaceBrowserCache("user-b:task-a", "checkpoint-1").peek("root"),
    ).toBeUndefined();
    expect(
      workspaceBrowserCache("user-a:task-b", "checkpoint-1").peek("root"),
    ).toBeUndefined();
    expect(
      workspaceBrowserCache("user-a:task-a", "checkpoint-2").peek("root"),
    ).toBeUndefined();
  });
  it("never retains repository contents in server-side render caches", async () => {
    const cache = workspaceBrowserCache("server-scope", "1");
    await cache.seed("root", "private files");
    expect(
      workspaceBrowserCache("server-scope", "1").peek("root"),
    ).toBeUndefined();
  });
  it("reuses loaded folders and deduplicates in-flight requests", async () => {
    const cache = new WorkspaceBrowserCache();
    const loader = vi.fn(async () => ({ entries: ["src"] }));
    const first = cache.load("root", loader);
    expect(cache.load("root", loader)).toBe(first);
    await first;
    expect(await cache.load("root", loader)).toEqual({ entries: ["src"] });
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it("does not cache failures and allows retry", async () => {
    const cache = new WorkspaceBrowserCache();
    await expect(
      cache.load("file", async () => {
        throw new Error("unavailable");
      }),
    ).rejects.toThrow("unavailable");
    expect(await cache.load("file", async () => "recovered")).toBe("recovered");
  });
  it("ignores old requests after refresh without clearing expansion state", async () => {
    const cache = new WorkspaceBrowserCache();
    let finish!: (value: string) => void;
    const old = cache.load(
      "file",
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    cache.folders.set("src", true);
    cache.clear();
    await cache.seed("file", "new");
    finish("old");
    await old;
    expect(cache.peek("file")).toBe("new");
    expect(cache.folders.get("src")).toBe(true);
  });
  it("bounds entries and file-preview memory", async () => {
    const cache = new WorkspaceBrowserCache(2, 100);
    await cache.seed("a", "a");
    await cache.seed("b", "b");
    await cache.seed("c", "c");
    expect(cache.peek("a")).toBeUndefined();
    expect(cache.peek("c")).toBe("c");
    await cache.seed("large", "x".repeat(100));
    expect(cache.peek("large")).toBeUndefined();
  });
});
