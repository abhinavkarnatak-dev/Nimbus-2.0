import { describe, expect, it } from "vitest";
import { chatLink, fileReferenceTarget } from "./chat-links";

describe("untrusted Markdown links", () => {
  it("routes remote Linux references into the same task workbench", () => {
    expect(chatLink("/workspace/repo/src/main.py:12", "task-a")).toEqual({
      kind: "file",
      reference: "src/main.py:12",
    });
    expect(chatLink("file:///workspace/repo/report.pdf", "task-a")).toEqual({
      kind: "file",
      reference: "report.pdf",
    });
    for (const value of [
      "/workspace/repo/../secret",
      "/workspace/repo/.git/config",
      "/workspace/repo/a:stream",
    ])
      expect(chatLink(value, "task-a")).toEqual({ kind: "blocked" });
  });
  it("routes PDF output references to Artifacts instead of source previews", () => {
    expect(fileReferenceTarget("reports/Overview.PDF:1").get("tab")).toBe(
      "artifacts",
    );
    expect(
      fileReferenceTarget("reports/Overview.PDF:1").get("artifactFile"),
    ).toBe("reports/Overview.PDF");
    expect(fileReferenceTarget("src/main.ts:7").get("line")).toBe("7");
  });
  it("opens relative repository references with line numbers", () => {
    expect(chatLink("docs/quickstart.md#L12", "task-a")).toEqual({
      kind: "file",
      reference: "docs/quickstart.md:12",
    });
    expect(chatLink("README.md", "task-a")).toEqual({
      kind: "file",
      reference: "README.md",
    });
    expect(chatLink("../secret.txt", "task-a")).toEqual({ kind: "blocked" });
  });
  it("keeps references inside the assigned workspace without exposing the host path", () => {
    expect(
      chatLink(
        "C:/Users/user/Nimbus%202.0/.nimbus/workspaces/task-a/README.md:1",
        "task-a",
      ),
    ).toEqual({ kind: "file", reference: "README.md:1" });
    expect(
      chatLink("/work/.nimbus/workspaces/task-a/src/main.ts:42", "task-a"),
    ).toEqual({ kind: "file", reference: "src/main.ts:42" });
  });
  it("blocks script, filesystem, credential-bearing, malformed and cross-task links", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "file:///etc/passwd",
      "https://user:password@example.com",
      "http://example.com/%0a",
      "%ZZ",
      "C:/work/.nimbus/workspaces/task-b/README.md",
      "C:/work/.nimbus/workspaces/task-a/../secret.txt",
      "C:/work/.nimbus/workspaces/task-a/%252e%252e/secret.txt",
    ]) {
      expect(chatLink(value, "task-a")).toEqual({ kind: "blocked" });
    }
  });
  it("permits normal documentation links", () => {
    expect(chatLink("https://example.com/docs?q=typescript", "task-a")).toEqual(
      { kind: "external", href: "https://example.com/docs?q=typescript" },
    );
  });
});
