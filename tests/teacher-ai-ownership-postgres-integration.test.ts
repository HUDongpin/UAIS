import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getUaisCoreDatabasePool,
  resetUaisCoreDatabasePoolForTesting,
} from "@/lib/db/core-database";
import { createUaisTeacherAiOwnershipPostgresRepository } from "@/lib/server/teacher-ai-ownership-store";

const databaseUrl = process.env.UAIS_CORE_DATABASE_URL?.trim();

describe.skipIf(!databaseUrl)("teacher AI ownership Postgres adapter (integration)", () => {
  const env = { UAIS_CORE_DATABASE_URL: databaseUrl };
  const teacherId = "teacher-ownership-pg-integration";
  const courseId = "teacher-ownership-pg-course";

  beforeAll(async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)(process.execPath, ["scripts/apply-core-migrations.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, UAIS_CORE_DATABASE_URL: databaseUrl } as NodeJS.ProcessEnv,
    });

    const client = getUaisCoreDatabasePool({ env });
    await client.sql`
      DELETE FROM uais_teacher_ai_ownership
      WHERE teacher_id = ${teacherId}
    `;
    await client.sql`
      DELETE FROM uais_teaching_course_management_snapshots
      WHERE snapshot_key = ${courseId}
    `;
    await client.sql`
      INSERT INTO uais_teaching_course_management_snapshots (
        snapshot_key,
        database,
        revision,
        updated_at
      ) VALUES (
        ${courseId},
        ${JSON.stringify({
          schemaVersion: "uais-teaching-course-management-v1",
          updatedAt: "2026-08-24T02:00:00.000Z",
          courses: [
            {
              courseId,
              ownerTeacherId: teacherId,
              status: "draft",
            },
          ],
        })}::text::jsonb,
        'rev-teacher-ownership-pg-integration',
        now()
      )
    `;
  }, 180_000);

  afterAll(async () => {
    const client = getUaisCoreDatabasePool({ env });
    await client.sql`
      DELETE FROM uais_teacher_ai_ownership
      WHERE teacher_id = ${teacherId}
    `;
    await client.sql`
      DELETE FROM uais_teaching_course_management_snapshots
      WHERE snapshot_key = ${courseId}
    `;
    await resetUaisCoreDatabasePoolForTesting();
  }, 60_000);

  it("serializes simultaneous first merges and preserves both resources", async () => {
    const repository = createUaisTeacherAiOwnershipPostgresRepository({ env });

    await Promise.all([
      repository.merge({
        ownership: {
          teacherId,
          courseIds: [courseId],
          sampleAssets: [{ sampleAssetId: "sample-concurrent-a", courseId }],
        },
      }),
      repository.merge({
        ownership: {
          teacherId,
          courseIds: [courseId],
          sampleAssets: [{ sampleAssetId: "sample-concurrent-b", courseId }],
        },
      }),
    ]);

    const ownership = await repository.read({ teacherId });
    expect(ownership?.courseIds).toEqual([courseId]);
    expect(ownership?.sampleAssets).toEqual(
      expect.arrayContaining([
        { sampleAssetId: "sample-concurrent-a", courseId },
        { sampleAssetId: "sample-concurrent-b", courseId },
      ]),
    );
    expect(ownership?.sampleAssets).toHaveLength(2);
  }, 120_000);

  it("stops granting course-bound resources when the canonical course ACL disappears", async () => {
    const client = getUaisCoreDatabasePool({ env });
    await client.sql`
      UPDATE uais_teaching_course_management_snapshots
      SET database = jsonb_set(database, '{courses}', '[]'::jsonb),
          revision = 'rev-teacher-ownership-pg-revoked',
          updated_at = now()
      WHERE snapshot_key = ${courseId}
    `;

    const repository = createUaisTeacherAiOwnershipPostgresRepository({ env });
    const ownership = await repository.read({ teacherId });
    expect(ownership).toEqual({
      teacherId,
      courseIds: [],
      sampleAssets: [],
      pptAssets: [],
      clonedVoiceRefs: [],
      audioManifests: [],
    });
  }, 120_000);
});
