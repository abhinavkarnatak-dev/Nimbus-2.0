import {
  accounts,
  and,
  codexModelCatalogs,
  db,
  desc,
  eq,
  gt,
} from "@nimbus/database";
import { headers } from "next/headers";
import { deviceConnection, isLocalDeviceRequest } from "./codex-device";
import type { CodingAgentModel } from "@nimbus/codex";

export interface SelectableCodexModel {
  id: string;
  label: string;
  description?: string;
  isDefault: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{
    reasoningEffort: string;
    description: string;
  }>;
}

export function selectableModels(
  models: readonly CodingAgentModel[],
): SelectableCodexModel[] {
  return models.map((model) => ({
    ...model,
    label: model.displayName ?? model.id,
    isDefault: model.isDefault ?? false,
  }));
}

export async function getSelectableCodexModels(
  userId: string,
  organizationId?: string,
): Promise<SelectableCodexModel[]> {
  if (organizationId && process.env.NODE_ENV !== "production") {
    const requestHeaders = await headers();
    if (
      isLocalDeviceRequest(
        new Request("http://localhost", { headers: requestHeaders }),
      )
    ) {
      const connection = await deviceConnection(`${organizationId}:${userId}`);
      if (connection.status === "connected" && "models" in connection)
        return selectableModels(connection.models ?? []);
    }
  }
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

  return selectableModels(catalog?.models ?? []);
}

export function isSelectableEffort(
  model: SelectableCodexModel,
  effort: string,
): boolean {
  return (model.supportedReasoningEfforts ?? []).some(
    (option) => option.reasoningEffort === effort,
  );
}

export function isSelectableModel(
  models: readonly SelectableCodexModel[],
  modelId: string,
): boolean {
  return models.some((model) => model.id === modelId);
}
