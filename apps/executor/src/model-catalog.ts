import { randomUUID } from "node:crypto";

import type { CodingAgentProvider } from "@nimbus/codex";
import { codexModelCatalogs, db } from "@nimbus/database";

const CATALOG_TTL_MS = 15 * 60 * 1000;

export async function refreshCodexModelCatalog(
  accountId: string,
  provider: CodingAgentProvider,
): Promise<number> {
  const discovered = await provider.listModels();
  const models = Array.from(
    new Map(
      discovered
        .filter((model) => model.id.trim().length > 0)
        .map((model) => [model.id, model]),
    ).values(),
  );
  if (!models.length)
    throw new Error("Codex app-server returned an empty model catalog");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + CATALOG_TTL_MS).toISOString();
  await db()
    .insert(codexModelCatalogs)
    .values({
      id: `cat_${randomUUID().replaceAll("-", "")}`,
      accountId,
      models,
      discoveredAt: now.toISOString(),
      expiresAt,
    })
    .onConflictDoUpdate({
      target: codexModelCatalogs.accountId,
      set: {
        models,
        discoveredAt: now.toISOString(),
        expiresAt,
        updatedAt: now.toISOString(),
      },
    });
  return models.length;
}
