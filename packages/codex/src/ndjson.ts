export type ParsedLine =
  | { kind: "message"; value: Record<string, unknown> }
  | { kind: "invalid"; line: string; error: string };

export class NdjsonParser {
  #buffer = "";
  readonly #decoder = new TextDecoder();
  readonly #maxLineChars: number;

  constructor(maxLineChars = 2_000_000) {
    this.#maxLineChars = maxLineChars;
  }

  push(chunk: Uint8Array | string): ParsedLine[] {
    this.#buffer +=
      typeof chunk === "string"
        ? chunk
        : this.#decoder.decode(chunk, { stream: true });
    if (
      this.#buffer.length > this.#maxLineChars &&
      !this.#buffer.includes("\n")
    ) {
      const line = this.#buffer.slice(0, 2_000);
      this.#buffer = "";
      return [
        {
          kind: "invalid",
          line,
          error: "NDJSON line exceeded the configured size limit",
        },
      ];
    }
    const lines = this.#buffer.split(/\r?\n/);
    this.#buffer = lines.pop() ?? "";
    return lines.flatMap((line) => this.#parse(line));
  }

  finish(): ParsedLine[] {
    const final = this.#buffer + this.#decoder.decode();
    this.#buffer = "";
    return final.trim() === "" ? [] : this.#parse(final);
  }

  #parse(line: string): ParsedLine[] {
    if (line.length > this.#maxLineChars)
      return [
        {
          kind: "invalid",
          line: line.slice(0, 2000),
          error: "NDJSON line exceeded the configured size limit",
        },
      ];
    if (line.trim() === "") return [];
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return [
          {
            kind: "invalid",
            line: line.slice(0, 2_000),
            error: "JSON-RPC message must be an object",
          },
        ];
      }
      return [{ kind: "message", value: value as Record<string, unknown> }];
    } catch (error) {
      return [
        {
          kind: "invalid",
          line: line.slice(0, 2_000),
          error: error instanceof Error ? error.message : "Invalid JSON",
        },
      ];
    }
  }
}
