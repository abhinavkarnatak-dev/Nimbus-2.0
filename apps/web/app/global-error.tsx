"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    posthog.captureException(error, { source: "next_global_error" });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="auth-page">
          <section className="auth-card">
            <h1>Nimbus could not load</h1>
            <p>The error was recorded. Try loading the application again.</p>
            <button className="button-primary" type="button" onClick={reset}>
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
