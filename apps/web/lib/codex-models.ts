import {
  accounts,
  and,
  codexModelCatalogs,
  db,
  desc,
  eq,
  gt,
} from "@nimbus/database";

export interface SelectableCodexModel {
  id: string;
  label: string;
  description?: string;
  isDefault: boolean;
}

export async function getSelectableCodexModels(
  userId: string,
): Promise<SelectableCodexModel[]> {
  if (process.env.NIMBUS_CODING_PROVIDER === "fake") {
    return [
      {
        id: "fake-codex-test-provider",
        label: "Local test model",
        description: "Deterministic simulation, not a live Codex model",
        isDefault: true,
      },
    ];
  }

  const [catalog] = await db()
    .select({ models: codexModelCatalogs.models })
    .from(codexModelCatalogs)
    .innerJoin(accounts, eq(codexModelCatalogs.accountId, accounts.id))
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.provider, "chatgpt"),
        gt(codexModelCatalogs.expiresAt, new Date().toISOString()),
      ),
    )
    .orderBy(desc(codexModelCatalogs.discoveredAt))
    .limit(1);

  return (catalog?.models ?? []).map((model) => ({
    id: model.id,
    label: model.displayName ?? model.id,
    ...(model.description ? { description: model.description } : {}),
    isDefault: model.isDefault ?? false,
  }));
}

export function isSelectableModel(
  models: readonly SelectableCodexModel[],
  modelId: string,
): boolean {
  return models.some((model) => model.id === modelId);
}
