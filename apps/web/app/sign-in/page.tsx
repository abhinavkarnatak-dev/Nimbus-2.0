import { currentIdentity } from "@/lib/auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { googleAuthConfigured } from "@/lib/google-auth-policy";
import { AuthError } from "next-auth";
import Image from "next/image";
import { Code2 } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to Nimbus and connect your own Codex account to start an inspectable cloud coding workspace.",
  robots: { index: false, follow: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const identity = await currentIdentity();
  if (identity)
    redirect(
      identity.authProvider === "google" && !identity.onboardingCompletedAt
        ? "/onboarding"
        : "/",
    );
  const googleEnabled = googleAuthConfigured();
  const { error } = await searchParams;
  return (
    <main className="signin">
      <section className="signin-card">
        <div className="brand">
          <span className="logo-glyph" aria-hidden="true">
            <svg
              className="logo-cloud-mark"
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
            >
              <path
                d="M20.5 17.5H5.8a4.3 4.3 0 0 1-.72-8.54A6.8 6.8 0 0 1 18.3 9.7a4.1 4.1 0 0 1 2.2 7.8Z"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <Code2
              className="logo-code-mark"
              size={8}
              strokeWidth={2.1}
              aria-hidden="true"
            />
          </span>{" "}
          Nimbus
        </div>
        <h1>Ship software with an agent you can inspect.</h1>
        <p className="lede">
          Nimbus keeps the repository, process, verification, and delivery trail
          visible from one durable task.
        </p>
        <div className="signin-actions">
          <form
            action={async () => {
              "use server";
              if (!googleAuthConfigured())
                redirect("/sign-in?error=Configuration");
              try {
                await signIn("google", { redirectTo: "/onboarding" });
              } catch (failure) {
                if (failure instanceof AuthError)
                  redirect("/sign-in?error=SignInFailed");
                throw failure;
              }
            }}
          >
            <button
              className="button"
              type="submit"
              disabled={!googleEnabled}
              style={{ width: "100%" }}
            >
              <Image
                src="/integrations/google.svg"
                alt=""
                width={20}
                height={20}
                unoptimized
              />
              Continue with Google
            </button>
          </form>
        </div>
        {!googleEnabled && (
          <p className="notice">
            Google sign-in will be available once OAuth setup is complete.
          </p>
        )}
        {error && (
          <p className="notice" role="alert">
            Sign-in could not be completed. Check your Google account access and
            try again.
          </p>
        )}
      </section>
    </main>
  );
}
