import { auditLogs, db, desc, eq } from "@nimbus/database";
import { requireIdentity } from "@/lib/auth";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Audit log",
  description:
    "Review security-relevant Nimbus workspace activity and actions.",
};

export default async function AuditPage() {
  const identity = await requireIdentity();
  const rows = await db()
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, identity.organizationId))
    .orderBy(desc(auditLogs.createdAt));
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Audit log</p>
          <h1>Who did what.</h1>
          <p className="lede">
            Security-relevant user, system, integration, and executor actions
            are recorded with correlation IDs.
          </p>
        </div>
      </div>
      <section className="card">
        {rows.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Actor</th>
                <th>Target</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.action}</td>
                  <td>{row.actorType}</td>
                  <td className="path">
                    {row.targetType}:{row.targetId}
                  </td>
                  <td>{new Date(row.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">No audit activity has been recorded yet.</div>
        )}
      </section>
    </main>
  );
}
