import { diagramSourceProblem, MAX_DIAGRAM_CHARACTERS } from "./mermaid-source";

// DOM-dependent dependencies are loaded on demand, in the browser only.
// Serialize jobs because Mermaid maintains shared configuration/render state.
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, string>();
let cacheCharacters = 0;
let nextId = 0;
let nextInstance = 0;
const MAX_CACHED_CHARACTERS = 1_000_000;

// A cached diagram may appear more than once in the same conversation. Scope
// SVG IDs and their references per instance so markers/accessibility don't collide.
function instanceSvg(svg: string): string {
  const prefix = `nimbus-instance-${++nextInstance}-`;
  const ids = new Map(
    [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => [
      match[1]!,
      `${prefix}${match[1]!}`,
    ]),
  );
  return svg
    .replace(/\bid="([^"]+)"/g, (_, id: string) => `id="${ids.get(id) ?? id}"`)
    .replace(
      /url\(#([^)]+)\)/g,
      (_, id: string) => `url(#${ids.get(id) ?? id})`,
    )
    .replace(
      /\b(aria-labelledby|aria-describedby)="([^"]+)"/g,
      (_, name: string, value: string) =>
        `${name}="${value
          .split(/\s+/)
          .map((id) => ids.get(id) ?? id)
          .join(" ")}"`,
    )
    .replace(/<style>([\s\S]*?)<\/style>/g, (_, css: string) => {
      let scoped = css;
      for (const [oldId, newId] of [...ids].sort(
        (a, b) => b[0].length - a[0].length,
      ))
        scoped = scoped.replaceAll(`#${oldId}`, `#${newId}`);
      return `<style>${scoped}</style>`;
    });
}

export function renderDiagram(source: string): Promise<string> {
  const problem = diagramSourceProblem(source);
  if (problem) return Promise.reject(new Error(problem));
  const cached = cache.get(source);
  if (cached) return Promise.resolve(instanceSvg(cached));
  const job = queue
    .catch(() => {})
    .then(async () => {
      const previous = cache.get(source);
      if (previous) return instanceSvg(previous);
      const [{ default: mermaid }, { default: purify }] = await Promise.all([
        import("mermaid"),
        import("dompurify"),
      ]);
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        htmlLabels: false,
        maxTextSize: MAX_DIAGRAM_CHARACTERS,
        maxEdges: 100,
        layout: "dagre",
        theme: "base",
        fontFamily: "Arial, sans-serif",
        themeVariables: {
          primaryColor: "#f1edfc",
          primaryTextColor: "#302847",
          primaryBorderColor: "#927bd2",
          lineColor: "#776393",
          secondaryColor: "#f8f6fc",
          tertiaryColor: "#ffffff",
          background: "#ffffff",
          actorBkg: "#f1edfc",
          actorBorder: "#927bd2",
          actorTextColor: "#302847",
          signalColor: "#776393",
          signalTextColor: "#302847",
        },
        flowchart: { htmlLabels: false, useMaxWidth: true },
        sequence: { useMaxWidth: true },
      });
      const valid = await mermaid.parse(source, { suppressErrors: true });
      if (!valid)
        throw new Error(
          "This diagram could not be rendered. Its source is available below.",
        );
      const { svg } = await mermaid.render(
        `nimbus-diagram-${++nextId}`,
        source,
      );
      if (svg.length > 500_000)
        throw new Error(
          "This diagram is too large to preview. Its source is available below.",
        );
      const clean = purify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ["foreignObject", "script", "image", "a", "iframe", "use"],
        FORBID_ATTR: ["href", "xlink:href"],
      });
      if (!clean.includes("<svg"))
        throw new Error(
          "This diagram could not be rendered. Its source is available below.",
        );
      cache.set(source, clean);
      cacheCharacters += source.length + clean.length;
      while (cache.size > 8 || cacheCharacters > MAX_CACHED_CHARACTERS) {
        const oldest = cache.entries().next().value;
        if (!oldest) break;
        cache.delete(oldest[0]);
        cacheCharacters -= oldest[0].length + oldest[1].length;
      }
      return instanceSvg(clean);
    });
  queue = job;
  return job;
}
