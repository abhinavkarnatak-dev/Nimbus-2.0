function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown, limit = 500): string {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f]/g, " ")
        .trim()
        .slice(0, limit)
    : "";
}
function website(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.replace(/^www\./, "");
    return host === "linkedin.com" || host.endsWith(".linkedin.com")
      ? "LinkedIn"
      : host.slice(0, 100);
  } catch {
    return null;
  }
}
function queryWebsite(query: string): string | null {
  const domain = query.match(/\bsite:([a-z0-9.-]+)(?:\/[^\s]*)?/i)?.[1];
  if (domain) return website(`https://${domain}`);
  const url = query.match(/https?:\/\/[^\s]+/i)?.[0];
  if (url) return website(url);
  return /(?:^|\s)linkedin(?:\s|$)/i.test(query) ? "LinkedIn" : null;
}

// A presentation-only projection of Codex app-server's confirmed webSearch
// items. Never infer a search from the user's prompt or claim results exist.
export function webActivityEvent(method: string, payload: unknown) {
  if (method !== "item/started" && method !== "item/completed") return null;
  const item = record(record(payload).item);
  if (item.type !== "webSearch") return null;
  const action = record(item.action);
  const kind =
    action.type === "openPage" || action.type === "findInPage"
      ? action.type
      : "search";
  const queries = [
    ...new Set(
      [
        text(action.query),
        ...(Array.isArray(action.queries)
          ? action.queries.slice(0, 5).map((query) => text(query))
          : []),
        text(item.query),
      ].filter(Boolean),
    ),
  ].slice(0, 5);
  const url = text(action.url, 1000);
  const sites = [...new Set(queries.map(queryWebsite).filter(Boolean))].slice(
    0,
    3,
  );
  const site = kind === "search" ? sites.join(", ") || null : website(url);
  const running = method === "item/started";
  const failed =
    item.status === "failed" ||
    item.status === "declined" ||
    item.status === "incomplete";
  const verb =
    kind === "search"
      ? running
        ? "Searching"
        : "Searched"
      : kind === "openPage"
        ? running
          ? "Reading"
          : "Read"
        : running
          ? "Finding text on"
          : "Searched within";
  const target = site ?? (kind === "search" ? "the web" : "a web page");
  const title = failed
    ? `Web research failed${site ? ` on ${site}` : ""}`
    : `${verb} ${target}`;
  const details =
    kind === "search"
      ? queries.length
        ? `Search queries:\n${queries.join("\n")}`
        : "Web search requested; query details are not available yet."
      : [
          url && website(url)
            ? `Page: ${url}`
            : "Web page requested; URL details are not available.",
          kind === "findInPage" && text(action.pattern)
            ? `Find: ${text(action.pattern)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
  return {
    title,
    whatWasDone: details.slice(0, 2000),
    status: failed
      ? ("failed" as const)
      : running
        ? ("running" as const)
        : ("succeeded" as const),
    evidence: [
      ...(text(item.id, 250) ? [`codex-item:${text(item.id, 250)}`] : []),
      `web-activity:${kind}`,
    ],
  };
}

export function isWebActivity(event: { evidence?: unknown }): boolean {
  return (
    Array.isArray(event.evidence) &&
    event.evidence.some(
      (value) => typeof value === "string" && value.startsWith("web-activity:"),
    )
  );
}
