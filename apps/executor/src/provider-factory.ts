import {
  CodexAppServerProvider,
  FakeCodingAgentProvider,
  LocalConnectedCodexProvider,
  requireProductionProvider,
  type CodingAgentProvider,
} from "@nimbus/codex";

export interface ProviderConfiguration {
  provider: CodingAgentProvider;
  fallbackModel?: string;
}

export function createProviderConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): ProviderConfiguration {
  if (environment.NIMBUS_CODING_PROVIDER === "connected") {
    // No operator-wide token: each real task uses its owner's device connection.
    return { provider: new LocalConnectedCodexProvider("bootstrap", "") };
  }
  if (environment.NIMBUS_CODING_PROVIDER === "fake") {
    const provider = new FakeCodingAgentProvider();
    requireProductionProvider(provider, environment.NODE_ENV);
    return { provider, fallbackModel: "fake-codex-test-provider" };
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
    };
  }

  throw new Error(
    "NIMBUS_CODING_PROVIDER must be explicitly set to fake, connected, or codex",
  );
}
