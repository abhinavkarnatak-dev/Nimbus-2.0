import { describe, expect, it } from "vitest";

import { NdjsonParser } from "./ndjson.js";

describe("NdjsonParser", () => {
  it("reassembles partial lines and returns multiple messages", () => {
    const parser = new NdjsonParser();
    expect(parser.push('{"jsonrpc":"2.0","id":')).toEqual([]);
    expect(parser.push('1,"result":{}}\n{"method":"ready"}\n')).toEqual([
      { kind: "message", value: { jsonrpc: "2.0", id: 1, result: {} } },
      { kind: "message", value: { method: "ready" } },
    ]);
  });

  it("reports malformed output without throwing away later messages", () => {
    const parser = new NdjsonParser();
    const result = parser.push('not-json\n{"method":"turn/completed"}\n');
    expect(result[0]?.kind).toBe("invalid");
    expect(result[1]).toEqual({
      kind: "message",
      value: { method: "turn/completed" },
    });
  });

  it("flushes a final line without a newline", () => {
    const parser = new NdjsonParser();
    parser.push('{"method":"final"}');
    expect(parser.finish()).toEqual([
      { kind: "message", value: { method: "final" } },
    ]);
  });
});
