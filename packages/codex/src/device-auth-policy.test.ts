import { describe, expect, it } from "vitest";
import {
  deviceMutationAllowed,
  deviceRequestAllowed,
} from "./device-auth-policy.js";

const environment = {
  NODE_ENV: "production",
  NIMBUS_DEVICE_AUTH_ENABLED: "true",
  AUTH_URL: "https://nimbus.example",
};
const request = (headers: Record<string, string> = {}) =>
  new Request("https://nimbus.example/api/codex/device", {
    headers: {
      host: "nimbus.example",
      origin: "https://nimbus.example",
      ...headers,
    },
  });
describe("server device-auth boundaries", () => {
  it("requires operator opt-in and the registered host", () => {
    expect(
      deviceRequestAllowed(request(), {
        ...environment,
        NIMBUS_DEVICE_AUTH_ENABLED: "false",
      }),
    ).toBe(false);
    expect(deviceRequestAllowed(request(), environment)).toBe(true);
    expect(
      deviceRequestAllowed(request({ host: "evil.example" }), environment),
    ).toBe(false);
    expect(
      deviceRequestAllowed(
        request({ "x-forwarded-host": "evil.example" }),
        environment,
      ),
    ).toBe(false);
    expect(
      deviceRequestAllowed(request(), {
        ...environment,
        AUTH_URL: "http://nimbus.example",
      }),
    ).toBe(false);
  });
  it("rejects cross-origin, missing-origin, and scheme-downgraded mutations", () => {
    expect(deviceMutationAllowed(request(), environment)).toBe(true);
    for (const origin of ["https://evil.example", "", "http://nimbus.example"])
      expect(deviceMutationAllowed(request({ origin }), environment)).toBe(
        false,
      );
  });
});
