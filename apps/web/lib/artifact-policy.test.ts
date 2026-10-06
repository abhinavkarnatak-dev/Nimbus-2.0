import { describe, expect, it } from "vitest";
import {
  artifactMimeType,
  isArtifactReference,
  isPrivateArtifactPath,
} from "./artifact-policy";
import { fileReferenceTarget } from "./chat-links";
describe("downloadable artifacts", () => {
  it("supports documents, office files, unknown binaries and source files without a type restriction", () => {
    expect(artifactMimeType("report.XLSX")).toContain("spreadsheetml");
    expect(artifactMimeType("report.docx")).toContain("wordprocessingml");
    expect(artifactMimeType("slides.pptx")).toContain("presentationml");
    expect(artifactMimeType("output.custom")).toBe("application/octet-stream");
    expect(artifactMimeType("README.md")).toBe("text/markdown");
    for (const file of [
      "sheet.xlsx",
      "document.docx",
      "slides.pptx",
      "archive.zip",
      "image.png",
      "output.custom",
    ])
      expect(fileReferenceTarget(file).get("tab")).toBe("artifacts");
    for (const file of ["README.md", "main.py", "index.ts", "data.csv"])
      expect(isArtifactReference(file)).toBe(false);
  });
  it("never publishes credential paths", () => {
    for (const file of [
      ".env",
      ".env.local",
      "keys/app.pem",
      "client.key",
      ".ssh/id_rsa",
      ".aws/credentials",
      ".npmrc",
    ])
      expect(isPrivateArtifactPath(file)).toBe(true);
    expect(isPrivateArtifactPath("reports/overview.txt")).toBe(false);
  });
});
