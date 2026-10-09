import { isArtifactReference } from "./artifact-policy";
export type ChatLink =
  | { kind: "external"; href: string }
  | { kind: "file"; reference: string }
  | { kind: "blocked" };

export function fileReferenceTarget(reference: string) {
  const match = reference.match(/^(.*?)(?::(\d+))?$/)!;
  const artifact = isArtifactReference(match[1]!);
  const query = new URLSearchParams({
    tab: artifact ? "artifacts" : "files",
    [artifact ? "artifactFile" : "file"]: match[1]!,
  });
  if (!artifact && match[2]) query.set("line", match[2]);
  return query;
}

export function chatLink(value: string, taskId: string): ChatLink {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return { kind: "blocked" };
  }
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return { kind: "blocked" };
  const local = decoded
    .replaceAll("\\", "/")
    .match(/(?:^|\/)\.nimbus\/workspaces\/([^/]+)\/(.+)$/);
  if (local) {
    const reference = local[2]!;
    if (
      local[1] !== taskId ||
      reference.split("/").some((part) => part === ".." || part === ".") ||
      /[%?#]/.test(reference)
    )
      return { kind: "blocked" };
    return { kind: "file", reference };
  }
  const remote = decoded
    .replace(/^file:\/\//, "")
    .match(/^\/workspace\/repo\/(.+)$/);
  if (remote) {
    const reference = remote[1]!.replace(/#L(\d+)$/, ":$1");
    const path = reference.replace(/:\d+$/, "");
    if (
      /[\\:%?#]/.test(path) ||
      path
        .split("/")
        .some(
          (part) =>
            !part ||
            part === "." ||
            part === ".." ||
            part.toLowerCase() === ".git",
        )
    )
      return { kind: "blocked" };
    return { kind: "file", reference };
  }
  const reference = decoded.replace(/#L(\d+)$/, ":$1");
  const relativeFile = reference.replace(/:\d+$/, "");
  if (
    !relativeFile.startsWith("/") &&
    !/[:\\%?#]/.test(relativeFile) &&
    /\.[a-zA-Z0-9_-]+$/.test(relativeFile) &&
    relativeFile
      .split("/")
      .every(
        (part) =>
          part &&
          part !== "." &&
          part !== ".." &&
          part.toLowerCase() !== ".git",
      )
  ) {
    return { kind: "file", reference };
  }
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? { kind: "external", href: url.href }
      : { kind: "blocked" };
  } catch {
    return { kind: "blocked" };
  }
}

export type ChatTextPart = { text: string; href?: string; origin?: string };

// Linkify plain user text, not Markdown/HTML, so pasted content remains literal.
export function chatTextParts(text: string): ChatTextPart[] {
  const parts: ChatTextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    let candidate = match[0].replace(/[.,;:!?]+$/, "");
    while (
      candidate.endsWith(")") &&
      (candidate.match(/\)/g)?.length ?? 0) >
        (candidate.match(/\(/g)?.length ?? 0)
    )
      candidate = candidate.slice(0, -1);
    candidate = candidate.replace(/[\]}]+$/, "");
    try {
      const url = new URL(candidate);
      if (!url.hostname || url.username || url.password) continue;
      const index = match.index!;
      if (index > cursor) parts.push({ text: text.slice(cursor, index) });
      parts.push({ text: candidate, href: url.href, origin: url.origin });
      cursor = index + candidate.length;
    } catch {
      /* Invalid URLs stay ordinary text. */
    }
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
