import { describe, expect, it } from "vitest";
import {
  diagramKind,
  diagramSourceProblem,
  hasClosedDiagramFence,
} from "./mermaid-source";
describe("scoped diagram definitions", () => {
  it.each([
    "flowchart TD\nA --> B",
    "graph LR\nA --> B",
    "%% note\nsequenceDiagram\nA->>B: Hello",
  ])("accepts flowcharts and sequences: %s", (source) =>
    expect(diagramSourceProblem(source)).toBeNull(),
  );
  it.each(['pie\n"A": 2', "classDiagram\nclass A", "root/\n├── src/"])(
    "does not reinterpret other diagram/tree formats: %s",
    (source) => expect(diagramKind(source)).toBeNull(),
  );
  it.each([
    "%%{init: {securityLevel: 'loose'}}%%\nflowchart TD\nA-->B",
    'flowchart TD\nclick A "https://evil.test"',
    "flowchart TD\nA[<img src=x onerror=alert(1)>]",
    "flowchart TD\nclassDef unsafe fill:url(https://evil.test)",
    'flowchart TD\nA@{img: "https://evil.test/a.png"}',
    "sequenceDiagram\nlink A: Website @ https://evil.test",
  ])("rejects configuration, interactions and external resources", (source) =>
    expect(diagramSourceProblem(source)).not.toBeNull(),
  );
  it("bounds input size and keeps arrows valid", () => {
    expect(
      diagramSourceProblem("flowchart TD\n" + "A".repeat(10001)),
    ).toContain("too large");
    expect(
      diagramSourceProblem("sequenceDiagram\n" + "A->>B: Hi\n".repeat(201)),
    ).toContain("too large");
    expect(diagramSourceProblem("flowchart LR\nA <--> B")).toBeNull();
  });
  it.each([
    "```mermaid\nflowchart TD\nA-->B\n```",
    "~~~~mermaid\nsequenceDiagram\nA->>B: Hi\n~~~~",
    "> ```mermaid\n> flowchart TD\n> A-->B\n> ```",
  ])("recognizes completed fences without rendering partial streams", (text) =>
    expect(hasClosedDiagramFence(text, 0, text.length)).toBe(true),
  );
  it("does not confuse shorter/mismatched fences or trailing backticks with completion", () => {
    for (const text of [
      "```mermaid\nflowchart TD\nA-->B",
      "~~~~mermaid\nflowchart TD\nA-->B\n~~~",
      "```mermaid\nflowchart TD\nA-->B\n~~~",
      "```mermaid\nflowchart TD\nA[code```]",
    ])
      expect(hasClosedDiagramFence(text, 0, text.length)).toBe(false);
  });
});
