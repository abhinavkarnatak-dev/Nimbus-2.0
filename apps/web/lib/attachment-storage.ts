import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  MAX_EXTRACTED_BYTES,
  mediaSignature,
  attachmentImageType,
} from "./attachment-policy";

export function attachmentStorage() {
  const endpoint = process.env.R2_ENDPOINT?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey)
    throw new Error("Attachment storage is not configured.");
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9]+(?:\.(?:eu|us|fedramp))?\.r2\.cloudflarestorage\.com$/i.test(
      url.hostname,
    ) ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    !/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket)
  )
    throw new Error(
      "R2_ENDPOINT must be the account S3 origin, without the bucket path.",
    );
  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    maxAttempts: 2,
  });
  async function bytes(key: string, limit: number, range?: string) {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
      { abortSignal: AbortSignal.timeout(20_000) },
    );
    if (!response.Body) throw new Error("Uploaded file is missing.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > limit) throw new Error("Attachment data exceeds its limit.");
        chunks.push(chunk);
      }
    } finally {
      (response.Body as { destroy?: () => void }).destroy?.();
    }
    return Buffer.concat(chunks);
  }
  return {
    async uploads(key: string, size: number) {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: "application/octet-stream",
          ContentLength: size,
        }),
        { expiresIn: 300 },
      );
    },
    async download(key: string, name: string, preview = false) {
      const imageType = preview ? attachmentImageType(name) : null;
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentType: imageType ?? "application/octet-stream",
          ResponseContentDisposition: `${imageType ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        }),
        { expiresIn: 300 },
      );
    },
    async finalize(
      key: string,
      textKey: string,
      expectedSize: number,
      finalKey: string,
      finalTextKey: string,
    ) {
      const original = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(20_000) },
      );
      const text = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: textKey }),
        { abortSignal: AbortSignal.timeout(20_000) },
      );
      if (
        original.ContentLength !== expectedSize ||
        !text.ContentLength ||
        text.ContentLength > MAX_EXTRACTED_BYTES
      )
        throw new Error(
          "Uploaded file size does not match its upload reservation.",
        );
      if (mediaSignature(await bytes(key, 4096, "bytes=0-4095")))
        throw new Error("Audio and video attachments are not supported yet.");
      if (!original.ETag || !text.ETag)
        throw new Error("Upload verification metadata is missing.");
      new TextDecoder("utf-8", { fatal: true }).decode(
        await bytes(textKey, MAX_EXTRACTED_BYTES),
      );
      // Copy to keys that were never presigned for upload. A still-valid staging
      // PUT cannot mutate a finalized attachment after it is bound to a message.
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: finalKey,
          CopySource: `${bucket}/${key}`,
          CopySourceIfMatch: original.ETag,
        }),
        { abortSignal: AbortSignal.timeout(20_000) },
      );
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: finalTextKey,
          CopySource: `${bucket}/${textKey}`,
          CopySourceIfMatch: text.ETag,
        }),
        { abortSignal: AbortSignal.timeout(20_000) },
      );
    },
    text: async (key: string) =>
      new TextDecoder("utf-8", { fatal: true }).decode(
        await bytes(key, MAX_EXTRACTED_BYTES),
      ),
    async remove(key: string) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(20_000),
      });
    },
    close() {
      client.destroy();
    },
  };
}
