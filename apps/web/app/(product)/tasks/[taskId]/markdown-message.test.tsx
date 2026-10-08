import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownMessage } from "./markdown-message";
beforeEach(() => vi.stubGlobal("React", React));
const render = (text: string) =>
  renderToStaticMarkup(<MarkdownMessage text={text} taskId="task" />);
describe("Mermaid Markdown integration", () => {
  it("routes a complete Mermaid block to its renderer without altering surrounding text", () => {
    const html = render(
      "Before\n\n```mermaid\nflowchart TD\nA-->B\n```\n\nAfter",
    );
    expect(html).toContain("data-mermaid-diagram");
    expect(html).toContain("Preparing diagram...");
    expect(html).not.toContain("Preview requires a complete diagram block");
    expect(html).toContain("Before");
    expect(html).toContain("After");
  });
  it("defers an unfinished block while streaming without losing its source", () => {
    const html = render("```mermaid\nsequenceDiagram\nA->>B: Hi");
    expect(html).toContain("Preview requires a complete diagram block");
    expect(html).toContain("A-&gt;&gt;B: Hi");
    expect(html).not.toContain("Preparing diagram...");
  });
  it("leaves ASCII trees, explicit text diagrams and ordinary downloadable code alone", () => {
    const html = render(
      "```text\nroot/\n├── src/\n└── README.md\n```\n\n```javascript\nconsole.log('hi');\n```",
    );
    expect(html).not.toContain("data-mermaid-diagram");
    expect(html).toContain("├── src/");
    expect(html).toContain("Download .js");
    expect(html).toContain("Copy code");
  });
  it("preserves safe links and existing HTML blocking around diagrams", () => {
    const html = render(
      "[Readme](src/README.md)\n\n[Website](https://example.com)\n\n<script>alert('x')</script>\n\n```mermaid\npie\nA: 1\n```",
    );
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain("Open src/README.md");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Only flowcharts and sequence diagrams");
    expect(html).toContain("A: 1");
  });
});
