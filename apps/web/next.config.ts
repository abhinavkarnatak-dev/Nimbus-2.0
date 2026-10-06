import type { NextConfig } from "next";
import { resolve } from "node:path";

const workspaceRoot = resolve(process.cwd(), "../..");

const config: NextConfig = {
  reactStrictMode: true,
  // The PostHog project token is intentionally public and is required by the
  // browser SDK for Web Analytics and Session Replay. Allow local/deployment
  // setups that already provide the server-side project-token variable to
  // reuse it without duplicating the value in a NEXT_PUBLIC_ variable.
  env: {
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN:
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ??
      process.env.POSTHOG_PROJECT_TOKEN,
    NEXT_PUBLIC_POSTHOG_HOST:
      process.env.NEXT_PUBLIC_POSTHOG_HOST ??
      process.env.POSTHOG_HOST ??
      "https://us.i.posthog.com",
  },
  transpilePackages: ["@nimbus/database", "@nimbus/shared", "@nimbus/github"],
  experimental: { externalDir: true },
  turbopack: { root: workspaceRoot },
  outputFileTracingExcludes: {
    "/*": ["../../.nimbus/**/*", "../../.env*", ".env*"],
  },
  webpack(config) {
    // Workspace packages use NodeNext .js specifiers for their TypeScript sources.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  allowedDevOrigins: ["127.0.0.1"],
  logging: {
    incomingRequests: { ignore: [/^\/api\/(github\/callback|auth\/callback)/] },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.posthog.com; connect-src 'self' https://*.posthog.com; worker-src 'self' blob: data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://github.com https://accounts.google.com",
          },
        ],
      },
    ];
  },
};

export default config;
