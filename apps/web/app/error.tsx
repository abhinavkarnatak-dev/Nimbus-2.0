"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    posthog.captureException(error, { source: "next_error_boundary" });
  }, [error]);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Something went wrong</h1>
        <p>Nimbus recorded this error. You can safely try again.</p>
        <button className="button-primary" type="button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
