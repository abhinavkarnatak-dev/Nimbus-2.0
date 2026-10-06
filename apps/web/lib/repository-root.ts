import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function nimbusRepositoryRoot(): string {
  for (const candidate of [
    resolve(process.cwd()),
    resolve(process.cwd(), "../.."),
  ]) {
    const manifest = join(candidate, "package.json");
    if (
      existsSync(manifest) &&
      existsSync(join(candidate, "apps/web/package.json")) &&
      JSON.parse(readFileSync(manifest, "utf8")).name === "nimbus-2"
    )
      return candidate;
  }
  throw new Error(
    "Start Nimbus from its repository root or apps/web directory",
  );
}
