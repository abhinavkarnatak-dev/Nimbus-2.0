import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
  sanitize: vi.fn(),
}));
vi.mock("mermaid", () => ({
  default: {
    initialize: fixture.initialize,
    parse: fixture.parse,
    render: fixture.render,
  },
}));
vi.mock("dompurify", () => ({ default: { sanitize: fixture.sanitize } }));
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  fixture.parse.mockResolvedValue({ diagramType: "flowchart" });
  fixture.render.mockResolvedValue({ svg: "<svg><path/></svg>" });
  fixture.sanitize.mockReturnValue("<svg><path/></svg>");
});
describe("bounded browser diagram rendering", () => {
  it("gives repeated cached diagrams distinct SVG IDs and local references", async () => {
    fixture.sanitize.mockReturnValue(
      '<svg id="graph" aria-labelledby="title"><style>#graph .node{fill:#fff}</style><title id="title">Example</title><marker id="arrow"/><path marker-end="url(#arrow)"/></svg>',
    );
    const { renderDiagram } = await import("./mermaid-renderer.js");
    const a = await renderDiagram("flowchart TD\nA-->B");
    const b = await renderDiagram("flowchart TD\nA-->B");
    expect(a).not.toBe(b);
    expect(a).toContain('aria-labelledby="nimbus-instance-1-title"');
    expect(a).toContain("url(#nimbus-instance-1-arrow)");
    expect(b).toContain("#nimbus-instance-2-graph .node");
    expect(fixture.render).toHaveBeenCalledOnce();
  });
  it("uses strict app-owned configuration, sanitizes SVG and caches repeated source", async () => {
    const { renderDiagram } = await import("./mermaid-renderer.js");
    const source = "flowchart TD\nA-->B";
    await Promise.all([renderDiagram(source), renderDiagram(source)]);
    expect(fixture.render).toHaveBeenCalledOnce();
    expect(fixture.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        startOnLoad: false,
        htmlLabels: false,
        maxEdges: 100,
      }),
    );
    expect(fixture.sanitize).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        FORBID_TAGS: expect.arrayContaining([
          "foreignObject",
          "image",
          "script",
        ]),
      }),
    );
  });
  it("rejects unsupported/unsafe source before loading or invoking Mermaid", async () => {
    const { renderDiagram } = await import("./mermaid-renderer.js");
    await expect(renderDiagram("pie\nA:1")).rejects.toThrow("Only flowcharts");
    await expect(
      renderDiagram("flowchart TD\nclick A callback"),
    ).rejects.toThrow("unsupported");
    expect(fixture.render).not.toHaveBeenCalled();
    expect(fixture.initialize).not.toHaveBeenCalled();
  });
  it("recovers the render queue after malformed syntax without caching failures", async () => {
    const { renderDiagram } = await import("./mermaid-renderer.js");
    fixture.parse.mockResolvedValueOnce(false);
    await expect(renderDiagram("flowchart TD\ninvalid[")).rejects.toThrow(
      "could not be rendered",
    );
    await expect(
      renderDiagram("sequenceDiagram\nA->>B: Hello"),
    ).resolves.toContain("<svg");
    expect(fixture.render).toHaveBeenCalledOnce();
  });
  it("bounds rendered output and cache size", async () => {
    const { renderDiagram } = await import("./mermaid-renderer.js");
    fixture.render.mockResolvedValueOnce({ svg: "x".repeat(500001) });
    await expect(renderDiagram("flowchart TD\nA-->B")).rejects.toThrow(
      "too large",
    );
    for (let index = 0; index < 9; index++)
      await renderDiagram(`flowchart TD\nA-->B${index}`);
    const before = fixture.render.mock.calls.length;
    await renderDiagram("flowchart TD\nA-->B0");
    expect(fixture.render.mock.calls.length).toBe(before + 1);
  });
});
