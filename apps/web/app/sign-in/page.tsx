import { currentIdentity } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function SignInPage() {
  if (await currentIdentity()) redirect("/");
  const localEnabled =
    process.env.NODE_ENV !== "production" &&
    process.env.NIMBUS_LOCAL_AUTH === "true";
  const chatGptEnabled = process.env.NIMBUS_CHATGPT_OAUTH_ENABLED === "true";
  return (
    <main className="signin">
      <section className="signin-card">
        <div className="brand">
          <span className="brand-mark">N</span> Nimbus
        </div>
        <p className="eyebrow">Secure workspace</p>
        <h1>Ship software with an agent you can inspect.</h1>
        <p className="lede">
          Nimbus keeps the repository, process, verification, and delivery trail
          visible from one durable task.
        </p>
        <div className="signin-actions">
          <a
            className={`button${chatGptEnabled ? "" : " secondary"}`}
            href={
              chatGptEnabled
                ? "/api/auth/chatgpt/start"
                : "#chatgpt-unavailable"
            }
            aria-disabled={!chatGptEnabled}
          >
            Continue with ChatGPT
          </a>
          {localEnabled && (
            <form action="/api/auth/local" method="post">
              <button
                className="button secondary"
                type="submit"
                style={{ width: "100%" }}
              >
                Enter local development workspace
              </button>
            </form>
          )}
        </div>
        {!chatGptEnabled && (
          <p id="chatgpt-unavailable" className="notice">
            ChatGPT sign-in is a launch-gated integration. An approved client ID
            is not configured in this environment. No API-key fallback is used.
          </p>
        )}
      </section>
    </main>
  );
}
