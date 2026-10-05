import { db, eq, or, skills } from "@nimbus/database";
import { requireIdentity } from "@/lib/auth";

export default async function SkillsPage() {
  const identity = await requireIdentity();
  const rows = await db()
    .select()
    .from(skills)
    .where(
      or(
        eq(skills.organizationId, identity.organizationId),
        eq(skills.ownerUserId, identity.userId),
      ),
    );
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Skills</p>
          <h1>Versioned guidance, never hidden authority.</h1>
          <p className="lede">
            Published skill versions are immutable. Capabilities remain
            constrained by the task and organization policy.
          </p>
        </div>
        <button className="button" disabled>
          New skill
        </button>
      </div>
      <section className="card">
        {rows.length ? (
          <table className="table">
            <tbody>
              {rows.map((skill) => (
                <tr key={skill.id}>
                  <td>
                    <strong>{skill.name}</strong>
                    <div className="muted">{skill.description}</div>
                  </td>
                  <td>{skill.visibility}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">
            No skills are assigned to this organization yet.
          </div>
        )}
      </section>
    </main>
  );
}
