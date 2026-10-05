import { and, db, eq, isNull, memories } from "@nimbus/database";
import { requireIdentity } from "@/lib/auth";

export default async function MemoryPage() {
  const identity = await requireIdentity();
  const rows = await db()
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.scopeType, "organization"),
        eq(memories.scopeId, identity.organizationId),
        isNull(memories.deletedAt),
      ),
    );
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Memory and privacy</p>
          <h1>Inspectable context.</h1>
          <p className="lede">
            Every recalled memory has a scope, source, retention rule, and
            explanation. Secrets and hidden reasoning are excluded.
          </p>
        </div>
      </div>
      <section className="card">
        {rows.length ? (
          <table className="table">
            <tbody>
              {rows.map((memory) => (
                <tr key={memory.id}>
                  <td>
                    <strong>{memory.summary}</strong>
                    <div className="muted">{memory.kind}</div>
                  </td>
                  <td>{memory.scopeType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">No organization memory has been stored.</div>
        )}
      </section>
    </main>
  );
}
