export function workspaceName(name: string): string {
  const firstName = name.trim().split(/\s+/)[0];
  return firstName ? `${firstName}'s workspace` : "Your workspace";
}

export function googleAuthOrigin(): string | null {
  try {
    const url = new URL(process.env.AUTH_URL ?? "");
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    if (
      url.protocol !== "https:" &&
      !(
        local &&
        process.env.NODE_ENV !== "production" &&
        url.protocol === "http:"
      )
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function googleAuthConfigured(): boolean {
  return Boolean(
    googleAuthOrigin() &&
      process.env.AUTH_GOOGLE_ID?.trim() &&
      process.env.AUTH_GOOGLE_SECRET?.trim() &&
      (process.env.AUTH_SECRET?.length ?? 0) >= 32,
  );
}

export function verifiedGoogleIdentity(profile: unknown): {
  subject: string;
  email: string;
  name: string;
  image: string | null;
} {
  if (!profile || typeof profile !== "object")
    throw new Error("Invalid Google identity");
  const value = profile as Record<string, unknown>;
  if (
    value.email_verified !== true ||
    typeof value.sub !== "string" ||
    !value.sub ||
    typeof value.email !== "string" ||
    !value.email.includes("@")
  )
    throw new Error("A verified Google account is required");
  return {
    subject: value.sub,
    email: value.email.trim().toLowerCase(),
    name:
      typeof value.name === "string" && value.name ? value.name : "Nimbus user",
    image:
      typeof value.picture === "string" && value.picture.startsWith("https://")
        ? value.picture
        : null,
  };
}
