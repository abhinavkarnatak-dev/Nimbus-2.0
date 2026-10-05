import { generateKeyPairSync, createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { GitHubAppClient, createGitHubAppJwt } from "./app-client.js";
import { loadGitHubAppConfig } from "./config.js";
import { verifyGitHubWebhookSignature } from "./webhooks.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const config = {
  appId: "12345",
  slug: "nimbus-test",
  clientId: "Iv1.test",
  clientSecret: "secret",
  privateKey,
  webhookSecret: "webhook-secret",
};

describe("GitHub App security primitives", () => {
  it("rejects an installation that is absent from the user's authorized list", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ installations: [] }));
    const client = new GitHubAppClient(config, fetchMock);
    await expect(client.getUserInstallation("user-token", 123)).rejects.toThrow(
      "not accessible to this user",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/user/installations?per_page=100&page=1",
      expect.any(Object),
    );
  });

  it("accepts only an installation confirmed by the user's authorized list", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        installations: [
          {
            id: 123,
            account: { id: 456, login: "test-owner", type: "User" },
            repository_selection: "selected",
            suspended_at: null,
          },
        ],
      }),
    );
    const client = new GitHubAppClient(config, fetchMock);
    await expect(
      client.getUserInstallation("user-token", 123),
    ).resolves.toMatchObject({
      id: 123,
      account: { login: "test-owner" },
    });
  });

  it("loads a base64 encoded private key without accepting missing values", () => {
    expect(
      loadGitHubAppConfig({
        GITHUB_APP_ID: config.appId,
        GITHUB_APP_SLUG: config.slug,
        GITHUB_APP_CLIENT_ID: config.clientId,
        GITHUB_APP_CLIENT_SECRET: config.clientSecret,
        GITHUB_APP_PRIVATE_KEY_BASE64:
          Buffer.from(privateKey).toString("base64"),
        GITHUB_APP_WEBHOOK_SECRET: config.webhookSecret,
      }),
    ).toEqual(config);
    expect(() => loadGitHubAppConfig({})).toThrow("GITHUB_APP_ID is required");
  });

  it("creates a short-lived RS256 app JWT", async () => {
    const token = createGitHubAppJwt(config.appId, privateKey, 1_800_000_000);
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toEqual({
      iat: 1_799_999_940,
      exp: 1_800_000_540,
      iss: "12345",
    });
    const { verify } = await import("node:crypto");
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  it("checks webhook signatures using the raw request body", () => {
    const body = '{"action":"created"}';
    const signature = `sha256=${createHmac("sha256", config.webhookSecret)
      .update(body)
      .digest("hex")}`;
    expect(
      verifyGitHubWebhookSignature(body, signature, config.webhookSecret),
    ).toBe(true);
    expect(
      verifyGitHubWebhookSignature(`${body}x`, signature, config.webhookSecret),
    ).toBe(false);
  });

  it("exchanges a user code without exposing the client secret in an error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "user-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new GitHubAppClient(config, fetchMock);
    await expect(client.exchangeUserCode("one-time-code")).resolves.toBe(
      "user-token",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
