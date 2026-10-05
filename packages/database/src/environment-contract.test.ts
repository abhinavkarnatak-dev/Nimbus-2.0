import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("service-local environment configuration", () => {
  it("loads a service file without requiring a root environment file", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--env-file-if-exists=.env.example",
        "--eval",
        "process.stdout.write(process.env.DATABASE_URL ?? '')",
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH } },
    );
    expect(output).toBe("postgresql://nimbus:nimbus@localhost:55432/nimbus");
  });

  it("preserves injected deployment variables over file defaults", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--env-file-if-exists=.env.example",
        "--eval",
        "process.stdout.write(process.env.DATABASE_URL ?? '')",
      ],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH, DATABASE_URL: "injected-test-url" },
      },
    );
    expect(output).toBe("injected-test-url");
  });

  it("keeps GitHub credentials out of executor and migration templates", () => {
    for (const file of [".env.example", "../../apps/executor/.env.example"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/^GITHUB_/m);
    }
    for (const file of ["package.json", "../../apps/executor/package.json"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("--env-file-if-exists=.env.local");
      expect(source).not.toContain("../../.env");
    }
  });
});
