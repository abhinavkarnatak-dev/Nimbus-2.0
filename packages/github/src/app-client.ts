import { createSign } from "node:crypto";

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

  async exchangeUserCode(code: string): Promise<string> {
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

  async getInstallation(installationId: number): Promise<GitHubInstallation> {
    const response = await this.#api(
      `/app/installations/${installationId}`,
      createGitHubAppJwt(this.#config.appId, this.#config.privateKey),
    );
    return parseInstallation(response);
  }

  async createInstallationToken(
    installationId: number,
  ): Promise<InstallationToken> {
    const response = await this.#api(
      `/app/installations/${installationId}/access_tokens`,
      createGitHubAppJwt(this.#config.appId, this.#config.privateKey),
      {
        method: "POST",
        body: JSON.stringify({
          permissions: {
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
      const entries = Array.isArray(response.repositories)
        ? response.repositories
        : [];
      repositories.push(...entries.map(parseRepository));
      if (entries.length < 100) return repositories;
    }
    throw new Error("GitHub repository pagination exceeded the safety limit");
  }

  async #api(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.#fetch(`https://api.github.com${path}`, {
      ...init,
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
    const payload = await readJson(response);
    if (!response.ok)
      throw githubError("GitHub API request failed", response, payload);
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

function githubError(
  message: string,
  response: Response,
  payload: Record<string, unknown>,
): Error {
  const detail = stringField(payload, "message") ?? "No response message";
  return new Error(`${message} (${response.status}): ${detail}`);
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
