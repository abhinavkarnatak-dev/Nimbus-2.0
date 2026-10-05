import { requireIdentity } from "@/lib/auth";

export default async function SettingsPage() {
  const identity = await requireIdentity();
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Organization settings</p>
          <h1>{identity.organizationName}</h1>
          <p className="lede">
            Tenant boundaries, concurrency, retention, and trusted side-effect
            policies are administered here.
          </p>
        </div>
      </div>
      <div className="surface-grid">
        <section className="card surface-card">
          <h2>Concurrency</h2>
          <p>
            Four task slots. Tasks in different repositories and branches run
            independently.
          </p>
          <span className="status completed">enforced</span>
        </section>
        <section className="card surface-card">
          <h2>Pull requests</h2>
          <p>
            Verified branches and pull requests are created automatically. Merge
            and close require explicit action.
          </p>
          <span className="status completed">safe default</span>
        </section>
        <section className="card surface-card">
          <h2>Memory retention</h2>
          <p>
            Repository memory is disabled until a retention policy is selected.
          </p>
          <span className="status">disabled</span>
        </section>
        <section className="card surface-card">
          <h2>Observability privacy</h2>
          <p>
            PostHog content capture is denied by default on code, prompts,
            diffs, terminal output, and secret screens.
          </p>
          <span className="status completed">protected</span>
        </section>
      </div>
    </main>
  );
}
