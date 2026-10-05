import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";

import { closeDatabase, db } from "./index.js";

await migrate(db(), {
  migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
});
await closeDatabase();
console.log("Nimbus database migrations completed");
