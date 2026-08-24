import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("P2 restore target migration parity", () => {
  it("migrates the guarded restore target to the candidate schema before fixture writes", () => {
    const source = readFileSync("scripts/p2-staging-live-load.mjs", "utf8");
    const migrationCall = source.indexOf(
      "restoreTargetMigrationPreparation = applyRestoreTargetMigrations();",
    );
    const firstTaggedCleanup = source.indexOf("await cleanupTaggedData(sourceSql");

    expect(source).toContain('import { spawnSync } from "node:child_process";');
    expect(migrationCall).toBeGreaterThan(-1);
    expect(firstTaggedCleanup).toBeGreaterThan(migrationCall);
    expect(source).toContain('currentStage = "restore-target-migrations";');
    expect(source).toContain("UAIS_CORE_DATABASE_URL: restoreDatabaseUrl");
    expect(source).toContain('DATABASE_URL: ""');
    expect(source).toContain('POSTGRES_URL: ""');
    expect(source).toContain(
      '["scripts/apply-core-migrations.mjs"]',
    );
    expect(source).toContain(
      "JSON.stringify(migrationReport.migrations) !==\n      JSON.stringify(UAIS_CORE_DATABASE_MIGRATION_VERSIONS)",
    );
    expect(source).toContain("targetMigrationPreparation");
  });
});
