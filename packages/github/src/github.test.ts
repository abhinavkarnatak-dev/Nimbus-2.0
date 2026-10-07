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
  it("uses scoped read-only credentials for repository context without changing coding permissions", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ token: "scoped", expires_at: "later" }),
      );
    const client = new GitHubAppClient(config, transport);
    await client.createInstallationToken(7, [42], "read");
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({
      repository_ids: [42],
      permissions: { contents: "read" },
    });
    await client.createInstallationToken(7, [42]);
    expect(JSON.parse(String(transport.mock.calls[1][1]?.body))).toMatchObject({
      permissions: { contents: "write", pull_requests: "write" },
    });
  });
  it("reads commit-pinned text and encodes branch and path segments", async () => {
    const revision = "a".repeat(40);
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ object: { sha: revision } }))
      .mockResolvedValueOnce(
        Response.json({
          type: "file",
          encoding: "base64",
          size: 5,
          content: Buffer.from("hello").toString("base64"),
        }),
      );
    const client = new GitHubAppClient(config, transport);
    expect(
      await client.readRepositoryRef("token", "owner", "repo", "feature/demo"),
    ).toBe(revision);
    expect(
      await client.readRepositoryContents(
        "token",
        "owner",
        "repo",
        revision,
        "src/a b.ts",
      ),
    ).toEqual({ content: "hello" });
    expect(String(transport.mock.calls[0][0])).toContain(
      "heads/feature%2Fdemo",
    );
    expect(String(transport.mock.calls[1][0])).toContain(
      `contents/src/a%20b.ts?ref=${revision}`,
    );
  });
  it.each([
    { type: "symlink", encoding: "base64", content: "YQ==" },
    {
      type: "file",
      submodule_git_url: "https://external.invalid",
      encoding: "base64",
      content: "YQ==",
    },
    { type: "file", encoding: "base64", content: "AA==" },
    { type: "file", encoding: "base64", size: 64001, content: "YQ==" },
    { type: "file", encoding: "base64", content: "/w==" },
  ])(
    "rejects binary, oversized, invalid UTF-8 and linked content: %j",
    async (value) => {
      const client = new GitHubAppClient(
        config,
        vi.fn<typeof fetch>().mockResolvedValue(Response.json(value)),
      );
      await expect(
        client.readRepositoryContents(
          "token",
          "owner",
          "repo",
          "a".repeat(40),
          "file",
        ),
      ).rejects.toThrow();
    },
  );
  it("authenticates public repository validation and verifies its stored identity", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: 42,
        full_name: "owner/repo",
        private: false,
        visibility: "public",
      }),
    );
    const client = new GitHubAppClient(config, transport);
    await client.verifyPublicRepository(
      "scoped-installation-token",
      "owner",
      "repo",
      42,
    );
    expect(transport.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      headers: { authorization: "Bearer scoped-installation-token" },
    });
    await expect(
      client.verifyPublicRepository("token", "owner", "repo", 99),
    ).rejects.toThrow("identity");
  });
  it("rejects private repositories and distinguishes rate limits without exposing provider bodies", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          id: 42,
          full_name: "owner/repo",
          private: true,
          visibility: "private",
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { message: "private-token-secret" },
          { status: 403, headers: { "x-ratelimit-remaining": "0" } },
        ),
      );
    const client = new GitHubAppClient(config, transport);
    await expect(
      client.verifyPublicRepository("token", "owner", "repo", 42),
    ).rejects.toThrow("private");
    await expect(
      client.verifyPublicRepository("token", "owner", "repo", 42),
    ).rejects.toThrow("rate limit");
  });
  it("reads fresh merged state for a verified session PR and rejects another branch", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...pr,
        state: "closed",
        merged_at: "2026-10-06T00:00:00Z",
      }),
    );
    const client = new GitHubAppClient(config, fetchMock);
    await expect(
      client.sessionPullRequestState(
        "token",
        "test-owner",
        "test-repo",
        16,
        "nimbus/task_test",
        "main",
      ),
    ).resolves.toMatchObject({ state: "merged", headSha: sha });
    await expect(
      client.sessionPullRequestState(
        "token",
        "test-owner",
        "test-repo",
        16,
        "other",
        "main",
      ),
    ).rejects.toThrow("does not belong");
  });
  it("fetches the real PR title, line totals and file paths for the published commit", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ...pr,
          title: "Add greeting",
          additions: 2,
          deletions: 1,
          changed_files: 1,
        }),
      )
      .mockResolvedValueOnce(
        Response.json([{ filename: "hello.py", additions: 2, deletions: 1 }]),
      );
    const result = await new GitHubAppClient(
      config,
      fetchMock,
    ).pullRequestSummary(
      "token",
      "test-owner",
      "test-repo",
      16,
      "nimbus/task_test",
      "main",
      sha,
    );
    expect(result).toMatchObject({
      title: "Add greeting",
      additions: 2,
      deletions: 1,
      changedFiles: 1,
      files: [{ path: "hello.py", additions: 2, deletions: 1 }],
    });
  });
  it("waits for GitHub to confirm an updated PR head without writing again", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(pr))
        .mockResolvedValueOnce(
          Response.json({ ...pr, head: { ...pr.head, sha: "b".repeat(40) } }),
        );
      const pending = new GitHubAppClient(
        config,
        fetchMock,
      ).confirmPullRequestHead(
        "token",
        "test-owner",
        "test-repo",
        16,
        "nimbus/task_test",
        "main",
        "b".repeat(40),
      );
      await vi.runAllTimersAsync();
      await pending;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        fetchMock.mock.calls.every(
          (call) => !call[1]?.method || call[1]?.method === "GET",
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("reads all feedback kinds with pagination and preserves inline context", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = String(url);
      if (!path.includes("?")) return Response.json(pr);
      if (
        path.includes("issues/16/comments") &&
        new URL(path).searchParams.get("page") === "1"
      )
        return Response.json(
          Array.from({ length: 100 }, (_, id) => ({
            id,
            body: "Discussion",
            user: { login: "reviewer" },
          })),
        );
      if (new URL(path).searchParams.get("page") === "2")
        return Response.json([{ id: 101, body: "Last comment" }]);
      if (path.includes("pulls/16/comments"))
        return Response.json([
          {
            id: 201,
            body: "Fix this",
            path: "hello.py",
            line: 2,
            diff_hunk: "@@ -1 +1 @@",
            user: { login: "reviewer" },
          },
        ]);
      return Response.json([
        { id: 301, body: "Please revise", state: "CHANGES_REQUESTED" },
      ]);
    });
    const result = await new GitHubAppClient(
      config,
      fetchMock,
    ).readPullRequestFeedback(
      "token",
      "test-owner",
      "test-repo",
      16,
      "nimbus/task_test",
      "main",
    );
    expect(result.comments).toHaveLength(101);
    expect(result.reviewComments[0]).toMatchObject({
      path: "hello.py",
      line: 2,
      diffHunk: "@@ -1 +1 @@",
    });
    expect(result.reviews[0]).toMatchObject({ state: "CHANGES_REQUESTED" });
  });
  it("rejects feedback from another session branch before reading comments", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(pr));
    await expect(
      new GitHubAppClient(config, fetchMock).readPullRequestFeedback(
        "token",
        "test-owner",
        "test-repo",
        16,
        "other",
        "main",
      ),
    ).rejects.toThrow("does not belong");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("fails closed on malformed feedback lists", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        Response.json(String(url).includes("?") ? { error: "not a list" } : pr),
      );
    await expect(
      new GitHubAppClient(config, fetchMock).readPullRequestFeedback(
        "token",
        "test-owner",
        "test-repo",
        16,
        "nimbus/task_test",
        "main",
      ),
    ).rejects.toThrow("Invalid GitHub feedback response");
  });
  const sha = "a".repeat(40);
  const pr = {
    state: "open",
    merged_at: null,
    head: {
      ref: "nimbus/task_test",
      sha,
      repo: { full_name: "test-owner/test-repo" },
    },
    base: { ref: "main" },
  };
  it("closes a verified session PR without merging", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(pr))
      .mockResolvedValueOnce(Response.json({ state: "closed" }));
    await expect(
      new GitHubAppClient(config, fetchMock).managePullRequest(
        "token",
        "test-owner",
        "test-repo",
        14,
        {
          action: "close",
          branch: "nimbus/task_test",
          base: "main",
          expectedHeadSha: sha,
        },
      ),
    ).resolves.toEqual({ state: "closed" });
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ state: "closed" }),
    });
  });
  it("merges only the reviewed head SHA with the selected merge strategy", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(pr))
      .mockResolvedValueOnce(Response.json({ merged: true }));
    await expect(
      new GitHubAppClient(config, fetchMock).managePullRequest(
        "token",
        "test-owner",
        "test-repo",
        14,
        {
          action: "merge",
          branch: "nimbus/task_test",
          base: "main",
          expectedHeadSha: sha,
          mergeMethod: "squash",
        },
      ),
    ).resolves.toEqual({ state: "merged" });
    expect(fetchMock.mock.calls[1]).toEqual([
      "https://api.github.com/repos/test-owner/test-repo/pulls/14/merge",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ sha, merge_method: "squash" }),
      }),
    ]);
  });
  it("rejects a changed head before attempting merge", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(pr));
    await expect(
      new GitHubAppClient(config, fetchMock).managePullRequest(
        "token",
        "test-owner",
        "test-repo",
        14,
        {
          action: "merge",
          branch: "nimbus/task_test",
          base: "main",
          expectedHeadSha: "b".repeat(40),
        },
      ),
    ).rejects.toThrow("changed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("respects GitHub branch protection failures rather than claiming a merge", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(pr))
      .mockResolvedValueOnce(
        Response.json(
          { message: "Required checks have not passed" },
          { status: 405 },
        ),
      );
    await expect(
      new GitHubAppClient(config, fetchMock).managePullRequest(
        "token",
        "test-owner",
        "test-repo",
        14,
        {
          action: "merge",
          branch: "nimbus/task_test",
          base: "main",
          expectedHeadSha: sha,
        },
      ),
    ).rejects.toThrow("Required checks");
  });
  it("denies actions on another branch", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(pr));
    await expect(
      new GitHubAppClient(config, fetchMock).managePullRequest(
        "token",
        "test-owner",
        "test-repo",
        14,
        {
          action: "close",
          branch: "nimbus/other",
          base: "main",
          expectedHeadSha: sha,
        },
      ),
    ).rejects.toThrow("session's branch");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("recovers merge retries after a lost successful response without a second write", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...pr,
        state: "closed",
        merged_at: "2026-10-06T05:00:00Z",
      }),
    );
    await expect(
      new GitHubAppClient(config, fetchMock).managePullRequest(
        "token",
        "test-owner",
        "test-repo",
        14,
        {
          action: "merge",
          branch: "nimbus/task_test",
          base: "main",
          expectedHeadSha: sha,
        },
      ),
    ).resolves.toEqual({ state: "merged" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("creates PRs with the installation token, without GitHub CLI", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({
          number: 14,
          html_url: "https://github.com/test-owner/test-repo/pull/14",
          state: "open",
          head: { sha: "abc" },
        }),
      );
    const client = new GitHubAppClient(config, fetchMock);
    const input = {
      head: "nimbus/task_test",
      base: "main",
      title: "Organize files",
      body: "Summary",
    };
    await expect(
      client.ensurePullRequest(
        "installation-token",
        "test-owner",
        "test-repo",
        input,
      ),
    ).resolves.toMatchObject({ number: 14, headSha: "abc" });
    expect(fetchMock.mock.calls[1]).toEqual([
      "https://api.github.com/repos/test-owner/test-repo/pulls",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
        headers: expect.objectContaining({
          authorization: "Bearer installation-token",
        }),
      }),
    ]);
  });
  it("recovers a previously created PR instead of creating a duplicate", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([
        {
          number: 14,
          html_url: "https://github.com/test-owner/test-repo/pull/14",
          state: "open",
          head: { ref: "nimbus/task_test", sha: "abc" },
          base: { ref: "main" },
        },
      ]),
    );
    await expect(
      new GitHubAppClient(config, fetchMock).ensurePullRequest(
        "token",
        "test-owner",
        "test-repo",
        { head: "nimbus/task_test", base: "main", title: "Organize", body: "" },
      ),
    ).resolves.toMatchObject({ number: 14 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not turn a malformed PR listing into permission to create another PR", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ message: "bad listing" }));
    await expect(
      new GitHubAppClient(config, fetchMock).ensurePullRequest(
        "token",
        "test-owner",
        "test-repo",
        { head: "nimbus/task_test", base: "main", title: "Organize", body: "" },
      ),
    ).rejects.toThrow("listing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed repository snapshots rather than interpreting them as revoked access", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "short-lived-test",
            expires_at: "2026-10-07T00:00:00Z",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "invalid listing" })),
      );
    const client = new GitHubAppClient(config, fetchMock);
    await expect(client.listInstallationRepositories(123)).rejects.toThrow(
      "listing was malformed",
    );
  });
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
