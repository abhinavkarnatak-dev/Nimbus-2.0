import { attachmentProblem, MAX_EXTRACTED_BYTES } from "./attachment-policy";
import { unzipSync, strFromU8 } from "fflate";

function xml(value: Uint8Array) {
  const source = strFromU8(value);
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error("XML entities are not supported.");
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("Document contains invalid XML.");
  return doc;
}
function textNodes(node: Element | Document, tag: string) {
  return Array.from(node.getElementsByTagNameNS("*", tag)).map(
    (item) => item.textContent ?? "",
  );
}
export function officeText(bytes: Uint8Array, extension: string) {
  let size = 0,
    count = 0;
  // Preflight every central-directory entry before any decompression.
  unzipSync(bytes, {
    filter(file) {
      size += file.originalSize;
      count++;
      if (size > 16_000_000 || count > 2000)
        throw new Error("Expanded document exceeds the safe parsing limit.");
      return false;
    },
  });
  const entries = unzipSync(bytes, {
    filter(file) {
      return (
        /^(?:word\/(?:document|header\d+|footer\d+)\.xml|xl\/(?:workbook|sharedStrings|worksheets\/sheet\d+)\.xml|ppt\/slides\/slide\d+\.xml|content\.xml)$/.test(
          file.name,
        ) && file.originalSize <= 4_000_000
      );
    },
  });
  if (extension === "docx") {
    const main = entries["word/document.xml"];
    if (!main) throw new Error("Word document text is unavailable.");
    return Array.from(xml(main).getElementsByTagNameNS("*", "p"))
      .map((p) => textNodes(p, "t").join(""))
      .join("\n");
  }
  if (extension === "xlsx") {
    const shared = entries["xl/sharedStrings.xml"]
      ? Array.from(
          xml(entries["xl/sharedStrings.xml"]!).getElementsByTagNameNS(
            "*",
            "si",
          ),
        ).map((si) => textNodes(si, "t").join(""))
      : [];
    const sheets = entries["xl/workbook.xml"]
      ? Array.from(
          xml(entries["xl/workbook.xml"]!).getElementsByTagNameNS("*", "sheet"),
        ).map((sheet) => sheet.getAttribute("name"))
      : [];
    return Object.entries(entries)
      .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([name, data], index) => {
        const rows = Array.from(xml(data).getElementsByTagNameNS("*", "row"));
        return (
          `Sheet: ${sheets[index] ?? name}\n` +
          rows
            .map((row) =>
              Array.from(row.getElementsByTagNameNS("*", "c"))
                .map((cell) => {
                  const value = textNodes(cell, "v")[0] ?? "";
                  const type = cell.getAttribute("t");
                  return `${cell.getAttribute("r") ?? ""}=${type === "s" ? (shared[Number(value)] ?? "") : type === "inlineStr" ? textNodes(cell, "t").join("") : value}`;
                })
                .join("\t"),
            )
            .join("\n")
        );
      })
      .join("\n\n");
  }
  if (extension === "pptx")
    return Object.entries(entries)
      .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([name, data]) => `${name}\n${textNodes(xml(data), "t").join("\n")}`)
      .join("\n\n");
  if (entries["content.xml"])
    return textNodes(xml(entries["content.xml"]!), "p").join("\n");
  throw new Error("No readable document content was found.");
}
export async function extractAttachment(
  file: File,
): Promise<{ blob: Blob; warning: string | null }> {
  const problem = attachmentProblem(file.name, file.size, file.type);
  if (problem) throw new Error(problem);
  const ext = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const bytes = new Uint8Array(await file.arrayBuffer());
  let content = "",
    warning: string | null = null;
  try {
    if (ext === "pdf" || file.type === "application/pdf") {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const loading = pdfjs.getDocument({ data: bytes, useSystemFonts: false });
      const timer = setTimeout(() => {
        void loading.destroy();
      }, 30_000);
      try {
        const pdf = await loading.promise;
        for (let page = 1; page <= Math.min(pdf.numPages, 60); page++) {
          const sheet = await pdf.getPage(page);
          const text = await sheet.getTextContent();
          content +=
            `\nPage ${page}\n` +
            text.items
              .map((item) =>
                "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
              )
              .join("");
          sheet.cleanup();
          if (content.length > 80_000) break;
        }
        if (pdf.numPages > 60 || content.length > 80_000)
          warning = "PDF text is partial due to the page/text budget.";
        if (content.replace(/Page \d+/g, "").trim().length === 0)
          warning =
            "This PDF has no extractable text. Scanned pages need OCR; do not claim their contents were read.";
      } finally {
        clearTimeout(timer);
        await loading.destroy();
      }
    } else if (["docx", "xlsx", "pptx", "odt", "ods", "odp"].includes(ext)) {
      content = officeText(bytes, ext);
      if (["xlsx", "ods"].includes(ext))
        warning =
          "Spreadsheet cells are represented as text; formulas are not executed or recalculated.";
    } else {
      const binary = bytes.slice(0, 8192).some((value) => value === 0);
      const decoder =
        bytes[0] === 0xff && bytes[1] === 0xfe
          ? new TextDecoder("utf-16le")
          : bytes[0] === 0xfe && bytes[1] === 0xff
            ? new TextDecoder("utf-16be")
            : new TextDecoder("utf-8", { fatal: true });
      if (binary && !decoder.encoding.startsWith("utf-16"))
        throw new Error("Binary format has no text parser.");
      content = decoder.decode(bytes);
    }
  } catch {
    warning =
      "The original file is attached, but text extraction was unavailable (unsupported, encrypted, scanned or invalid format). Do not infer its contents.";
    content = "";
  }
  if (content.length > 28_000) {
    content = content.slice(0, 28_000);
    warning =
      `${warning ?? ""} Extracted text is truncated to the attachment budget.`.trim();
  }
  const blob = new Blob([content || "[No text extracted from this file.]"], {
    type: "application/octet-stream",
  });
  if (blob.size > MAX_EXTRACTED_BYTES)
    throw new Error("Extracted file text is too large.");
  return { blob, warning };
}
