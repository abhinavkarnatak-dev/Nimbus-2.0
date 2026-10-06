/** Hosting this flow is an explicit operator opt-in, not OpenAI approval. */
export function deviceAuthEnabled(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return (
    environment.NODE_ENV !== "production" ||
    environment.NIMBUS_DEVICE_AUTH_ENABLED === "true"
  );
}

export function deviceRequestAllowed(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (!deviceAuthEnabled(environment)) return false;
  const host = request.headers.get("host") ?? "";
  if (environment.NODE_ENV !== "production") {
    return (
      !request.headers.has("cf-connecting-ip") &&
      (!request.headers.has("x-forwarded-host") ||
        request.headers.get("x-forwarded-host") === host) &&
      /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
    );
  }
  try {
    const configured = new URL(environment.AUTH_URL ?? "");
    return (
      configured.protocol === "https:" &&
      configured.host === host &&
      (!request.headers.has("x-forwarded-host") ||
        request.headers.get("x-forwarded-host") === host)
    );
  } catch {
    return false;
  }
}

export function deviceMutationAllowed(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (!deviceRequestAllowed(request, environment)) return false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const expected =
      environment.NODE_ENV === "production"
        ? new URL(environment.AUTH_URL ?? "").origin
        : `http://${request.headers.get("host")}`;
    return origin.origin === expected;
  } catch {
    return false;
  }
}
