import { describe, expect, it } from "vitest";
import { createUaisTeachingCourseManagementPostgresRepository } from "@/lib/server/teaching-course-management-postgres-store";
import { normalizeTeachingCourseManagementDatabase } from "@/lib/server/teaching-course-management-store";
import type {
  TeachingCourseManagementDatabase,
  TeachingCourseRecord,
} from "@/lib/server/teaching-course-management-types";

// Phase 1 "migrate"-step verification: a real round-trip against the managed
// Postgres teaching-course-management adapter, proving durable persistence and
// optimistic-concurrency behavior end-to-end.
//
// This is a DB-backed integration test. It SKIPS unless UAIS_CORE_DATABASE_URL
// points at a reachable Postgres, so the normal suite and CI stay DB-free. To
// run it locally against an ephemeral Postgres:
//
//   docker run -d --name uais-local-pg -e POSTGRES_PASSWORD=uais_local_dev \
//     -e POSTGRES_DB=uais_core -p 55432:5432 postgres:16
//   UAIS_CORE_DATABASE_URL="postgresql://postgres:uais_local_dev@127.0.0.1:55432/uais_core" \
//     npm run db:migrate
//   UAIS_CORE_DATABASE_URL="postgresql://postgres:uais_local_dev@127.0.0.1:55432/uais_core" \
//     npx vitest run tests/teaching-course-management-postgres-integration.test.ts
const databaseUrl = process.env.UAIS_CORE_DATABASE_URL?.trim();

describe.skipIf(!databaseUrl)(
  "teaching-course-management Postgres adapter (integration)",
  () => {
    const env = { UAIS_CORE_DATABASE_URL: databaseUrl };

    function buildDatabase(courseName: string): TeachingCourseManagementDatabase {
      const course: TeachingCourseRecord = {
        courseId: "teacher-kang-course-pg-parity",
        ownerTeacherId: "teacher-kang",
        courseName,
        instructor: "Kang Xia",
        unit: "Guangzhou University 404",
        department: "Experimental Teaching Center",
        semester: "2026 Spring",
        status: "draft",
        students: 0,
        createdAt: "2026-07-18T10:00:00.000Z",
        updatedAt: "2026-07-18T10:00:00.000Z",
        storagePolicy: "postgres-teaching-course-management-snapshot",
        storageWritePolicy: "postgres-transactional-snapshot-replace",
        responsibleSession: "S12",
        redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
      };
      return normalizeTeachingCourseManagementDatabase({
        schemaVersion: "uais-teaching-course-management-v1",
        updatedAt: "2026-07-18T10:00:00.000Z",
        courses: [course],
        classes: [],
        memberships: [],
        auditEvents: [],
      });
    }

    it("persists a snapshot and reads it back with parity", async () => {
      const repository = createUaisTeachingCourseManagementPostgresRepository({ env });
      const database = buildDatabase("Postgres Parity Research Methods");
      // Guard: the course must survive normalization, else the parity below is vacuous.
      expect(database.courses).toHaveLength(1);

      await repository.write({ database });
      const snapshot = await repository.read();

      expect(snapshot.database).toEqual(database);
      expect(snapshot.revision).toBeTruthy();
    });

    it("rejects a write with a stale expectedRevision (optimistic concurrency)", async () => {
      const repository = createUaisTeachingCourseManagementPostgresRepository({ env });
      const database = buildDatabase("Postgres Concurrency Research Methods");

      await repository.write({ database });
      const persisted = await repository.read();
      const currentRevision = persisted.revision;
      expect(currentRevision).toBeTruthy();

      await expect(
        repository.write({
          database: buildDatabase("Should Not Persist"),
          expectedRevision: "rev-stale-000000000000000000000000",
        }),
      ).rejects.toThrow();

      // The rejected write must not have changed the stored snapshot.
      const afterConflict = await repository.read();
      expect(afterConflict.revision).toBe(currentRevision);
      expect(afterConflict.database.courses[0]?.courseName).toBe(
        "Postgres Concurrency Research Methods",
      );
    });
  },
);
