"use client";

import {
  createContext,
  isValidElement,
  useContext,
  useState,
  type ReactNode,
} from "react";
import Markdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { chatLink, fileReferenceTarget } from "@/lib/chat-links";
import styles from "./conversation.module.css";
import { MermaidDiagram } from "./mermaid-diagram";
import { hasClosedDiagramFence } from "@/lib/mermaid-source";

const MarkdownSource = createContext("");

export function MarkdownMessage({
  text,
  taskId,
  onOpenFile,
}: {
  text: string;
  taskId: string;
  onOpenFile?: (reference: string) => void;
}) {
  return (
    <div className={styles.markdown} data-markdown-message>
      <MarkdownSource.Provider value={text}>
        <Markdown
          skipHtml
          remarkPlugins={[remarkGfm]}
          urlTransform={(url, key) =>
            key === "href" && chatLink(url, taskId).kind !== "blocked"
              ? url
              : ""
          }
          components={{
            pre: CodeBlock,
            img: ({ alt }) => (
              <span>{alt ? `[Image: ${alt}]` : "[Image omitted]"}</span>
            ),
            a: ({ href, children }) => {
              const link = chatLink(href ?? "", taskId);
              if (link.kind === "file") {
                const query = fileReferenceTarget(link.reference);
                return (
                  <Link
                    href={`/tasks/${taskId}?${query}`}
                    scroll={false}
                    className={styles.fileReference}
                    title={link.reference}
                    aria-label={`Open ${link.reference} in ${query.get("tab") === "artifacts" ? "Artifacts" : "Files"}`}
                    onClick={(event) => {
                      if (
                        onOpenFile &&
                        !event.ctrlKey &&
                        !event.metaKey &&
                        !event.shiftKey &&
                        !event.altKey
                      ) {
                        event.preventDefault();
                        onOpenFile(link.reference);
                      }
                    }}
                  >
                    {children}
                    <small>{link.reference.match(/:(\d+)$/)?.[0]}</small>
                  </Link>
                );
              }
              if (link.kind === "external")
                return (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    {children}
                  </a>
                );
              return <span>{children}</span>;
            },
          }}
        >
          {text}
        </Markdown>
      </MarkdownSource.Provider>
    </div>
  );
}

function CodeBlock({
  children,
  node,
}: {
  children?: ReactNode;
} & ExtraProps) {
  const markdown = useContext(MarkdownSource);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const element = isValidElement<{ children?: ReactNode; className?: string }>(
    children,
  )
    ? children
    : null;
  const code =
    typeof element?.props.children === "string" ? element.props.children : "";
  const language =
    element?.props.className?.replace(/^language-/, "") ?? "Code";
  const extension = fileExtension(language);
  const downloadable = Boolean(extension);
  if (language.toLowerCase() === "mermaid")
    return (
      <MermaidDiagram
        source={code}
        complete={hasClosedDiagramFence(
          markdown,
          node?.position?.start.offset,
          node?.position?.end.offset,
        )}
      />
    );
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeading}>
        <span>{language}</span>
        <span className={styles.codeActions}>
          {downloadable && (
            <button
              type="button"
              aria-label="Download file"
              onClick={() => downloadCode(code, extension!)}
            >
              {extension === "csv"
                ? "Download Excel CSV"
                : `Download .${extension}`}
            </button>
          )}
          <button
            type="button"
            aria-label="Copy code"
            onClick={() => {
              void navigator.clipboard
                .writeText(code)
                .then(() => {
                  setCopiedCode(code);
                  setCopyError(false);
                })
                .catch(() => setCopyError(true));
            }}
          >
            {copyError
              ? "Copy unavailable"
              : copiedCode === code
                ? "Copied"
                : "Copy code"}
          </button>
        </span>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function fileExtension(language: string) {
  const normalized = language.trim().toLowerCase();
  const aliases: Record<string, string> = {
    javascript: "js",
    typescript: "ts",
    python: "py",
    ruby: "rb",
    shell: "sh",
    bash: "sh",
    powershell: "ps1",
    markdown: "md",
    excel: "csv",
    spreadsheet: "csv",
    xlsx: "csv",
    xls: "csv",
    word: "doc",
    document: "doc",
    docx: "doc",
  };
  if (aliases[normalized]) return aliases[normalized];
  if (/^(Code|text)$/i.test(language)) return null;
  return /^[a-z0-9]{1,8}$/i.test(normalized) ? normalized : null;
}

function downloadCode(code: string, extension: string) {
  const content =
    extension === "doc"
      ? wordDocument(code)
      : extension === "pdf"
        ? pdfDocument(code)
        : code;
  const blob = new Blob([content], { type: mimeType(extension) });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `nimbus-export.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
}

function mimeType(extension: string) {
  if (extension === "pdf") return "application/pdf";
  if (extension === "doc") return "application/msword";
  if (extension === "csv" || extension === "tsv")
    return "text/csv;charset=utf-8";
  return "text/plain;charset=utf-8";
}

function wordDocument(text: string) {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<html><body><pre>${escaped}</pre></body></html>`;
}

function pdfDocument(text: string) {
  const lines = text
    .replaceAll(/[^\x09\x0a\x0d\x20-\x7e]/g, "?")
    .split(/\r?\n/)
    .flatMap((line) => line.match(/.{1,95}/g) ?? [""])
    .slice(0, 48);
  const commands = [
    "BT",
    "/F1 11 Tf",
    "50 760 Td",
    ...lines.map(
      (line, index) =>
        `${index ? "0 -15 Td " : ""}(${line.replaceAll(/[\\()]/g, (value) => `\\${value}`)}) Tj`,
    ),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = output.length;
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++)
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return output;
}
