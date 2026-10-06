import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import {
  googleAuthConfigured,
  googleAuthOrigin,
  verifiedGoogleIdentity,
} from "@/lib/google-auth-policy";
import { provisionGoogleAccount } from "@/lib/google-account";

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  providers: googleAuthConfigured()
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID!,
          clientSecret: process.env.AUTH_GOOGLE_SECRET!,
          checks: ["pkce", "state"],
          authorization: { params: { scope: "openid email profile" } },
        }),
      ]
    : [],
  ...(process.env.AUTH_SECRET ? { secret: process.env.AUTH_SECRET } : {}),
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/sign-in", error: "/sign-in" },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      try {
        verifiedGoogleIdentity(profile);
        return true;
      } catch {
        return false;
      }
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "google")
        token.nimbusUserId = await provisionGoogleAccount(profile);
      return token;
    },
    async session({ session, token }) {
      if (typeof token.nimbusUserId === "string")
        session.user.id = token.nimbusUserId;
      return session;
    },
    async redirect({ url }) {
      const origin = googleAuthOrigin();
      if (!origin) return "/sign-in";
      try {
        const target = new URL(url, origin);
        return target.origin === origin ? target.toString() : origin;
      } catch {
        return origin;
      }
    },
  },
  logger: {
    error() {
      console.error("Nimbus authentication failed");
    },
    warn() {
      console.warn("Nimbus authentication configuration warning");
    },
    debug() {},
  },
}));
