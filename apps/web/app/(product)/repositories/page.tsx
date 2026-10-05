import { db, eq, repositories } from "@nimbus/database";
import { requireIdentity } from "@/lib/auth";

export default async function RepositoriesPage() {
  const identity = await requireIdentity();
  const rows = await db()
    .select()
    .from(repositories)
    .where(eq(repositories.organizationId, identity.organizationId));
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Repositories</p>
          <h1>Authorized codebases.</h1>
          <p className="lede">
            Repository access is resolved from server-owned installation records
            for every task.
          </p>
        </div>
      </div>
      <section className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Repository</th>
              <th>Default branch</th>
              <th>Visibility</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((repo) => (
              <tr key={repo.id}>
                <td>
                  <strong>{repo.fullName}</strong>
                </td>
                <td className="path">{repo.defaultBranch}</td>
                <td>{repo.private ? "Private" : "Public"}</td>
                <td>{repo.archived ? "Archived" : "Available"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
