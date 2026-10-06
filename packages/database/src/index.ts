import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema.js";

let client: ReturnType<typeof postgres> | undefined;

export function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}

export function db() {
  client ??= postgres(databaseUrl(), {
    max: Number(process.env.DATABASE_POOL_SIZE ?? "10"),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return drizzle(client, { schema });
}

export async function closeDatabase(): Promise<void> {
  if (client) await client.end({ timeout: 5 });
  client = undefined;
}

export * from "./schema.js";
export { persistGeneratedTaskTitle } from "./session-title.js";
export { readAgentInstructions } from "./agent-instructions.js";
export {
  listChatSkills,
  resolveChatSkills,
  ownedSkillScope,
} from "./chat-skills.js";
export {
  activeRequestId,
  stopRequest,
  requestWasStopped,
  finishStoppedRequest,
} from "./request-stop.js";
export { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
