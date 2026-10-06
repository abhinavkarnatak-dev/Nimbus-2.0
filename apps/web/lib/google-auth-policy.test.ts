import { afterEach, describe, expect, it, vi } from "vitest";
import {
  workspaceName,
  googleAuthConfigured,
  googleAuthOrigin,
  verifiedGoogleIdentity,
} from "./google-auth-policy";

afterEach(() => vi.unstubAllEnvs());
describe("Google authentication policy", () => {
  it("names workspaces using only the first name", () => {
    expect(workspaceName("Abhinav Karnatak")).toBe("Abhinav's workspace");
    expect(workspaceName("  Ada   Lovelace  ")).toBe("Ada's workspace");
    expect(workspaceName("Luna")).toBe("Luna's workspace");
    expect(workspaceName(" ")).toBe("Your workspace");
  });
  it("requires complete server-side configuration", () => {
    vi.stubEnv("AUTH_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_SECRET", "test-secret-with-at-least-32-characters");
    vi.stubEnv("AUTH_GOOGLE_ID", "test-client");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "test-only-secret");
    expect(googleAuthConfigured()).toBe(true);
    vi.stubEnv("AUTH_GOOGLE_SECRET", "");
    expect(googleAuthConfigured()).toBe(false);
  });
  it("rejects unsafe origins and production HTTP", () => {
    for (const origin of [
      "http://evil.test",
      "https://user:password@example.test",
      "https://example.test/path",
      "https://example.test?callback=evil",
    ]) {
      vi.stubEnv("AUTH_URL", origin);
      expect(googleAuthOrigin()).toBeNull();
    }
    vi.stubEnv("AUTH_URL", "http://localhost:3000");
    vi.stubEnv("NODE_ENV", "production");
    expect(googleAuthOrigin()).toBeNull();
    vi.stubEnv("AUTH_URL", "https://nimbus.example.test");
    expect(googleAuthOrigin()).toBe("https://nimbus.example.test");
  });
  it("accepts only verified Google identities", () => {
    expect(
      verifiedGoogleIdentity({
        sub: "123",
        email: "USER@example.test",
        email_verified: true,
      }).email,
    ).toBe("user@example.test");
    for (const profile of [
      null,
      {},
      { sub: "123", email: "user@example.test", email_verified: false },
      { sub: "", email: "user@example.test", email_verified: true },
    ])
      expect(() => verifiedGoogleIdentity(profile)).toThrow();
  });
});
