import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  text: vi.fn(),
  download: vi.fn(),
  close: vi.fn(),
  where: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@nimbus/database", async (original) => ({
  ...(await original<object>()),
  db: () => ({ select: fixture.query }),
}));
vi.mock("./attachment-storage", () => ({
  attachmentStorage: () => ({
    text: fixture.text,
    download: fixture.download,
    close: fixture.close,
  }),
}));
import {
  attachmentContext,
  prepareAttachmentReader,
} from "./message-attachments";
const id = "att_00000000000000000000000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  fixture.rows = [
    {
      id,
      name: "notes.txt",
      size: 30,
      textKey: "private/text",
      objectKey: "private/original",
      extractionWarning: null,
    },
  ];
  fixture.where.mockImplementation(() => ({
    limit: async () => fixture.rows,
    then: (resolve: (rows: typeof fixture.rows) => void) =>
      resolve(fixture.rows),
  }));
  fixture.query.mockReturnValue({ from: () => ({ where: fixture.where }) });
  fixture.text.mockResolvedValue("a".repeat(28_000));
  fixture.download.mockResolvedValue("https://private.example/signed");
});
describe("scoped attachment reader", () => {
  it("leaves existing no-file messages entirely unchanged", async () => {
    expect(await attachmentContext("task", "org", [])).toBe("");
    expect(fixture.query).not.toHaveBeenCalled();
  });
  it("gives bounded previews and declares untrusted/partial content", async () => {
    const result = await attachmentContext("task", "org", [id]);
    expect(result).toContain("UNTRUSTED");
    expect(result).toContain('"truncated":true');
    expect(result.length).toBeLessThan(5000);
    expect(fixture.close).toHaveBeenCalled();
  });
  it("lists files without downloading or parsing their originals", async () => {
    expect(
      await prepareAttachmentReader("task", "org", false).onAttachmentCall({}),
    ).toMatchObject({ success: true, files: [{ id }] });
    expect(fixture.text).not.toHaveBeenCalled();
  });
  it("reads later chunks and never provides original URLs to general chat", async () => {
    const reader = prepareAttachmentReader("task", "org", false);
    expect(
      await reader.onAttachmentCall({ id, offset: 12000, original: true }),
    ).toMatchObject({ success: true, offset: 12000, nextOffset: 24000 });
    expect(fixture.download).not.toHaveBeenCalled();
  });
  it("provides a short-lived original only to existing repository sessions", async () => {
    expect(
      await prepareAttachmentReader("task", "org", true).onAttachmentCall({
        id,
        original: true,
      }),
    ).toMatchObject({
      originalDownloadUrl: "https://private.example/signed",
      expiresInSeconds: 300,
    });
  });
  it("rejects unavailable files and malformed arguments", async () => {
    fixture.rows = [];
    const reader = prepareAttachmentReader("task", "org", true);
    expect(await reader.onAttachmentCall({ id })).toMatchObject({
      success: false,
    });
    expect(await reader.onAttachmentCall({ id, offset: -1 })).toMatchObject({
      success: false,
    });
    expect(fixture.text).not.toHaveBeenCalled();
  });
  it("does not invent content after a storage failure", async () => {
    fixture.text.mockRejectedValue(new Error("private storage failure"));
    expect(
      await prepareAttachmentReader("task", "org", false).onAttachmentCall({
        id,
      }),
    ).toMatchObject({
      success: false,
      message: expect.not.stringContaining("private storage failure"),
    });
  });
  it("bounds reads and checks cancellation", async () => {
    const reader = prepareAttachmentReader("task", "org", false);
    for (let i = 0; i < 8; i++)
      expect(await reader.onAttachmentCall({ id })).toMatchObject({
        success: true,
      });
    expect(await reader.onAttachmentCall({ id })).toMatchObject({
      success: false,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      prepareAttachmentReader(
        "task",
        "org",
        false,
        controller.signal,
      ).onAttachmentCall({}),
    ).rejects.toThrow();
  });
});
