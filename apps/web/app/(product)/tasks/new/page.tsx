import { db, eq, repositories } from "@nimbus/database";
import { requireIdentity } from "@/lib/auth";
import { getSelectableCodexModels } from "@/lib/codex-models";

export default async function NewTaskPage() {
  const identity = await requireIdentity();
  const repos = await db()
    .select()
    .from(repositories)
    .where(eq(repositories.organizationId, identity.organizationId));
  const models = await getSelectableCodexModels(identity.userId);
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">New task</p>
          <h1>Give Codex an outcome.</h1>
          <p className="lede">
            Nimbus will preserve the adaptive process, verification, and
            delivery trail. Ordinary repository work runs autonomously inside
            the assigned workspace.
          </p>
        </div>
      </div>
      <section className="card" style={{ maxWidth: 760 }}>
        <form
          action="/api/tasks"
          method="post"
          style={{ padding: 24, display: "grid", gap: 18 }}
        >
          <label>
            <span className="eyebrow">Codex model</span>
            <select
              name="model"
              required
              disabled={!models.length}
              style={{
                width: "100%",
                padding: 12,
                marginTop: 7,
                border: "1px solid var(--line)",
                borderRadius: 10,
              }}
            >
              {models.length ? (
                models.map((model) => (
                  <option value={model.id} key={model.id}>
                    {model.label}
                    {model.isDefault ? " (default)" : ""}
                  </option>
                ))
              ) : (
                <option value="">Connect ChatGPT to load models</option>
              )}
            </select>
            <small
              style={{ display: "block", marginTop: 8, color: "var(--muted)" }}
            >
              Loaded from Codex app-server for the connected ChatGPT account.
            </small>
          </label>
          <label>
            <span className="eyebrow">Repository</span>
            <select
              name="repositoryId"
              required
              style={{
                width: "100%",
                padding: 12,
                marginTop: 7,
                border: "1px solid var(--line)",
                borderRadius: 10,
              }}
            >
              {repos.map((repo) => (
                <option value={repo.id} key={repo.id}>
                  {repo.fullName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="eyebrow">What should Nimbus do?</span>
            <textarea
              name="objective"
              required
              minLength={10}
              maxLength={8000}
              rows={8}
              placeholder="Describe the desired outcome, constraints, and anything Codex should preserve."
              style={{
                width: "100%",
                padding: 12,
                marginTop: 7,
                border: "1px solid var(--line)",
                borderRadius: 10,
                resize: "vertical",
              }}
            />
            <small
              style={{ display: "block", marginTop: 8, color: "var(--muted)" }}
            >
              Nimbus will interpret your request and name the session for you.
            </small>
          </label>
          <input
            type="hidden"
            name="idempotencyKey"
            value={`web-${crypto.randomUUID()}`}
          />
          <button
            className="button"
            type="submit"
            style={{ width: "fit-content" }}
            disabled={!models.length}
          >
            Run agent
          </button>
        </form>
      </section>
    </main>
  );
}
