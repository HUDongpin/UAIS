import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATION_DB_TEST_GUARD,
  CORE_MIGRATION_P1_LOAD_TEST_GUARD,
  CORE_MIGRATION_STAGING_RESTORE_GUARD,
  CORE_MIGRATION_STAGING_SOURCE_GUARD,
  assertCoreMigrationDatabaseGuard,
  resolveCoreMigrationGuardContract,
} from "../scripts/core-migration-guard.mjs";

const stagingProjectId = "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL";
const productionProjectId = "prj_MZIjawDPTU4tj4yuTBsd9hyLxHXA";

describe("core migration target guard", () => {
  it("requires the source guard for the default isolated staging deploy path", () => {
    const baseEnv = {
      VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: stagingProjectId,
      UAIS_DEPLOYMENT_ENV: "staging",
      UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
    };

    expect(resolveCoreMigrationGuardContract({ env: baseEnv, deployMode: true })).toEqual({
      approved: false,
      blockedReason: "isolated-staging-migration-guard-required",
    });
    expect(
      resolveCoreMigrationGuardContract({
        env: {
          ...baseEnv,
          UAIS_CORE_DATABASE_REQUIRED_GUARD:
            CORE_MIGRATION_STAGING_SOURCE_GUARD,
        },
        deployMode: true,
      }),
    ).toEqual({
      approved: true,
      requiredGuard: CORE_MIGRATION_STAGING_SOURCE_GUARD,
    });
  });

  it.each([
    ["wrong project", { VERCEL_PROJECT_ID: "prj_unknown" }],
    ["wrong deployment marker", { UAIS_DEPLOYMENT_ENV: "production" }],
    ["groups disabled", { UAIS_LEARNING_CHATROOM_GROUPS_MODE: "off" }],
  ])("rejects a staging guard contract with %s", (_label, override) => {
    expect(
      resolveCoreMigrationGuardContract({
        env: {
          VERCEL_ENV: "production",
          VERCEL_PROJECT_ID: stagingProjectId,
          UAIS_DEPLOYMENT_ENV: "staging",
          UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
          UAIS_CORE_DATABASE_REQUIRED_GUARD:
            CORE_MIGRATION_STAGING_SOURCE_GUARD,
          ...override,
        },
        deployMode: false,
      }),
    ).toMatchObject({ approved: false });
  });

  it("keeps production and local operator runs on the existing unguarded contract", () => {
    expect(
      resolveCoreMigrationGuardContract({
        env: {
          VERCEL_ENV: "production",
          VERCEL_PROJECT_ID: productionProjectId,
        },
        deployMode: true,
      }),
    ).toEqual({ approved: true, requiredGuard: undefined });
    expect(resolveCoreMigrationGuardContract({ env: {}, deployMode: false })).toEqual({
      approved: true,
      requiredGuard: undefined,
    });
  });

  it("accepts the dedicated DB-test guard outside staging and rejects unknown labels", () => {
    expect(
      resolveCoreMigrationGuardContract({
        env: { UAIS_CORE_DATABASE_REQUIRED_GUARD: CORE_MIGRATION_DB_TEST_GUARD },
        deployMode: false,
      }),
    ).toEqual({ approved: true, requiredGuard: CORE_MIGRATION_DB_TEST_GUARD });
    expect(
      resolveCoreMigrationGuardContract({
        env: { UAIS_CORE_DATABASE_REQUIRED_GUARD: "caller-controlled-label" },
        deployMode: false,
      }),
    ).toEqual({
      approved: false,
      blockedReason: "unsupported-database-guard-contract",
    });
  });

  it("accepts the exact P1 load marker as a migration guard outside staging", () => {
    expect(
      resolveCoreMigrationGuardContract({
        env: {
          UAIS_CORE_DATABASE_REQUIRED_GUARD:
            CORE_MIGRATION_P1_LOAD_TEST_GUARD,
        },
        deployMode: false,
      }),
    ).toEqual({
      approved: true,
      requiredGuard: CORE_MIGRATION_P1_LOAD_TEST_GUARD,
    });
    expect(CORE_MIGRATION_P1_LOAD_TEST_GUARD).toBe(
      "isolated-p1-load-test",
    );
  });

  it("permits the restore guard only on the exact isolated staging identity", () => {
    expect(
      resolveCoreMigrationGuardContract({
        env: {
          VERCEL_PROJECT_ID: stagingProjectId,
          UAIS_DEPLOYMENT_ENV: "staging",
          UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
          UAIS_CORE_DATABASE_REQUIRED_GUARD:
            CORE_MIGRATION_STAGING_RESTORE_GUARD,
        },
        deployMode: false,
      }),
    ).toEqual({
      approved: true,
      requiredGuard: CORE_MIGRATION_STAGING_RESTORE_GUARD,
    });
  });

  it("reads the qualified marker and origin role without disclosing connection data", async () => {
    let observedSql = "";
    const client = vi.fn(async (strings: TemplateStringsArray) => {
      observedSql = strings.join("?");
      return [
        {
          environment: CORE_MIGRATION_STAGING_SOURCE_GUARD,
          session_replication_role: "origin",
        },
      ];
    });

    await expect(
      assertCoreMigrationDatabaseGuard({
        client,
        requiredGuard: CORE_MIGRATION_STAGING_SOURCE_GUARD,
      }),
    ).resolves.toBeUndefined();
    expect(observedSql).toContain("FROM public.uais_environment_guard");
    expect(observedSql).toContain("current_setting('session_replication_role')");
    expect(client).toHaveBeenCalledTimes(1);
  });

  it("blocks a copied marker when the connection is in replica mode", async () => {
    const client = vi.fn(async () => [
      {
        environment: CORE_MIGRATION_STAGING_SOURCE_GUARD,
        session_replication_role: "replica",
      },
    ]);

    await expect(
      assertCoreMigrationDatabaseGuard({
        client,
        requiredGuard: CORE_MIGRATION_STAGING_SOURCE_GUARD,
      }),
    ).rejects.toMatchObject({
      name: "CoreMigrationGuardError",
      reason: "required-database-guard-not-approved",
    });
  });

  it("checks the target in the migration transaction before any DDL and before each LangGraph setup", () => {
    const source = readFileSync("scripts/apply-core-migrations.mjs", "utf8");
    const transactionGuard = source.indexOf(
      "await assertCoreMigrationDatabaseGuard({\n      client: tx,",
    );
    const firstCoreDdl = source.indexOf(
      "CREATE TABLE IF NOT EXISTS uais_schema_migrations",
    );
    const checkpointerGuard = source.indexOf(
      "await assertCoreMigrationDatabaseGuard({\n    client: sql,",
      firstCoreDdl,
    );
    const checkpointerSetup = source.indexOf("await checkpointer.setup()");
    const storeGuard = source.indexOf(
      "await assertCoreMigrationDatabaseGuard({\n    client: sql,",
      checkpointerGuard + 1,
    );
    const storeSetup = source.indexOf("await store.setup()");

    expect(transactionGuard).toBeGreaterThan(-1);
    expect(transactionGuard).toBeLessThan(firstCoreDdl);
    expect(checkpointerGuard).toBeGreaterThan(firstCoreDdl);
    expect(checkpointerGuard).toBeLessThan(checkpointerSetup);
    expect(storeGuard).toBeGreaterThan(checkpointerSetup);
    expect(storeGuard).toBeLessThan(storeSetup);
  });
});
