import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  UAIS_CORE_DATABASE_ENV_NAMES,
  UAIS_ISOLATED_STAGING_CORE_DATABASE_ENV_NAME,
  getUaisCoreDatabaseReadiness,
  readUaisCoreDatabaseUrl,
} from "@/lib/db/core-database";
import {
  UAIS_CORE_DATABASE_MIGRATIONS,
  UAIS_CORE_DATABASE_MIGRATIONS_TABLE,
  UAIS_CORE_DATABASE_MIGRATION_VERSIONS,
} from "@/lib/db/migrations";
import { uaisCoreSchemaTables } from "@/lib/db/schema";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import { TeachingCourseManagementStoreError } from "@/lib/server/teaching-course-management-store";

function readProjectFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("B-11 core database foundation", () => {
  it("declares the managed Postgres readiness contract without leaking URLs", () => {
    expect(getUaisCoreDatabaseReadiness({})).toEqual({
      target: "uais-core-database",
      status: "blocked",
      blockedReason: "missing-managed-postgres-url",
      acceptedEnvNames: UAIS_CORE_DATABASE_ENV_NAMES,
      valueRedacted: true,
    });

    const readiness = getUaisCoreDatabaseReadiness({
      UAIS_CORE_DATABASE_URL: "postgres://user:secret@example.test/uais",
    });

    expect(readiness).toEqual({
      target: "uais-core-database",
      status: "ready",
      providerClass: "managed-postgres",
      selectedEnvName: "UAIS_CORE_DATABASE_URL",
      // The whole inventory, not the first migration. This field claimed
      // `["0001_core_poc"]` while the runner applied seven, so a readiness
      // report was most confident exactly where it was most wrong.
      migrations: UAIS_CORE_DATABASE_MIGRATION_VERSIONS,
      valueRedacted: true,
    });
    expect(UAIS_CORE_DATABASE_MIGRATION_VERSIONS.length).toBeGreaterThan(1);
    expect(JSON.stringify(readiness)).not.toContain("secret");
    expect(JSON.stringify(readiness)).not.toContain("example.test");
  });

  it("selects the dedicated database URL only for the exact isolated staging runtime", () => {
    const databaseUrl =
      "postgresql://staging-user:staging-secret@staging-db.example.test/uais";
    const exactStagingEnv = {
      VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
      UAIS_DEPLOYMENT_ENV: "staging",
      UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
      UAIS_P2_STAGING_DATABASE_URL: databaseUrl,
      NEON_PROJECT_ID: "neon-staging-project-fixture",
    };

    const readiness = getUaisCoreDatabaseReadiness(exactStagingEnv);

    expect(readiness).toMatchObject({
      status: "ready",
      selectedEnvName: UAIS_ISOLATED_STAGING_CORE_DATABASE_ENV_NAME,
      valueRedacted: true,
    });
    expect(readUaisCoreDatabaseUrl(exactStagingEnv)).toBe(databaseUrl);
    expect(JSON.stringify(readiness)).not.toContain("staging-secret");
    expect(JSON.stringify(readiness)).not.toContain("staging-db.example.test");
  });

  it.each([
    ["missing project", { VERCEL_PROJECT_ID: undefined }],
    ["unknown project", { VERCEL_PROJECT_ID: "prj_unknown" }],
    [
      "production project",
      { VERCEL_PROJECT_ID: "prj_MZIjawDPTU4tj4yuTBsd9hyLxHXA" },
    ],
    ["groups disabled", { UAIS_LEARNING_CHATROOM_GROUPS_MODE: "off" }],
    ["deployment marker missing", { UAIS_DEPLOYMENT_ENV: undefined }],
    ["Neon identity missing", { NEON_PROJECT_ID: undefined }],
    ["production Neon identity", { NEON_PROJECT_ID: "late-sunset-59152574" }],
  ])("rejects the dedicated staging URL when %s", (_label, override) => {
    const env = {
      VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
      UAIS_DEPLOYMENT_ENV: "staging",
      UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
      UAIS_P2_STAGING_DATABASE_URL:
        "postgresql://staging-user:staging-secret@staging-db.example.test/uais",
      NEON_PROJECT_ID: "neon-staging-project-fixture",
      ...override,
    };

    expect(getUaisCoreDatabaseReadiness(env)).toMatchObject({ status: "blocked" });
    expect(readUaisCoreDatabaseUrl(env)).toBeUndefined();
  });

  it.each(UAIS_CORE_DATABASE_ENV_NAMES)(
    "rejects populated generic alias %s in the exact staging runtime",
    (genericName) => {
      const env = {
        VERCEL_ENV: "production",
        VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
        UAIS_DEPLOYMENT_ENV: "staging",
        UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
        UAIS_P2_STAGING_DATABASE_URL:
          "postgresql://staging-user:staging-secret@staging-db.example.test/uais",
        NEON_PROJECT_ID: "neon-staging-project-fixture",
        [genericName]: "postgresql://generic-user:generic-secret@db.example.test/uais",
      };

      expect(getUaisCoreDatabaseReadiness(env)).toEqual({
        target: "uais-core-database",
        status: "blocked",
        blockedReason: "missing-managed-postgres-url",
        acceptedEnvNames: [UAIS_ISOLATED_STAGING_CORE_DATABASE_ENV_NAME],
        valueRedacted: true,
      });
      expect(readUaisCoreDatabaseUrl(env)).toBeUndefined();
    },
  );

  it("preserves generic-only production database selection", () => {
    const productionUrl = "postgresql://prod-user:prod-secret@db.example.test/uais";
    const env = {
      VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: "prj_MZIjawDPTU4tj4yuTBsd9hyLxHXA",
      UAIS_DEPLOYMENT_ENV: "production",
      UAIS_CORE_DATABASE_URL: productionUrl,
      UAIS_P2_STAGING_DATABASE_URL:
        "postgresql://staging-user:staging-secret@staging-db.example.test/uais",
    };

    expect(getUaisCoreDatabaseReadiness(env)).toMatchObject({
      status: "ready",
      selectedEnvName: "UAIS_CORE_DATABASE_URL",
    });
    expect(readUaisCoreDatabaseUrl(env)).toBe(productionUrl);
  });

  it("keeps one migration inventory for the runner, the runtime and the readiness report", () => {
    const directoryVersions = readdirSync(join(process.cwd(), "migrations"))
      .filter((entry) => entry.endsWith(".sql"))
      .sort()
      .map((entry) => entry.slice(0, -".sql".length));

    // The directory is the source of truth. This module is the projection that
    // /healthz reads, because a serverless bundle traces `.ts` imports and no
    // `.sql` files - so it has to be pinned here rather than derived there.
    expect(UAIS_CORE_DATABASE_MIGRATIONS.map((migration) => migration.version)).toEqual(
      directoryVersions,
    );
    expect([...UAIS_CORE_DATABASE_MIGRATION_VERSIONS]).toEqual(directoryVersions);

    for (const migration of UAIS_CORE_DATABASE_MIGRATIONS) {
      const sql = readProjectFile(migration.path);
      for (const table of migration.tables) {
        expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      }
    }

    const runner = readProjectFile("scripts/apply-core-migrations.mjs");
    // The runner derives its work list from the directory instead of carrying a
    // second hand-maintained array, which is how it stayed correct while the two
    // literals above it went stale.
    expect(runner).toContain("readdir(join(cwd(), migrationsDirectory))");
    expect(runner).not.toContain('version: "0001_core_poc"');
    // Writer and reader have to agree on the ledger table: the runner inserts
    // into it, and the /healthz currency probe selects from it.
    expect(runner).toContain(
      `CREATE TABLE IF NOT EXISTS ${UAIS_CORE_DATABASE_MIGRATIONS_TABLE}`,
    );
    expect(readProjectFile("src/app/healthz/handler.ts")).toContain(
      `FROM ${UAIS_CORE_DATABASE_MIGRATIONS_TABLE}`,
    );
  });

  it("exports Drizzle tables for the advisory's core entities", () => {
    expect(Object.keys(uaisCoreSchemaTables).sort()).toEqual(
      [
        "assessments",
        "auditLog",
        "classes",
        "courses",
        "enrollments",
        "exportJobs",
        "inviteCodes",
        "learnerProfiles",
        "learningEvents",
        "lessons",
        "providerJobs",
        "recommendations",
        "submissionVersions",
        "feedback",
        "formativeAttempts",
        "xapiOutbox",
        "idempotencyRecords",
        "submissions",
        "users",
      ].sort(),
    );
  });

  it("checks in a migration for the core POC schema and privacy constraints", () => {
    const migration = readProjectFile("migrations/0001_core_poc.sql");

    for (const table of UAIS_CORE_DATABASE_MIGRATIONS[0].tables) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }

    expect(migration).toContain("role IN ('student', 'teacher', 'admin')");
    expect(migration).toContain("UNIQUE (user_id, course_id, class_id)");
    expect(migration).toContain("object_id text NOT NULL");
    expect(migration).toContain("PRIMARY KEY (user_id, course_id)");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS uais_learning_events_user_course_time_idx");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS uais_teaching_course_management_snapshots");
    expect(migration).not.toContain("Phoebe");
    expect(migration).not.toContain("12345");
  });

  it("selects the Postgres teaching-course repository through the existing storage seam", () => {
    expect(() =>
      createUaisTeachingCourseManagementRepository({
        env: {
          UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "postgres",
        },
      }),
    ).toThrowError(TeachingCourseManagementStoreError);

    const repository = createUaisTeachingCourseManagementRepository({
      env: {
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "postgres",
        UAIS_CORE_DATABASE_URL: "postgres://user:secret@example.test/uais",
      },
    });

    expect(repository?.storage).toEqual({
      recordStoragePolicy: "postgres-teaching-course-management-snapshot",
      auditStoragePolicy: "postgres-teaching-course-management-audit-log",
      storageWritePolicy: "postgres-transactional-snapshot-replace",
    });
    expect(JSON.stringify(repository?.storage)).not.toContain("secret");
    expect(JSON.stringify(repository?.storage)).not.toContain("example.test");
  });

  it("documents and scripts the first migration path", () => {
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const vercelConfig = JSON.parse(readProjectFile("vercel.json")) as {
      buildCommand?: string;
    };

    expect(packageJson.dependencies).toMatchObject({
      "@langchain/langgraph-checkpoint-postgres": expect.any(String),
      "drizzle-orm": expect.any(String),
      postgres: expect.any(String),
    });
    expect(packageJson.scripts?.["db:migrate"]).toBe("node scripts/apply-core-migrations.mjs");
    // The operator entry point stays strict; only the BUILD uses --deploy.
    // Coupling `next build` to the strict script is what took the production
    // site stale on 2026-08-08: the Vercel build env had no database URL, the
    // script exited 1, and every subsequent deploy failed silently.
    expect(packageJson.scripts?.["db:migrate:deploy"]).toBe(
      "node scripts/apply-core-migrations.mjs --deploy",
    );
    expect(packageJson.scripts?.["vercel-build"]).toBe(
      "node scripts/vercel-build-dispatch.mjs",
    );
    expect(vercelConfig.buildCommand).toBe("npm run vercel-build");
    const migrationScript = readProjectFile("scripts/apply-core-migrations.mjs");
    expect(migrationScript).toContain("PostgresSaver.fromConnString");
    expect(migrationScript).toContain("PostgresStore.fromConnString");
    expect(migrationScript).toContain("await checkpointer.setup()");
    expect(migrationScript).toContain("await store.setup()");
    expect(migrationScript).toContain('schema: "uais_langgraph"');
    expect(readProjectFile(".env.local.example")).toContain("UAIS_CORE_DATABASE_URL=");
    expect(readProjectFile("docs/core-schema-design.md")).toContain("migrations/0001_core_poc.sql");
  });

  // Run the real script rather than grepping its source: the property that
  // matters is the exit code the Vercel build observes, and a source assertion
  // would still pass if the guards were reordered after `postgres(...)`.
  describe("deploy-mode migration guards", () => {
    async function runMigrationScript(
      args: string[],
      env: Record<string, string | undefined>,
    ) {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      // Strip inherited database URLs so a developer's local .env cannot make
      // this suite talk to a real Postgres.
      const baseEnv = Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) =>
            !["UAIS_CORE_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL", "VERCEL_ENV"].includes(
              name,
            ),
        ),
      );
      try {
        const { stdout } = await promisify(execFile)(
          process.execPath,
          ["scripts/apply-core-migrations.mjs", ...args],
          { cwd: process.cwd(), env: { ...baseEnv, ...env } as NodeJS.ProcessEnv },
        );
        return { code: 0, stdout };
      } catch (error) {
        const failure = error as { code?: number; stdout?: string; stderr?: string };
        return {
          code: failure.code ?? 1,
          stdout: failure.stdout ?? "",
          stderr: failure.stderr ?? "",
        };
      }
    }

    it("fails the strict operator run when no database URL is configured", async () => {
      const result = await runMigrationScript([], {});

      expect(result.code).toBe(1);
    });

    it("skips instead of failing the build when the build env has no database URL", async () => {
      const result = await runMigrationScript(["--deploy"], {});

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({
        status: "skipped",
        skippedReason: "missing-database-url",
      });
    });

    it("refuses to migrate from a non-production Vercel deployment", async () => {
      // A URL IS present here: preview deployments share the project's
      // environment, so the old build command let any preview branch apply
      // migrations to the production database.
      const result = await runMigrationScript(["--deploy"], {
        UAIS_CORE_DATABASE_URL: "postgres://user:pw@db.example.test/uais",
        VERCEL_ENV: "preview",
      });

      expect(result.code).toBe(0);
      const report = JSON.parse(result.stdout.trim());
      expect(report).toMatchObject({
        status: "skipped",
        skippedReason: "non-production-vercel-deployment",
      });
      expect(JSON.stringify(report)).not.toContain("db.example.test");
    });
  });

  it("documents the provisioned Neon production path and migration-gated Vercel build", () => {
    const readme = readProjectFile("README.md");

    expect(readme).toContain("dedicated Neon Launch resource is provisioned");
    expect(readme).toContain("`npm run vercel-build` applies");
  });
});
