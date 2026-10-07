import { createSign } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type { GitHubAppConfig } from "./config.js";

const API_VERSION = "2026-03-10";

export interface GitHubInstallation {
  id: number;
  account: {
    id: number;
    login: string;
    type: string;
  };
  repositorySelection: "all" | "selected";
  suspendedAt: string | null;
}

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
  owner: string;
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
}

type Fetch = typeof fetch;

export class GitHubAppClient {
  readonly #config: GitHubAppConfig;
  readonly #fetch: Fetch;

  constructor(config: GitHubAppConfig, fetchImplementation: Fetch = fetch) {
    this.#config = config;
    this.#fetch = fetchImplementation;
  }

  installationUrl(state: string): string {
    const url = new URL(
      `https://github.com/apps/${encodeURIComponent(this.#config.slug)}/installations/new`,
    );
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeUserCode(code: string, redirectUri?: string): Promise<string> {
    const response = await this.#fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          client_id: this.#config.clientId,
          client_secret: this.#config.clientSecret,
          code,
          ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        }),
      },
    );
    const payload = await readJson(response);
    const token = stringField(payload, "access_token");
    if (!response.ok || !token) {
      throw githubError("GitHub user authorization failed", response, payload);
    }
    return token;
  }

  async getUserInstallation(
    userAccessToken: string,
    installationId: number,
  ): Promise<GitHubInstallation> {
    if (!Number.isSafeInteger(installationId) || installationId <= 0)
      throw new Error("Invalid GitHub installation ID");
    for (let page = 1; page <= 100; page += 1) {
      const response = await this.#api(
        `/user/installations?per_page=100&page=${page}`,
        userAccessToken,
      );
      if (!Array.isArray(response.installations))
        throw new Error("GitHub user installations response was malformed");
      const match = response.installations.find(
        (entry: unknown) => asRecord(entry).id === installationId,
      );
      if (match) return parseInstallation(asRecord(match));
      if (response.installations.length < 100)
        throw new Error("GitHub installation is not accessible to this user");
    }
    throw new Error("GitHub installation pagination exceeded the safety limit");
  }

  async listUserInstallations(
    userAccessToken: string,
  ): Promise<GitHubInstallation[]> {
    const installations: GitHubInstallation[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const response = await this.#api(
        `/user/installations?per_page=100&page=${page}`,
        userAccessToken,
      );
      if (!Array.isArray(response.installations))
        throw new Error("GitHub user installations response was malformed");
      installations.push(
        ...response.installations.map((entry: unknown) =>
          parseInstallation(asRecord(entry)),
        ),
      );
      if (response.installations.length < 100) return installations;
    }
    throw new Error("GitHub installation pagination exceeded the safety limit");
  }

  async listUserRepositories(
    userAccessToken: string,
    installationId: number,
  ): Promise<GitHubRepository[]> {
    const repositories: GitHubRepository[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const response = await this.#api(
        `/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
        userAccessToken,
      );
      if (!Array.isArray(response.repositories))
        throw new Error("GitHub repository response was malformed");
      repositories.push(...response.repositories.map(parseRepository));
      if (response.repositories.length < 100) return repositories;
    }
    throw new Error("GitHub repository pagination exceeded the safety limit");
  }

  async getInstallation(installationId: number): Promise<GitHubInstallation> {
    const response = await this.#api(
      `/app/installations/${installationId}`,
      createGitHubAppJwt(this.#config.appId, this.#config.privateKey),
    );
    return parseInstallation(response);
  }

  async createInstallationToken(
    installationId: number,
    repositoryIds?: number[],
    access: "read" | "write" = "write",
  ): Promise<InstallationToken> {
    const response = await this.#api(
      `/app/installations/${installationId}/access_tokens`,
      createGitHubAppJwt(this.#config.appId, this.#config.privateKey),
      {
        method: "POST",
        body: JSON.stringify({
          ...(repositoryIds ? { repository_ids: repositoryIds } : {}),
          permissions:
            access === "read"
              ? { contents: "read" }
              : {
                  checks: "read",
                  contents: "write",
                  pull_requests: "write",
                },
        }),
      },
    );
    const token = stringField(response, "token");
    const expiresAt = stringField(response, "expires_at");
    if (!token || !expiresAt)
      throw new Error("GitHub installation token response was malformed");
    return { token, expiresAt };
  }

  async readRepositoryRef(
    token: string,
    owner: string,
    name: string,
    branch: string,
  ) {
    const result = await this.#api(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/ref/heads/${encodeURIComponent(branch)}`,
      token,
    );
    const sha = asRecord(result.object).sha;
    if (typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha))
      throw new Error("Repository revision is unavailable");
    return sha;
  }

  async readRepositoryContents(
    token: string,
    owner: string,
    name: string,
    sha: string,
    path: string,
  ) {
    if (!/^[a-f0-9]{40}$/.test(sha))
      throw new Error("Invalid repository revision");
    const result = await this.#requestJson(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`,
      token,
    );
    if (Array.isArray(result)) {
      if (result.length > 1000)
        throw new Error("Directory is too large to display");
      return {
        entries: result
          .map((value: unknown) => {
            const row = asRecord(value);
            if (typeof row.name !== "string" || typeof row.path !== "string")
              throw new Error("Invalid repository directory");
            return {
              name: row.name,
              path: row.path,
              kind:
                row.type === "dir"
                  ? "directory"
                  : row.type === "file" && !row.submodule_git_url
                    ? "file"
                    : "link",
            };
          })
          .filter((row) => row.name.toLowerCase() !== ".git"),
      };
    }
    const file = asRecord(result);
    if (
      file.type !== "file" ||
      file.submodule_git_url ||
      file.encoding !== "base64" ||
      typeof file.content !== "string"
    )
      throw new Error("Choose a regular text file");
    if (Number(file.size) > 64_000 || file.content.length > 90_000)
      throw new Error("File exceeds the 64 KB preview limit");
    const bytes = Buffer.from(file.content, "base64");
    if (bytes.length > 64_000 || bytes.includes(0))
      throw new Error("File is too large or binary");
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { content };
  }

  async verifyPublicRepository(
    token: string,
    owner: string,
    name: string,
    expectedId: number,
  ) {
    if (
      ![owner, name].every((value) => /^[a-zA-Z0-9_.-]+$/.test(value)) ||
      !Number.isSafeInteger(expectedId) ||
      expectedId < 1
    )
      throw new Error("Invalid GitHub repository identity");
    const value = await this.#api(`/repos/${owner}/${name}`, token);
    if (
      value.id !== expectedId ||
      String(value.full_name).toLowerCase() !== `${owner}/${name}`.toLowerCase()
    )
      throw new Error(
        "Repository identity changed. Refresh repositories before retrying.",
      );
    if (value.private !== false || value.visibility !== "public")
      throw new Error(
        "This repository is private. Only public repository sandboxes are currently supported.",
      );
    if (value.archived === true)
      throw new Error("This GitHub repository is archived.");
  }

  async listInstallationRepositories(
    installationId: number,
  ): Promise<GitHubRepository[]> {
    const { token } = await this.createInstallationToken(installationId);
    const repositories: GitHubRepository[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const response = await this.#api(
        `/installation/repositories?per_page=100&page=${page}`,
        token,
      );
      if (!Array.isArray(response.repositories))
        throw new Error("GitHub repository listing was malformed");
      const entries = response.repositories;
      repositories.push(...entries.map(parseRepository));
      if (entries.length < 100) return repositories;
    }
    throw new Error("GitHub repository pagination exceeded the safety limit");
  }

  async ensurePullRequest(
    token: string,
    owner: string,
    repository: string,
    input: { head: string; base: string; title: string; body: string },
  ) {
    const match = await this.findSessionPullRequest(
      token,
      owner,
      repository,
      input.head,
      input.base,
    );
    const path = `/repos/${owner}/${repository}/pulls`;
    const result =
      match ??
      (await this.#api(path, token, {
        method: "POST",
        body: JSON.stringify(input),
      }));
    const number = numberField(result, "number");
    const url = stringField(result, "html_url");
    if (
      !number ||
      !url?.startsWith(`https://github.com/${owner}/${repository}/pull/`)
    )
      throw new Error("GitHub pull request response was malformed");
    if (result.state !== "open")
      throw new Error("GitHub did not confirm an open pull request");
    return {
      number,
      url,
      state: "open",
      headSha: stringField(asRecord(result.head), "sha"),
    };
  }

  async findSessionPullRequest(
    token: string,
    owner: string,
    repository: string,
    head: string,
    base: string,
  ) {
    if (![owner, repository].every((part) => /^[a-zA-Z0-9_.-]+$/.test(part)))
      throw new Error("Invalid repository name");
    const path = `/repos/${owner}/${repository}/pulls`;
    const existing = await this.#requestJson(
      `${path}?state=all&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}&per_page=100`,
      token,
    );
    if (!Array.isArray(existing))
      throw new Error("GitHub pull request listing was malformed");
    const rows = existing;
    const match = rows.find(
      (row) =>
        asRecord(asRecord(row).head).ref === head &&
        asRecord(asRecord(row).base).ref === base,
    );
    if (match && asRecord(match).state !== "open")
      throw new Error(
        "This session's pull request is closed. Start a new session for a new PR.",
      );
    return match ? asRecord(match) : null;
  }

  async sessionPullRequestState(
    token: string,
    owner: string,
    repository: string,
    number: number,
    branch: string,
    base: string,
  ) {
    if (
      ![owner, repository].every((part) => /^[\w.-]+$/.test(part)) ||
      !Number.isSafeInteger(number) ||
      number < 1
    )
      throw new Error("Invalid PR target");
    const pr = await this.#api(
      `/repos/${owner}/${repository}/pulls/${number}`,
      token,
    );
    const head = asRecord(pr.head);
    if (
      head.ref !== branch ||
      asRecord(pr.base).ref !== base ||
      asRecord(head.repo).full_name !== `${owner}/${repository}`
    )
      throw new Error("PR does not belong to this session");
    if (pr.state !== "open" && pr.state !== "closed")
      throw new Error("Invalid PR state");
    return {
      state: pr.merged_at ? "merged" : pr.state,
      headSha: stringField(head, "sha"),
    };
  }

  async pullRequestSummary(
    token: string,
    owner: string,
    repository: string,
    number: number,
    branch: string,
    base: string,
    expectedSha: string,
  ) {
    if (
      ![owner, repository].every((part) => /^[\w.-]+$/.test(part)) ||
      !Number.isSafeInteger(number) ||
      number < 1
    )
      throw new Error("Invalid PR summary target");
    const path = `/repos/${owner}/${repository}/pulls/${number}`;
    const pr = await this.#api(path, token);
    const head = asRecord(pr.head);
    if (
      head.ref !== branch ||
      head.sha !== expectedSha ||
      asRecord(pr.base).ref !== base ||
      asRecord(head.repo).full_name !== `${owner}/${repository}`
    )
      throw new Error("PR summary commit does not match this session");
    const count = (value: unknown) => {
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0
      )
        throw new Error("Invalid PR change statistics");
      return value;
    };
    const files: { path: string; additions: number; deletions: number }[] = [];
    for (let page = 1; page <= 6; page++) {
      const result = await this.#requestJson(
        `${path}/files?per_page=100&page=${page}`,
        token,
      );
      if (!Array.isArray(result)) throw new Error("Invalid PR file listing");
      for (const value of result) {
        const item = asRecord(value);
        if (typeof item.filename !== "string")
          throw new Error("Invalid PR filename");
        files.push({
          path: item.filename,
          additions: count(item.additions),
          deletions: count(item.deletions),
        });
      }
      if (result.length < 100) break;
      if (page === 6) throw new Error("PR file listing exceeds the safe limit");
    }
    if (
      files.length !== count(pr.changed_files) ||
      typeof pr.title !== "string"
    )
      throw new Error("PR summary is not yet consistent");
    return {
      title: pr.title,
      repository: `${owner}/${repository}`,
      number,
      url: `https://github.com/${owner}/${repository}/pull/${number}`,
      additions: count(pr.additions),
      deletions: count(pr.deletions),
      changedFiles: files.length,
      files,
    };
  }

  async confirmPullRequestHead(
    token: string,
    owner: string,
    repository: string,
    number: number,
    branch: string,
    base: string,
    expectedSha: string,
    signal?: AbortSignal,
  ) {
    if (
      ![owner, repository].every((part) => /^[\w.-]+$/.test(part)) ||
      !Number.isSafeInteger(number) ||
      number < 1 ||
      !/^[a-f0-9]{40}$/.test(expectedSha)
    )
      throw new Error("Invalid PR confirmation target");
    for (let attempt = 0; attempt < 6; attempt++) {
      signal?.throwIfAborted();
      const pr = await this.#api(
        `/repos/${owner}/${repository}/pulls/${number}`,
        token,
      );
      const head = asRecord(pr.head);
      if (
        pr.state !== "open" ||
        pr.merged_at ||
        head.ref !== branch ||
        asRecord(pr.base).ref !== base ||
        asRecord(head.repo).full_name !== `${owner}/${repository}`
      )
        throw new Error("Pull request is no longer this session's open PR");
      if (head.sha === expectedSha) return;
      if (attempt < 5) await delay(1000, undefined, signal ? { signal } : {});
    }
    throw new Error(
      "GitHub has not confirmed the published commit yet. Retry updating the PR.",
    );
  }

  async readPullRequestFeedback(
    token: string,
    owner: string,
    repository: string,
    number: number,
    branch: string,
    base: string,
  ) {
    if (
      !/^[\w.-]+$/.test(owner) ||
      !/^[\w.-]+$/.test(repository) ||
      !Number.isSafeInteger(number) ||
      number < 1
    )
      throw new Error("Invalid pull request target");
    const path = `/repos/${owner}/${repository}`;
    const pr = await this.#api(`${path}/pulls/${number}`, token);
    const head = asRecord(pr.head);
    if (
      head.ref !== branch ||
      asRecord(pr.base).ref !== base ||
      asRecord(head.repo).full_name !== `${owner}/${repository}`
    )
      throw new Error("Pull request does not belong to this session");
    const list = async (endpoint: string) => {
      const items: Record<string, unknown>[] = [];
      for (let page = 1; page <= 10; page++) {
        const result = await this.#requestJson(
          `${path}/${endpoint}?per_page=100&page=${page}`,
          token,
        );
        if (!Array.isArray(result))
          throw new Error("Invalid GitHub feedback response");
        for (const entry of result) {
          const item = asRecord(entry);
          if (typeof item.id !== "number" || typeof item.body !== "string")
            throw new Error("Invalid GitHub feedback item");
          items.push({
            id: item.id,
            author: asRecord(item.user).login,
            body: item.body,
            url: item.html_url,
            createdAt: item.created_at,
            updatedAt: item.updated_at,
            state: item.state,
            path: item.path,
            line: item.line,
            originalLine: item.original_line,
            diffHunk: item.diff_hunk,
            commitId: item.commit_id,
            replyTo: item.in_reply_to_id,
          });
        }
        if (result.length < 100) return items;
      }
      throw new Error(
        "PR feedback exceeds the safe fetch limit; narrow the request",
      );
    };
    const [comments, reviewComments, reviews] = await Promise.all([
      list(`issues/${number}/comments`),
      list(`pulls/${number}/comments`),
      list(`pulls/${number}/reviews`),
    ]);
    const feedback = {
      number,
      url: pr.html_url,
      state: pr.state,
      merged: Boolean(pr.merged_at),
      headSha: head.sha,
      comments,
      reviewComments,
      reviews,
    };
    if (JSON.stringify(feedback).length > 250_000)
      throw new Error("PR feedback exceeds the safe context limit");
    return feedback;
  }

  async managePullRequest(
    token: string,
    owner: string,
    repository: string,
    number: number,
    input: {
      action: "close" | "merge";
      branch: string;
      base: string;
      expectedHeadSha: string;
      mergeMethod?: "merge" | "squash" | "rebase" | undefined;
    },
  ) {
    if (
      ![owner, repository].every((part) => /^[a-zA-Z0-9_.-]+$/.test(part)) ||
      !Number.isSafeInteger(number) ||
      number < 1
    )
      throw new Error("Invalid pull request target");
    const path = `/repos/${owner}/${repository}/pulls/${number}`;
    const pr = await this.#api(path, token);
    const head = asRecord(pr.head);
    if (
      head.ref !== input.branch ||
      asRecord(pr.base).ref !== input.base ||
      asRecord(head.repo).full_name !== `${owner}/${repository}`
    )
      throw new Error("Pull request does not belong to this session's branch");
    if (pr.merged_at) return { state: "merged" as const };
    if (pr.state === "closed") {
      if (input.action === "close") return { state: "closed" as const };
      throw new Error("This pull request is closed and cannot be merged");
    }
    if (pr.state !== "open")
      throw new Error("Unknown GitHub pull request state");
    if (input.action === "close") {
      const closed = await this.#api(path, token, {
        method: "PATCH",
        body: JSON.stringify({ state: "closed" }),
      });
      if (closed.state !== "closed")
        throw new Error("GitHub did not confirm closing the pull request");
      return { state: "closed" as const };
    }
    if (
      !/^[a-f0-9]{40}$/.test(input.expectedHeadSha) ||
      head.sha !== input.expectedHeadSha
    )
      throw new Error(
        "The pull request changed since it was loaded. Refresh and review the latest changes before merging.",
      );
    const merged = await this.#api(`${path}/merge`, token, {
      method: "PUT",
      body: JSON.stringify({
        sha: input.expectedHeadSha,
        merge_method: input.mergeMethod ?? "squash",
      }),
    });
    if (merged.merged !== true)
      throw new Error(
        stringField(merged, "message") ?? "GitHub did not confirm the merge",
      );
    return { state: "merged" as const };
  }

  async #api(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    return asRecord(await this.#requestJson(path, token, init));
  }

  async #requestJson(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const response = await this.#fetch(`https://api.github.com${path}`, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(15_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": API_VERSION,
        "user-agent": "nimbus-github-app/0.1.0",
        ...init.headers,
      },
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok)
      throw githubError(
        "GitHub API request failed",
        response,
        asRecord(payload),
      );
    return payload;
  }
}

export function createGitHubAppJwt(
  appId: string,
  privateKey: string,
  now = Math.floor(Date.now() / 1000),
): string {
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const payload = encodeJson({ iat: now - 60, exp: now + 9 * 60, iss: appId });
  const content = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(content)
    .end()
    .sign(privateKey, "base64url");
  return `${content}.${signature}`;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => ({}));
  return asRecord(value);
}

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    readonly rateLimitRemaining: string | null,
    readonly rateLimitReset: string | null,
  ) {
    super(
      status === 429 || (status === 403 && rateLimitRemaining === "0")
        ? `GitHub rate limit reached (HTTP ${status}). Retry after the quota resets.`
        : status === 401 || status === 403
          ? `GitHub App access was rejected (HTTP ${status}). Check installation permissions.`
          : status === 404
            ? "GitHub repository or installation is unavailable (HTTP 404). Check the GitHub App's selected repositories."
            : status === 405 || status === 409
              ? `GitHub blocked this action (HTTP ${status}). Required checks, branch protection, or a changed head may prevent it.`
              : `GitHub API request failed (HTTP ${status}). Retry shortly.`,
    );
    this.name = "GitHubApiError";
  }
}

function githubError(
  message: string,
  response: Response,
  payload: Record<string, unknown>,
): Error {
  // Never surface raw provider response bodies or credentials in task errors/logs.
  void message;
  void payload;
  return new GitHubApiError(
    response.status,
    response.headers.get("x-ratelimit-remaining"),
    response.headers.get("x-ratelimit-reset"),
  );
}

function parseInstallation(value: Record<string, unknown>): GitHubInstallation {
  const account = asRecord(value.account);
  const id = numberField(value, "id");
  const accountId = numberField(account, "id");
  const login = stringField(account, "login");
  const accountType = stringField(account, "type");
  if (!id || !accountId || !login || !accountType)
    throw new Error("GitHub installation response was malformed");
  return {
    id,
    account: { id: accountId, login, type: accountType },
    repositorySelection:
      value.repository_selection === "all" ? "all" : "selected",
    suspendedAt:
      typeof value.suspended_at === "string" ? value.suspended_at : null,
  };
}

function parseRepository(value: unknown): GitHubRepository {
  const record = asRecord(value);
  const owner = asRecord(record.owner);
  const id = numberField(record, "id");
  const name = stringField(record, "name");
  const fullName = stringField(record, "full_name");
  const ownerLogin = stringField(owner, "login");
  const defaultBranch = stringField(record, "default_branch");
  if (!id || !name || !fullName || !ownerLogin || !defaultBranch)
    throw new Error("GitHub repository response was malformed");
  return {
    id,
    name,
    fullName,
    owner: ownerLogin,
    defaultBranch,
    private: record.private === true,
    archived: record.archived === true,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  return typeof record[key] === "number" ? record[key] : undefined;
}
