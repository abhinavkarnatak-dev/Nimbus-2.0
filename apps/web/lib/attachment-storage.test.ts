import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  send: vi.fn(),
  destroy: vi.fn(),
  sign: vi.fn(),
}));
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...(await original<object>()),
  S3Client: class {
    send = fixture.send;
    destroy = fixture.destroy;
  },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: fixture.sign,
}));
import { attachmentStorage } from "./attachment-storage";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("R2_ENDPOINT", "https://testaccount.r2.cloudflarestorage.com");
  vi.stubEnv("R2_BUCKET_NAME", "test-bucket");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  fixture.sign.mockResolvedValue("https://example.invalid/signed");
});
describe("bounded private attachment storage", () => {
  it("previews only raster images and keeps active formats download-only", async () => {
    const storage = attachmentStorage();
    await storage.download("files/image", "photo.PNG", true);
    expect(fixture.sign.mock.calls[0]?.[1].input).toMatchObject({
      ResponseContentType: "image/png",
      ResponseContentDisposition: expect.stringContaining("inline;"),
    });
    await storage.download("files/active", "drawing.svg", true);
    expect(fixture.sign.mock.calls[1]?.[1].input).toMatchObject({
      ResponseContentType: "application/octet-stream",
      ResponseContentDisposition: expect.stringContaining("attachment;"),
    });
    storage.close();
  });
  it("rejects missing configuration and bucket paths in account endpoints", () => {
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
    expect(attachmentStorage).toThrow(/configured/);
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "test");
    vi.stubEnv(
      "R2_ENDPOINT",
      "https://testaccount.r2.cloudflarestorage.com/test-bucket",
    );
    expect(attachmentStorage).toThrow(/without the bucket/);
  });
  it("presigns bounded five-minute uploads and forced-download originals", async () => {
    const storage = attachmentStorage();
    await storage.uploads("staging/test/original", 100);
    expect(fixture.sign.mock.calls[0]?.[1].input).toMatchObject({
      Key: "staging/test/original",
      ContentLength: 100,
      ContentType: "application/octet-stream",
    });
    expect(fixture.sign.mock.calls[0]?.[2]).toEqual({ expiresIn: 300 });
    await storage.download("files/test/original", "file<script>.html");
    expect(fixture.sign.mock.calls[1]?.[1].input).toMatchObject({
      ResponseContentType: "application/octet-stream",
      ResponseContentDisposition: expect.stringContaining("attachment;"),
    });
    storage.close();
    expect(fixture.destroy).toHaveBeenCalled();
  });
  it("verifies original/sidecar sizes and copies immutable final objects with ETag guards", async () => {
    fixture.send
      .mockResolvedValueOnce({ ContentLength: 4, ETag: "original-etag" })
      .mockResolvedValueOnce({ ContentLength: 4, ETag: "text-etag" })
      .mockResolvedValueOnce({
        Body: (async function* () {
          yield Buffer.from("text");
        })(),
      })
      .mockResolvedValueOnce({
        Body: (async function* () {
          yield Buffer.from("text");
        })(),
      })
      .mockResolvedValue({});
    await attachmentStorage().finalize(
      "staging/original",
      "staging/text",
      4,
      "files/original",
      "files/text",
    );
    expect(fixture.send.mock.calls[2]?.[0].input).toMatchObject({
      Range: "bytes=0-4095",
    });
    expect(fixture.send.mock.calls[4]?.[0].input).toMatchObject({
      Key: "files/original",
      CopySourceIfMatch: "original-etag",
    });
    expect(fixture.send.mock.calls[5]?.[0].input).toMatchObject({
      Key: "files/text",
      CopySourceIfMatch: "text-etag",
    });
  });
  it("rejects mismatched sizes without copying", async () => {
    fixture.send
      .mockResolvedValueOnce({ ContentLength: 5 })
      .mockResolvedValueOnce({ ContentLength: 4 });
    await expect(
      attachmentStorage().finalize("a", "b", 4, "c", "d"),
    ).rejects.toThrow(/size/);
    expect(fixture.send).toHaveBeenCalledTimes(2);
  });
  it("rejects disguised media before finalizing", async () => {
    fixture.send
      .mockResolvedValueOnce({ ContentLength: 4 })
      .mockResolvedValueOnce({ ContentLength: 4 })
      .mockResolvedValueOnce({
        Body: (async function* () {
          yield Buffer.from("ID3x");
        })(),
      });
    await expect(
      attachmentStorage().finalize("a", "b", 4, "c", "d"),
    ).rejects.toThrow(/Audio/);
    expect(fixture.send).toHaveBeenCalledTimes(3);
  });
  it("bounds sidecar streaming even when content length is absent", async () => {
    fixture.send.mockResolvedValue({
      Body: (async function* () {
        yield Buffer.alloc(120001);
      })(),
    });
    await expect(attachmentStorage().text("text")).rejects.toThrow(/limit/);
  });
});
