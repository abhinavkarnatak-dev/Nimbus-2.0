import { defineSandbox } from "eve/sandbox";
import { VercelSandbox } from "eve/sandbox/vercel";

export const environment = VercelSandbox.environment();

export default defineSandbox(() =>
  environment.open({
    networkPolicy: {
      allow: {
        "api.openai.com": [],
        "developers.openai.com": [],
        "registry.npmjs.org": [],
      },
    },
    resources: { vcpus: 4 },
    timeout: 3_600_000,
  }),
);
