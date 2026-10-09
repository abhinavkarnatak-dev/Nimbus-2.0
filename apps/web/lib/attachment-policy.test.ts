import { describe, expect, it } from "vitest";
import {
  attachmentIdsSchema,
  attachmentProblem,
  mediaSignature,
  MAX_ATTACHMENT_BYTES,
} from "./attachment-policy";
const ids = Array.from(
  { length: 7 },
  (_, i) => `att_${i.toString(16).padStart(32, "0")}`,
);
describe("per-message attachment policy", () => {
  it("accepts six distinct attachments and permits a new six-file message", () => {
    expect(attachmentIdsSchema.parse(ids.slice(0, 6))).toHaveLength(6);
    expect(attachmentIdsSchema.parse(ids.slice(1))).toHaveLength(6);
    expect(attachmentIdsSchema.parse([])).toEqual([]);
  });
  it("rejects seven, duplicates and malformed ids", () => {
    for (const input of [ids, [ids[0], ids[0]], ["../../file"]])
      expect(attachmentIdsSchema.safeParse(input).success).toBe(false);
  });
  it.each([
    "notes.txt",
    "code.ts",
    "data.xlsx",
    "resume.docx",
    "report.pdf",
    "design.png",
    "data.csv",
  ])("permits mixed non-media files: %s", (name) =>
    expect(attachmentProblem(name, 100)).toBeNull(),
  );
  it.each([
    ["x.mp3", ""],
    ["x.MP4", "application/octet-stream"],
    ["x.txt", "video/webm"],
    ["x.bin", "audio/flac"],
  ])("rejects audio/video by name or MIME: %s", (name, mime) =>
    expect(attachmentProblem(name, 100, mime)).toMatch(/Audio/),
  );
  it("bounds file sizes and unsafe names", () => {
    for (const size of [0, -1, 1.2, MAX_ATTACHMENT_BYTES + 1])
      expect(attachmentProblem("x.txt", size)).not.toBeNull();
    for (const name of ["", "../x", "a\\b", "bad\nname"])
      expect(attachmentProblem(name, 100)).not.toBeNull();
  });
  it("detects disguised media but not valid UTF-16 text or JPEG", () => {
    for (const text of ["ID3", "OggS", "fLaC", "0000ftyp", "RIFF0000WAVE"])
      expect(mediaSignature(new TextEncoder().encode(text))).toBe(true);
    expect(mediaSignature(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe(
      true,
    );
    for (const bytes of [
      [0xff, 0xfe, 65, 0],
      [0xff, 0xd8, 0xff],
      [37, 80, 68, 70],
    ])
      expect(mediaSignature(Uint8Array.from(bytes))).toBe(false);
  });
});
