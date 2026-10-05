export interface GitHubAppConfig {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret: string;
}

export function loadGitHubAppConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GitHubAppConfig {
  return {
    appId: required(environment, "GITHUB_APP_ID"),
    slug: required(environment, "GITHUB_APP_SLUG"),
    clientId: required(environment, "GITHUB_APP_CLIENT_ID"),
    clientSecret: required(environment, "GITHUB_APP_CLIENT_SECRET"),
    privateKey: decodePrivateKey(
      required(environment, "GITHUB_APP_PRIVATE_KEY_BASE64"),
    ),
    webhookSecret: required(environment, "GITHUB_APP_WEBHOOK_SECRET"),
  };
}

export function hasGitHubAppConfig(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return [
    "GITHUB_APP_ID",
    "GITHUB_APP_SLUG",
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CLIENT_SECRET",
    "GITHUB_APP_PRIVATE_KEY_BASE64",
    "GITHUB_APP_WEBHOOK_SECRET",
  ].every((name) => Boolean(environment[name]?.trim()));
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function decodePrivateKey(encoded: string): string {
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  if (!decoded.includes("BEGIN RSA PRIVATE KEY")) {
    throw new Error("GITHUB_APP_PRIVATE_KEY_BASE64 is not a PKCS#1 PEM key");
  }
  return decoded;
}
