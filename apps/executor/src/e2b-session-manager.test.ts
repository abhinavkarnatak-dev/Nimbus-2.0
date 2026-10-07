import { describe, expect, it } from "vitest";
import { validateSavedFiles } from "./e2b-session-manager.js";
describe("durable remote checkpoint validation", () => {
  it("rejects oversized files and total checkpoints before allocating decoded copies", () => {
    const data = Buffer.alloc(8_000_001).toString("base64");
    expect(() =>
      validateSavedFiles([{ path: "large.bin", data, executable: false }]),
    ).toThrow("byte limit");
    const small = Buffer.alloc(6_000_001).toString("base64");
    expect(() =>
      validateSavedFiles(
        ["a", "b", "c", "d"].map((path) => ({
          path,
          data: small,
          executable: false,
        })),
      ),
    ).toThrow("byte limit");
  });
  it("preserves arbitrary binary data and executable metadata", () => {
    const file = {
      path: "phase 2/output.bin",
      data: Buffer.from([0, 255, 123]).toString("base64"),
      executable: false,
    };
    expect(validateSavedFiles([file])).toEqual([file]);
  });
  it("rejects escape, Git metadata, Windows alternate streams and linked-path aliases", () => {
    for (const path of [
      "../secret",
      "/etc/passwd",
      ".git/config",
      "a/.GIT/hooks/x",
      "C:/secret",
      "a\\secret",
      "a:stream",
      "NUL.txt",
      "a./test",
      "a//b",
    ])
      expect(() =>
        validateSavedFiles([{ path, data: "", executable: false }]),
      ).toThrow();
  });
  it("rejects corrupt bytes and case-insensitive collisions before touching the mirror", () => {
    expect(() =>
      validateSavedFiles([{ path: "a", data: "invalid!", executable: false }]),
    ).toThrow();
    expect(() =>
      validateSavedFiles(
        ["a", "A"].map((path) => ({ path, data: "", executable: false })),
      ),
    ).toThrow();
  });
});
