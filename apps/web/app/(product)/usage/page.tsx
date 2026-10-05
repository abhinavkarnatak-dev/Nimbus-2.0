import { db, desc, eq, usageRecords } from "@nimbus/database";
import { requireIdentity } from "@/lib/auth";

export default async function UsagePage() {
  const identity = await requireIdentity();
  const rows = await db()
    .select()
    .from(usageRecords)
    .where(eq(usageRecords.organizationId, identity.organizationId))
    .orderBy(desc(usageRecords.recordedAt));
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Usage</p>
          <h1>Resource accounting.</h1>
          <p className="lede">
            Usage records are durable and scoped to the organization. Redis
            counters are never the billing source of truth.
          </p>
        </div>
      </div>
      <section className="card">
        {rows.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Quantity</th>
                <th>Recorded</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.kind}</td>
                  <td>
                    {row.quantity} {row.unit}
                  </td>
                  <td>{new Date(row.recordedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">
            No billable usage has been recorded in this local workspace.
          </div>
        )}
      </section>
    </main>
  );
}
