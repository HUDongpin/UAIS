import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { createUaisCoreDatabase, getUaisCoreDatabaseReadiness } from "@/lib/db/core-database";
import {
  TeachingCourseManagementStoreError,
  normalizeTeachingCourseManagementDatabase,
  type TeachingCourseManagementDatabase,
  type TeachingCourseManagementRepository,
  type TeachingCourseManagementStorageDescriptor,
} from "@/lib/server/teaching-course-management-store";

const snapshotKey = "default";

const postgresTeachingCourseManagementStorage: TeachingCourseManagementStorageDescriptor = {
  recordStoragePolicy: "postgres-teaching-course-management-snapshot",
  auditStoragePolicy: "postgres-teaching-course-management-audit-log",
  storageWritePolicy: "postgres-transactional-snapshot-replace",
};

export function isUaisTeachingCourseManagementPostgresSelector(value: string | undefined) {
  const selector = value?.trim().toLowerCase();
  return selector === "postgres" || selector === "managed";
}

export function createUaisTeachingCourseManagementPostgresRepository(input: {
  env: Record<string, string | undefined>;
}): TeachingCourseManagementRepository {
  const readiness = getUaisCoreDatabaseReadiness(input.env);
  if (readiness.status !== "ready") {
    throw new TeachingCourseManagementStoreError(
      503,
      "Postgres teaching course management storage requires UAIS_CORE_DATABASE_URL.",
      {
        coreDatabase: readiness,
      },
    );
  }

  return {
    storage: postgresTeachingCourseManagementStorage,
    read: async () => {
      const client = createUaisCoreDatabase({ env: input.env, max: 1 });
      try {
        const rows = await client.sql`
          SELECT database, revision
          FROM uais_teaching_course_management_snapshots
          WHERE snapshot_key = ${snapshotKey}
        `;

        if (rows.length === 0) {
          return {
            database: createEmptyDatabase(),
          };
        }

        const row = rows[0] as {
          database?: unknown;
          revision?: unknown;
        };
        const revision = typeof row.revision === "string" ? row.revision.trim() : "";
        return {
          database: normalizeTeachingCourseManagementDatabase(row.database),
          ...(revision ? { revision } : {}),
        };
      } finally {
        await client.sql.end({ timeout: 5 });
      }
    },
    write: async ({ database, expectedRevision }) => {
      const normalizedDatabase = normalizeTeachingCourseManagementDatabase(database);
      const revision = createTeachingCourseManagementSnapshotRevision(normalizedDatabase);
      const client = createUaisCoreDatabase({ env: input.env, max: 1 });
      try {
        await client.sql.begin(async (sql: TransactionSql) => {
          const rows = await sql`
            SELECT revision
            FROM uais_teaching_course_management_snapshots
            WHERE snapshot_key = ${snapshotKey}
            FOR UPDATE
          `;
          const currentRevision =
            typeof rows[0]?.revision === "string" ? rows[0].revision.trim() : undefined;
          if (expectedRevision && currentRevision && currentRevision !== expectedRevision) {
            throw new TeachingCourseManagementStoreError(
              409,
              "Postgres teaching course management snapshot changed; retry required.",
            );
          }

          await sql`
            INSERT INTO uais_teaching_course_management_snapshots (
              snapshot_key,
              database,
              revision,
              updated_at
            )
            VALUES (
              ${snapshotKey},
              ${sql.json(normalizedDatabase)},
              ${revision},
              now()
            )
            ON CONFLICT (snapshot_key)
            DO UPDATE SET
              database = EXCLUDED.database,
              revision = EXCLUDED.revision,
              updated_at = EXCLUDED.updated_at
          `;
        });
      } finally {
        await client.sql.end({ timeout: 5 });
      }
    },
  };
}

function createTeachingCourseManagementSnapshotRevision(
  database: TeachingCourseManagementDatabase,
) {
  return `rev-${createHash("sha256").update(JSON.stringify(database)).digest("hex").slice(0, 24)}`;
}

function createEmptyDatabase(): TeachingCourseManagementDatabase {
  return {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    courses: [],
    classes: [],
    memberships: [],
    auditEvents: [],
  };
}
