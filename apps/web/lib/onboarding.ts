import {
  and,
  db,
  eq,
  integrationAccounts,
  repositories,
  users,
} from "@nimbus/database";
import { deviceConnection } from "./codex-device";

export async function onboardingStatus(identity: {
  userId: string;
  organizationId: string;
}) {
  const [connections, repos, account, codex] = await Promise.all([
    db()
      .select({ id: integrationAccounts.id })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.organizationId, identity.organizationId),
          eq(integrationAccounts.kind, "github"),
          eq(integrationAccounts.status, "active"),
        ),
      )
      .limit(1),
    db()
      .select({ id: repositories.id })
      .from(repositories)
      .where(
        and(
          eq(repositories.organizationId, identity.organizationId),
          eq(repositories.archived, false),
        ),
      )
      .limit(1),
    db()
      .select({ completedAt: users.onboardingCompletedAt })
      .from(users)
      .where(eq(users.id, identity.userId))
      .limit(1),
    deviceConnection(`${identity.organizationId}:${identity.userId}`).catch(
      () => ({ status: "unavailable" }),
    ),
  ]);
  const githubConnected = connections.length > 0 && repos.length > 0;
  const codexConnected = codex.status === "connected";
  return {
    githubConnected,
    codexConnected,
    ready: codexConnected,
    completed: Boolean(account[0]?.completedAt),
  };
}
