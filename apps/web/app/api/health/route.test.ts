import { describe, expect, it } from "vitest";
import { dynamic, GET, HEAD } from "./route";

describe("public liveness endpoint", () => {
  it("returns an uncached 200 response without credentials or dependencies", async () => {
    const response = GET();
    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("supports HEAD checks with no response body", async () => {
    const response = HEAD();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });
});
