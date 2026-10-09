import { z } from "zod";
export const MAX_ATTACHMENTS = 6;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_BYTES = 120_000;
// Never render active formats such as HTML or SVG as inline attachments.
export function attachmentImageType(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return (
    (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        avif: "image/avif",
        bmp: "image/bmp",
      } as Record<string, string>
    )[extension ?? ""] ?? null
  );
}
export const attachmentIdsSchema = z
  .array(z.string().regex(/^att_[a-f0-9]{32}$/))
  .max(MAX_ATTACHMENTS)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate attachments");
export function attachmentProblem(name: string, size: number, type = "") {
  if (!name.trim() || name.length > 200 || /[\x00-\x1f/\\]/.test(name))
    return "Invalid file name.";
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ATTACHMENT_BYTES)
    return "Each file must be between 1 byte and 10 MB.";
  if (
    /^(?:audio|video)\//i.test(type) ||
    /\.(?:mp3|mp4|wav|wave|ogg|oga|ogv|opus|flac|aac|m4a|m4v|mov|avi|webm|mkv|wmv|wma|mpeg|mpg|3gp|mid|midi)$/i.test(
      name,
    )
  )
    return "Audio and video attachments are not supported yet.";
  return null;
}
export function mediaSignature(bytes: Uint8Array) {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 16));
  return (
    head.startsWith("ID3") ||
    head.startsWith("OggS") ||
    head.startsWith("fLaC") ||
    head.slice(4, 8) === "ftyp" ||
    (head.startsWith("RIFF") && /WAVE|AVI /.test(head)) ||
    (bytes[0] === 0xff &&
      bytes[1] !== 0xfe &&
      bytes[1] !== 0xff &&
      (bytes[1]! & 0xe0) === 0xe0) ||
    (bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3)
  );
}
export type AttachmentView = {
  id: string;
  name: string;
  size: number;
  messageId?: string | null;
  extractionWarning?: string | null;
};
