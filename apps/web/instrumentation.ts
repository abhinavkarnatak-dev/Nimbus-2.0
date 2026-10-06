import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  _request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { createObservability } = await import("@nimbus/observability");
  const telemetry = createObservability({
    ...process.env,
    POSTHOG_PROJECT_TOKEN:
      process.env.POSTHOG_PROJECT_TOKEN ??
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    POSTHOG_HOST:
      process.env.POSTHOG_HOST ?? process.env.NEXT_PUBLIC_POSTHOG_HOST,
    POSTHOG_SERVICE_NAME: "nimbus-web",
  });

  try {
    telemetry.captureException(error, "nimbus_web", {
      category: context.routeType,
      status: "failed",
      errorClass: error instanceof Error ? error.name : "unknown",
    });
    telemetry.log("error", "Nimbus web request failed", {
      category: context.routeType,
      status: "failed",
      errorClass: error instanceof Error ? error.name : "unknown",
    });
  } finally {
    await telemetry.shutdown();
  }
};
