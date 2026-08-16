import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getUaisCoreDatabasePool,
  resetUaisCoreDatabasePoolForTesting,
} from "@/lib/db/core-database";
import {
  backfillTeachingCourseManagementToPostgres,
  verifyTeachingCourseManagementParity,
} from "@/lib/server/teaching-course-management-cutover";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  normalizeTeachingCourseManagementDatabase,
  readTeachingCourseManagementDatabase,
  readTeachingCourseManagementSnapshot,
} from "@/lib/server/teaching-course-management-store";
import type {
  TeachingCourseManagementDatabase,
  TeachingCourseRecord,
} from "@/lib/server/teaching-course-management-types";

// Phase 1 full expand -> migrate -> contract cutover for one entity
// (teaching-course-management), verified end-to-end against a real Postgres.
// SKIPS unless UAIS_CORE_DATABASE_URL points at a reachable Postgres. Reproduce:
//   docker run -d --name uais-local-pg -e POSTGRES_PASSWORD=<local> \
//     -e POSTGRES_DB=uais_core -p 55432:5432 postgres:16
//   UAIS_CORE_DATABASE_URL=postgresql://postgres:<local>@127.0.0.1:55432/uais_core npm run db:migrate
//   UAIS_CORE_DATABASE_URL=postgresql://postgres:<local>@127.0.0.1:55432/uais_core \
//     npx vitest run tests/teaching-course-management-cutover-integration.test.ts
// Run DB integration tests individually or with --no-file-parallelism: they
// share the single "default" snapshot key, so parallel files would collide.
const databaseUrl = process.env.UAIS_CORE_DATABASE_URL?.trim();

function buildCourse(courseId: string, courseName: string): TeachingCourseRecord {
  return {
    courseId,
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
    storagePolicy: "local-json-teaching-course-management",
    storageWritePolicy: "atomic-json-file-replace",
    responsibleSession: "S12",
    redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
  };
}

function buildDatabase(courses: TeachingCourseRecord[]): TeachingCourseManagementDatabase {
  return normalizeTeachingCourseManagementDatabase({
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: "2026-07-18T10:00:00.000Z",
    courses,
    classes: [],
    memberships: [],
    auditEvents: [],
  });
}

async function seedJsonFile(dataDir: string, database: TeachingCourseManagementDatabase) {
  await writeFile(
    join(dataDir, "teaching-course-management.json"),
    JSON.stringify(database),
    "utf8",
  );
}

const cutoverCourseKeys = ["course-a", "course-b"];

describe.skipIf(!databaseUrl)(
  "teaching-course-management durable cutover (integration)",
  () => {
    // Parity is a WHOLE-CORPUS property: the gate reads every course row there
    // is and compares it with the whole file corpus. Since the per-course re-key
    // each course is its own row rather than a shared 'default' one the next
    // writer overwrites, so a row another suite left behind is real drift as far
    // as this gate is concerned. Every suite in the `npm run test:db` lane now
    // deletes its own rows; this check turns a leftover into an answer instead
    // of an unexplained "expected parity, received mismatch".
    beforeAll(async () => {
      const client = getUaisCoreDatabasePool({
        env: { UAIS_CORE_DATABASE_URL: databaseUrl },
      });
      const rows = (await client.sql`
        SELECT snapshot_key
        FROM uais_teaching_course_management_snapshots
        ORDER BY snapshot_key
      `) as Array<{ snapshot_key: string }>;
      if (rows.length > 0) {
        throw new Error(
          `Teaching course management cutover parity needs the corpus to itself; ${rows.length} course row(s) were already present. Point the lane at a fresh database (see npm run test:db).`,
        );
      }
    }, 60_000);

    afterAll(async () => {
      const client = getUaisCoreDatabasePool({
        env: { UAIS_CORE_DATABASE_URL: databaseUrl },
      });
      await client.sql`
        DELETE FROM uais_teaching_class_invite_code_claims
        WHERE course_id = ANY(${cutoverCourseKeys})
      `;
      await client.sql`
        DELETE FROM uais_teaching_course_management_snapshots
        WHERE snapshot_key = ANY(${cutoverCourseKeys})
      `;
      await resetUaisCoreDatabasePoolForTesting();
    }, 60_000);

    it("backfills JSON -> Postgres, verifies parity, switches reads, and rolls back safely", async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "uais-cutover-"));
      // Isolated snapshot key namespace is not needed: a fresh migrated DB starts empty.
      const env = { UAIS_CORE_DATABASE_URL: databaseUrl };
      try {
        // EXPAND baseline: the JSON file is the current durable source of truth.
        // TWO courses, listed in an order the managed side cannot reproduce: the
        // store keeps one row per course and a corpus read returns them in
        // snapshot_key order, so `course-b` first is exactly the case a byte
        // comparison of the two corpora reports as drift when nothing drifted.
        const seeded = buildDatabase([
          buildCourse("course-b", "Research Methods B"),
          buildCourse("course-a", "Research Methods A"),
        ]);
        await seedJsonFile(dataDir, seeded);
        const fromFile = await readTeachingCourseManagementDatabase({ dataDir });
        expect(fromFile.courses).toHaveLength(2);

        // MIGRATE: backfill the JSON snapshot into managed Postgres and verify
        // parity. The backfill writes course by course - a corpus-wide write is
        // not expressible against per-course rows, and asking for one is a 500.
        const backfill = await backfillTeachingCourseManagementToPostgres({
          env,
          sourceDataDir: dataDir,
        });
        expect(backfill.status).toBe("parity");
        expect(backfill.entityCounts.courses).toBe(2);
        expect(backfill.managedRevision).toBeTruthy();
        // Redaction: the parity result must not leak record contents.
        expect(JSON.stringify(backfill)).not.toContain("Research Methods A");

        // MIGRATE gate: the read-only parity check also reports parity.
        const parity = await verifyTeachingCourseManagementParity({
          env,
          sourceDataDir: dataDir,
        });
        expect(parity.status).toBe("parity");

        // MIGRATE is re-runnable: "run it repeatedly until parity holds" means
        // the second run replaces the rows the first one wrote, under their
        // revisions.
        const rerun = await backfillTeachingCourseManagementToPostgres({
          env,
          sourceDataDir: dataDir,
        });
        expect(rerun.status).toBe("parity");

        // CONTRACT (switch reads): the store's resolver returns the Postgres
        // repository when the backend flag is set, and it serves the same data.
        const postgresRepository = createUaisTeachingCourseManagementRepository({
          env: {
            UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "postgres",
            UAIS_CORE_DATABASE_URL: databaseUrl,
          },
        });
        expect(postgresRepository).toBeDefined();
        const viaPostgres = await readTeachingCourseManagementSnapshot({
          repository: postgresRepository,
        });
        // The corpus read merges the rows in snapshot_key order, which is NOT
        // the order the file listed them in.
        expect(viaPostgres.database.courses.map((course) => course.courseId)).toEqual([
          "course-a",
          "course-b",
        ]);

        // CONTRACT (rollback): reads without the flag return to the untouched JSON
        // file, so a rollback loses no data - including its own record order.
        const rolledBack = await readTeachingCourseManagementSnapshot({ dataDir });
        expect(rolledBack.database).toEqual(seeded);

        // DRIFT DETECTION: mutating the source after backfill makes parity fail,
        // proving the gate would block a premature read-switch.
        await seedJsonFile(
          dataDir,
          buildDatabase([
            buildCourse("course-b", "Research Methods B"),
            buildCourse("course-a", "Research Methods A Renamed"),
          ]),
        );
        const drift = await verifyTeachingCourseManagementParity({
          env,
          sourceDataDir: dataDir,
        });
        expect(drift.status).toBe("mismatch");
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    });
  },
);
