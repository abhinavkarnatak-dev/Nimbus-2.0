export const MAX_DIAGRAM_CHARACTERS = 10_000;
export const MAX_DIAGRAM_LINES = 200;

export function diagramKind(source: string): "flowchart" | "sequence" | null {
  const first =
    source
      .split(/\r?\n/)
      .find((line) => line.trim() && !line.trim().startsWith("%%"))
      ?.trim() ?? "";
  if (/^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/.test(first))
    return "flowchart";
  if (/^sequenceDiagram\b/.test(first)) return "sequence";
  return null;
}

export function diagramSourceProblem(source: string): string | null {
  if (
    source.length > MAX_DIAGRAM_CHARACTERS ||
    source.split(/\r?\n/).length > MAX_DIAGRAM_LINES
  )
    return "This diagram is too large to preview. Its source is available below.";
  if (!diagramKind(source))
    return "Only flowcharts and sequence diagrams are supported. Its source is available below.";
  // Untrusted definitions cannot override app config, register interactions,
  // request external images, or inject HTML/CSS.
  if (
    /%%\s*\{|^\s*---|^\s*(?:click|classDef|style|linkStyle|links?|config)\b|@\{|<\s*\/?[a-z][^>]*>|\b(?:javascript|data):|\burl\s*\(/im.test(
      source,
    )
  )
    return "This diagram contains unsupported styling or interactive content. Its source is available below.";
  return null;
}

export function hasClosedDiagramFence(
  text: string,
  start?: number,
  end?: number,
): boolean {
  if (start === undefined || end === undefined) return false;
  const lines = text.slice(start, end).trimEnd().split(/\r?\n/);
  const opening = lines[0]?.match(
    /^\s*(?:>\s*)*(`{3,}|~{3,})\s*mermaid(?:\s.*)?$/i,
  )?.[1];
  if (!opening || lines.length < 2) return false;
  return new RegExp(
    `^\\s*(?:>\\s*)*${opening[0]}{${opening.length},}\\s*$`,
  ).test(lines.at(-1)!);
}
