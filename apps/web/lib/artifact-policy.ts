const types: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
};
export function artifactMimeType(path: string) {
  return (
    types[path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream"
  );
}
export function isArtifactReference(path: string) {
  const extension = path.split(".").pop()!.toLowerCase();
  return (
    /\.[^/]+$/.test(path) &&
    ![
      "txt",
      "md",
      "mdx",
      "csv",
      "json",
      "yaml",
      "yml",
      "toml",
      "xml",
      "html",
      "css",
      "scss",
      "js",
      "jsx",
      "ts",
      "tsx",
      "py",
      "go",
      "rs",
      "cpp",
      "c",
      "h",
      "hpp",
      "java",
      "kt",
      "rb",
      "php",
      "sh",
      "ps1",
      "sql",
      "ipynb",
      "log",
      "ini",
      "cfg",
    ].includes(extension)
  );
}
export function isPrivateArtifactPath(path: string) {
  return path
    .split("/")
    .some((part) =>
      /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|\.ssh|\.aws|\.azure|\.config|credentials(?:\..*)?|id_(?:rsa|ed25519|ecdsa)|.*\.(?:pem|key|p12|pfx))$/i.test(
        part,
      ),
    );
}
