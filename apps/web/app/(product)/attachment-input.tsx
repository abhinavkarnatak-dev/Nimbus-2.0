"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, X, Download, FileText } from "lucide-react";
import {
  attachmentProblem,
  attachmentImageType,
  MAX_ATTACHMENTS,
  type AttachmentView,
} from "@/lib/attachment-policy";
import styles from "./attachment-input.module.css";
type Pending = AttachmentView & {
  status: "uploading" | "ready" | "failed";
  localId: string;
  previewUrl?: string | undefined;
};
export function AttachmentInput({
  onChange,
  onBusyChange,
  disabled = false,
}: {
  onChange?: (ids: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [files, setFiles] = useState<Pending[]>([]);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null),
    chooser = useRef<HTMLInputElement>(null);
  const current = useRef<Pending[]>([]),
    mounted = useRef(true);
  const publish = useCallback(
    (next: Pending[]) => {
      for (const file of current.current) {
        if (
          file.previewUrl &&
          !next.some((row) => row.previewUrl === file.previewUrl)
        )
          URL.revokeObjectURL(file.previewUrl);
      }
      current.current = next;
      if (!mounted.current) return;
      setFiles(next);
      onChange?.(
        next.filter((file) => file.status === "ready").map((file) => file.id),
      );
      onBusyChange?.(next.some((file) => file.status !== "ready"));
    },
    [onChange, onBusyChange],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const file of current.current)
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
    };
  }, []);
  const shown = files;
  const add = useCallback(
    async (incoming: File[]) => {
      if (disabled || !incoming.length) return;
      if (current.current.length + incoming.length > MAX_ATTACHMENTS) {
        setError("You can attach a maximum of six files per message.");
        return;
      }
      for (const file of incoming) {
        const issue = attachmentProblem(file.name, file.size, file.type);
        if (issue) {
          setError(issue);
          return;
        }
      }
      setError("");
      const pending = incoming.map((file) => ({
        id: "",
        name: file.name,
        size: file.size,
        localId: crypto.randomUUID(),
        status: "uploading" as const,
        previewUrl: attachmentImageType(file.name)
          ? URL.createObjectURL(file)
          : undefined,
      }));
      publish([...current.current, ...pending]);
      for (let i = 0; i < incoming.length; i++) {
        const item = pending[i]!,
          file = incoming[i]!;
        let id = "";
        try {
          if (
            !mounted.current ||
            !current.current.some((row) => row.localId === item.localId)
          )
            continue;
          const { extractAttachment } = await import(
            "../../lib/attachment-extraction.js"
          );
          const extracted = await extractAttachment(file);
          const reservation = await fetch("/api/attachments", {
            method: "POST",
            signal: AbortSignal.timeout(60_000),
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "sign",
              files: [
                {
                  name: file.name,
                  size: file.size,
                  type: file.type,
                  textSize: extracted.blob.size,
                  warning: extracted.warning,
                },
              ],
            }),
          });
          const result = await reservation.json();
          if (!reservation.ok)
            throw new Error(result.error ?? "Could not reserve upload.");
          const upload = result.uploads[0];
          id = upload.id;
          for (const [url, body] of [
            [upload.url, file],
            [upload.textUrl, extracted.blob],
          ] as const) {
            const response = await fetch(url, {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body,
              signal: AbortSignal.timeout(120_000),
            });
            if (!response.ok)
              throw new Error(
                "Upload failed. Check the bucket's browser-upload CORS configuration and retry.",
              );
          }
          const complete = await fetch("/api/attachments", {
            method: "POST",
            signal: AbortSignal.timeout(120_000),
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "finish", id }),
          });
          const finished = await complete.json();
          if (!complete.ok)
            throw new Error(finished.error ?? "Could not verify upload.");
          if (
            mounted.current &&
            current.current.some((row) => row.localId === item.localId)
          )
            publish(
              current.current.map((row) =>
                row.localId === item.localId
                  ? {
                      ...row,
                      id,
                      status: "ready",
                      extractionWarning: extracted.warning,
                    }
                  : row,
              ),
            );
          else
            void fetch(`/api/attachments?id=${id}`, { method: "DELETE" }).catch(
              () => {},
            );
        } catch (failure) {
          if (id)
            void fetch(`/api/attachments?id=${id}`, { method: "DELETE" }).catch(
              () => {},
            );
          if (
            mounted.current &&
            current.current.some((row) => row.localId === item.localId)
          ) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Attachment upload failed.",
            );
            publish(
              current.current.map((row) =>
                row.localId === item.localId
                  ? { ...row, status: "failed" }
                  : row,
              ),
            );
          }
        }
      }
    },
    [disabled, publish],
  );
  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const paste = (event: ClipboardEvent) => {
      const selected = Array.from(event.clipboardData?.files ?? []);
      if (selected.length) {
        event.preventDefault();
        void add(selected);
      }
    };
    const drag = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      const selected = Array.from(event.dataTransfer?.files ?? []);
      if (selected.length) {
        event.preventDefault();
        void add(selected);
      }
    };
    form.addEventListener("paste", paste);
    form.addEventListener("dragover", drag);
    form.addEventListener("drop", drop);
    return () => {
      form.removeEventListener("paste", paste);
      form.removeEventListener("dragover", drag);
      form.removeEventListener("drop", drop);
    };
  }, [add]);
  return (
    <div className={styles.root} ref={root}>
      <input
        type="hidden"
        name="attachmentIds"
        value={JSON.stringify(
          shown
            .filter((file) => file.status === "ready")
            .map((file) => file.id),
        )}
      />
      <input
        aria-label="Attach files"
        type="file"
        multiple
        hidden
        ref={chooser}
        disabled={disabled}
        onChange={(event) => {
          void add(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <button
        className={styles.attach}
        type="button"
        disabled={disabled || shown.length >= MAX_ATTACHMENTS}
        title="Attach files (maximum 6 per message)"
        aria-label="Attach files (maximum 6 per message)"
        onClick={() => chooser.current?.click()}
      >
        <Paperclip size={18} />
      </button>
      {shown.map((file) => (
        <span
          key={file.localId}
          className={styles.chip}
          title={file.extractionWarning ?? file.name}
        >
          {file.previewUrl && (
            <PendingThumbnail url={file.previewUrl} name={file.name} />
          )}
          {file.name}{" "}
          <small>
            {file.status === "uploading"
              ? "Uploading..."
              : file.status === "failed"
                ? "Failed"
                : file.previewUrl
                  ? "Image"
                  : file.extractionWarning
                    ? "Partial text"
                    : "Ready"}
          </small>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove ${file.name}`}
            onClick={() => {
              publish(
                current.current.filter((row) => row.localId !== file.localId),
              );
              setError("");
              if (file.id)
                void fetch(`/api/attachments?id=${file.id}`, {
                  method: "DELETE",
                }).catch(() => {});
            }}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      {error && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}
function PendingThumbnail({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.thumbnail}
      src={url}
      alt={`Preview of ${name}`}
      onError={() => setFailed(true)}
    />
  );
}
export function AttachmentLinks({ files }: { files: AttachmentView[] }) {
  if (!files.length) return null;
  return (
    <div className={styles.links}>
      {files.map((file) => (
        <AttachmentCard key={file.id} file={file} />
      ))}
    </div>
  );
}

function AttachmentCard({ file }: { file: AttachmentView }) {
  const [failed, setFailed] = useState(false);
  const image = attachmentImageType(file.name) && !failed;
  const href = `/api/attachments?id=${file.id}`;
  return (
    <div className={styles.card}>
      {image && (
        <a
          className={styles.preview}
          href={`${href}&preview=1`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${file.name}`}
        >
          {/* Private authenticated endpoint; original images stay off the Next image cache. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${href}&preview=1`}
            alt={file.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        </a>
      )}
      <a
        className={styles.download}
        href={href}
        title={file.extractionWarning ?? file.name}
        aria-label={`Download ${file.name}`}
      >
        <FileText size={18} />
        <span>
          <strong>{file.name}</strong>
          <small>
            {file.size < 1024 * 1024
              ? `${Math.max(1, Math.round(file.size / 1024))} KB`
              : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}{" "}
            · Download
          </small>
        </span>
        <Download size={15} />
      </a>
    </div>
  );
}
