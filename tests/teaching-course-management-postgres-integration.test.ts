import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getUaisCoreDatabasePool,
  resetUaisCoreDatabasePoolForTesting,
} from "@/lib/db/core-database";
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
//     npm run test:db
const databaseUrl = process.env.UAIS_CORE_DATABASE_URL?.trim();

describe.skipIf(!databaseUrl)(
  "teaching-course-management Postgres adapter (integration)",
  () => {
    const env = { UAIS_CORE_DATABASE_URL: databaseUrl };

    // The migration runner itself, not a copy of its SQL. This suite used to
    // require an out-of-band `npm run db:migrate` and failed with a raw
    // "relation does not exist" when the operator had not run one, which is an
    // unhelpful way to report "the lane was set up wrong".
    beforeAll(async () => {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      await promisify(execFile)(process.execPath, ["scripts/apply-core-migrations.mjs"], {
        cwd: process.cwd(),
        env: { ...process.env, UAIS_CORE_DATABASE_URL: databaseUrl } as NodeJS.ProcessEnv,
      });
    }, 180_000);

    // The store borrows a module-scoped pool; dropping it stops this file from
    // leaking connections into the rest of a run.
    //
    // The rows go with it. Since the per-course re-key each of these courses is
    // its OWN row rather than a shared 'default' one the next suite overwrites,
    // so leftovers accumulate - and the cutover suite in the same lane gates on
    // a CORPUS-wide parity check, which reads every course row there is. A
    // suite that leaves its fixtures behind reports as drift in another one.
    afterAll(async () => {
      const client = getUaisCoreDatabasePool({ env });
      await client.sql`
        DELETE FROM uais_teaching_class_invite_code_claims
        WHERE course_id LIKE 'teacher-kang-course-pg-%'
      `;
      await client.sql`
        DELETE FROM uais_teaching_course_management_snapshots
        WHERE snapshot_key LIKE 'teacher-kang-course-pg-%'
      `;
      await resetUaisCoreDatabasePoolForTesting();
    }, 60_000);

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

    // Since the per-course re-key every call names its course; `courseId` is the
    // snapshot key, and an unscoped write is refused outright.
    const courseId = "teacher-kang-course-pg-parity";

    it("persists a course's row and reads it back with parity", async () => {
      const repository = createUaisTeachingCourseManagementPostgresRepository({ env });
      const database = buildDatabase("Postgres Parity Research Methods");
      // Guard: the course must survive normalization, else the parity below is vacuous.
      expect(database.courses).toHaveLength(1);

      // Read first, always. The guard is strict equality now, so a writer that
      // claims no revision is claiming the row does not exist - that is what
      // stops a second request from silently overwriting the course a
      // simultaneous first request just created.
      const existing = await repository.read({ courseId });
      await repository.write({
        database,
        courseId,
        ...(existing.revision ? { expectedRevision: existing.revision } : {}),
      });
      const snapshot = await repository.read({ courseId });

      expect(snapshot.database).toEqual(database);
      expect(snapshot.revision).toBeTruthy();
    });

    it("rejects a write with a stale expectedRevision (optimistic concurrency)", async () => {
      const repository = createUaisTeachingCourseManagementPostgresRepository({ env });
      const database = buildDatabase("Postgres Concurrency Research Methods");

      const persistedBefore = await repository.read({ courseId });
      await repository.write({
        database,
        courseId,
        ...(persistedBefore.revision ? { expectedRevision: persistedBefore.revision } : {}),
      });
      const persisted = await repository.read({ courseId });
      const currentRevision = persisted.revision;
      expect(currentRevision).toBeTruthy();

      await expect(
        repository.write({
          database: buildDatabase("Should Not Persist"),
          courseId,
          expectedRevision: "rev-stale-000000000000000000000000",
        }),
      ).rejects.toThrow();

      // The rejected write must not have changed the stored snapshot.
      const afterConflict = await repository.read({ courseId });
      expect(afterConflict.revision).toBe(currentRevision);
      expect(afterConflict.database.courses[0]?.courseName).toBe(
        "Postgres Concurrency Research Methods",
      );
    });

    it("keeps two courses out of each other's rows and still enumerates both", async () => {
      const repository = createUaisTeachingCourseManagementPostgresRepository({ env });
      const otherCourseId = "teacher-kang-course-pg-parity-second";
      const other = normalizeTeachingCourseManagementDatabase({
        ...buildDatabase("Postgres Second Course"),
        courses: [
          {
            ...buildDatabase("Postgres Second Course").courses[0],
            courseId: otherCourseId,
          },
        ],
      });

      const existing = await repository.read({ courseId: otherCourseId });
      await repository.write({
        database: other,
        courseId: otherCourseId,
        ...(existing.revision ? { expectedRevision: existing.revision } : {}),
      });

      // Writing the second course must not have touched the first course's row.
      const first = await repository.read({ courseId });
      expect(first.database.courses.map((course) => course.courseId)).toEqual([courseId]);

      const corpus = await repository.read();
      expect(corpus.database.courses.map((course) => course.courseId)).toEqual(
        expect.arrayContaining([courseId, otherCourseId]),
      );
      // No single row backs a corpus read, so it carries no revision.
      expect(corpus.revision).toBeUndefined();
    });

    // The invite-code namespace is the one invariant a per-course row cannot
    // hold, so it lives in its own table and is reconciled inside the course
    // row's transaction. That reconciliation is real SQL against a real unique
    // index; a unit double can only prove the store issues it.
    it("refuses a class invite code another course already claimed", async () => {
      const repository = createUaisTeachingCourseManagementPostgresRepository({ env });
      const holderCourseId = "teacher-kang-course-pg-invite-holder";
      const rivalCourseId = "teacher-kang-course-pg-invite-rival";
      const invitationCode = "59395057";

      const withClass = (ownerCourseId: string) =>
        normalizeTeachingCourseManagementDatabase({
          ...buildDatabase("Postgres Invite Code Course"),
          courses: [
            {
              ...buildDatabase("Postgres Invite Code Course").courses[0],
              courseId: ownerCourseId,
            },
          ],
          classes: [
            {
              classId: `${ownerCourseId}-class-1`,
              courseId: ownerCourseId,
              ownerTeacherId: "teacher-kang",
              className: "Class One",
              students: 0,
              semester: "2026 Spring",
              invitationCode,
              joinUrl: `/courses?invite=${invitationCode}`,
              createdAt: "2026-07-18T10:00:00.000Z",
              updatedAt: "2026-07-18T10:00:00.000Z",
              storagePolicy: "postgres-teaching-course-management-snapshot",
              storageWritePolicy: "postgres-transactional-snapshot-replace",
              responsibleSession: "S12",
              redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
            },
          ],
        });

      // This suite runs against a database that outlives it, so the code is
      // released from both courses before the scenario starts. Releasing is the
      // same operation a rolled-back course creation performs.
      for (const ownerCourseId of [holderCourseId, rivalCourseId]) {
        const current = await repository.read({ courseId: ownerCourseId });
        await repository.write({
          database: { ...withClass(ownerCourseId), classes: [] },
          courseId: ownerCourseId,
          ...(current.revision ? { expectedRevision: current.revision } : {}),
        });
      }

      const holderBefore = await repository.read({ courseId: holderCourseId });
      await repository.write({
        database: withClass(holderCourseId),
        courseId: holderCourseId,
        ...(holderBefore.revision ? { expectedRevision: holderBefore.revision } : {}),
      });

      const rivalBefore = await repository.read({ courseId: rivalCourseId });
      await expect(
        repository.write({
          database: withClass(rivalCourseId),
          courseId: rivalCourseId,
          ...(rivalBefore.revision ? { expectedRevision: rivalBefore.revision } : {}),
        }),
      ).rejects.toThrow(/invite code already exists/);

      // The rejected write rolled back with the claim, so the rival course's row
      // did not gain a class reachable by someone else's code.
      const rivalAfter = await repository.read({ courseId: rivalCourseId });
      expect(rivalAfter.database.classes).toHaveLength(0);
      const holderAfter = await repository.read({ courseId: holderCourseId });
      expect(holderAfter.database.classes[0]?.invitationCode).toBe(invitationCode);

      // Releasing the code frees it for whoever asks next.
      await repository.write({
        database: { ...holderAfter.database, classes: [] },
        courseId: holderCourseId,
        ...(holderAfter.revision ? { expectedRevision: holderAfter.revision } : {}),
      });
      const rivalRetry = await repository.read({ courseId: rivalCourseId });
      await repository.write({
        database: withClass(rivalCourseId),
        courseId: rivalCourseId,
        ...(rivalRetry.revision ? { expectedRevision: rivalRetry.revision } : {}),
      });
      const rivalClaimed = await repository.read({ courseId: rivalCourseId });
      expect(rivalClaimed.database.classes[0]?.invitationCode).toBe(invitationCode);
    });
  },
);
