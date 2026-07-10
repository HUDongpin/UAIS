import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  UAIS_CORE_DATABASE_ENV_NAMES,
  getUaisCoreDatabaseReadiness,
} from "@/lib/db/core-database";
import { UAIS_CORE_DATABASE_MIGRATIONS } from "@/lib/db/migrations";
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
      migrations: ["0001_core_poc"],
      valueRedacted: true,
    });
    expect(JSON.stringify(readiness)).not.toContain("secret");
    expect(JSON.stringify(readiness)).not.toContain("example.test");
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
    expect(packageJson.scripts?.["vercel-build"]).toBe("npm run db:migrate && next build");
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

  it("documents the provisioned Neon production path and migration-gated Vercel build", () => {
    const readme = readProjectFile("README.md");

    expect(readme).toContain("dedicated Neon Launch resource is provisioned");
    expect(readme).toContain("`npm run vercel-build` applies");
  });
});
