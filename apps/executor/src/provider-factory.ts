import {
  CodexAppServerProvider,
  FakeCodingAgentProvider,
  requireProductionProvider,
  type CodingAgentProvider,
} from "@nimbus/codex";

export interface ProviderConfiguration {
  provider: CodingAgentProvider;
  model: string;
}

export function createProviderConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): ProviderConfiguration {
  if (environment.NIMBUS_CODING_PROVIDER === "fake") {
    const provider = new FakeCodingAgentProvider();
    requireProductionProvider(provider, environment.NODE_ENV);
    return { provider, model: "fake-codex-test-provider" };
  }

  if (environment.NIMBUS_CODING_PROVIDER === "codex") {
    const accessToken = environment.NIMBUS_CODEX_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error(
        "NIMBUS_CODEX_ACCESS_TOKEN is required for the local Codex provider bootstrap",
      );
    }
    return {
      provider: new CodexAppServerProvider({
        accessToken,
        onStderr(message) {
          console.error("codex app-server stderr", { message });
        },
      }),
      model: environment.NIMBUS_CODEX_MODEL ?? "gpt-5.2-codex",
    };
  }

  throw new Error(
    "NIMBUS_CODING_PROVIDER must be explicitly set to fake or codex",
  );
}
