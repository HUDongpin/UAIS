import { describe, expect, it } from "vitest";
import {
  createUaisTeacherAiOwnershipAdapter,
  createUaisTeacherAiOwnershipMergeAdapter,
  createUaisTeacherAiOwnershipPostgresRepository,
} from "@/lib/server/teacher-ai-ownership-store";
import type { UaisTeacherAiResourceOwnership } from "@/lib/server/ai-resource-grants";
import { buildDeploymentReadinessGate } from "@/lib/ai/providers/smoke-plan";

type SqlInvocation = {
  statement: string;
  values: unknown[];
};

function createScriptedDatabase(
  execute: (invocation: SqlInvocation) => Promise<unknown[]> | unknown[],
) {
  const invocations: SqlInvocation[] = [];
  let ended = 0;
  const sql = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const invocation = {
        statement: strings.join(" ? ").replace(/\s+/g, " ").trim(),
        values,
      };
      invocations.push(invocation);
      return execute(invocation);
    },
    {
      begin: async (run: (transactionSql: typeof sql) => Promise<void>) => run(sql),
      end: async () => {
        ended += 1;
      },
    },
  );

  return {
    database: { sql },
    invocations,
    get ended() {
      return ended;
    },
  };
}

const authenticatedTeacher = {
  sessionId: "session-teacher-kang",
  actorId: "teacher-kang",
  role: "teacher" as const,
  authenticatedAt: "2026-08-24T01:00:00.000Z",
  expiresAt: "2026-08-24T02:00:00.000Z",
};

describe("Postgres teacher AI ownership repository", () => {
  it("reports the implemented Postgres ownership backend ready only with core DB configuration", () => {
    const configured = buildDeploymentReadinessGate({
      env: {
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "postgres",
        UAIS_CORE_DATABASE_URL: "postgres://user:secret@example.test/uais",
      },
    });
    const configuredCheck = configured.checks.find(
      (check) => check.id === "s12-teacher-ownership-backend",
    );
    expect(configuredCheck).toEqual(
      expect.objectContaining({
        status: "ready",
        backendContract: expect.objectContaining({
          backendKind: "postgres",
          durability: "durable",
          adapterStatus: "implemented",
          productionStatus: "ready",
        }),
      }),
    );
    expect(JSON.stringify(configuredCheck)).not.toContain("secret");
    expect(JSON.stringify(configuredCheck)).not.toContain("example.test");

    const missingDatabase = buildDeploymentReadinessGate({
      env: { UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "postgres" },
    });
    expect(
      missingDatabase.checks.find(
        (check) => check.id === "s12-teacher-ownership-backend",
      ),
    ).toEqual(
      expect.objectContaining({
        status: "blocked",
        backendContract: expect.objectContaining({
          backendKind: "postgres",
          durability: "durable",
          adapterStatus: "implemented",
          productionStatus: "blocked",
          blockedReason: "missing-durable-env-UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
        }),
      }),
    );
  });

  it("fails closed when Postgres is selected without a managed database URL", () => {
    expect(
      createUaisTeacherAiOwnershipAdapter({
        env: { UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "postgres" },
      }),
    ).toBeUndefined();
    expect(
      createUaisTeacherAiOwnershipMergeAdapter({
        env: { UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "managed" },
      }),
    ).toBeUndefined();
    expect(() =>
      createUaisTeacherAiOwnershipPostgresRepository({
        env: { UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "postgres" },
      }),
    ).toThrow(/managed Postgres/i);
  });

  it("reads canonical course ownership and returns only display-safe resource identifiers", async () => {
    const scripted = createScriptedDatabase(({ statement }) => {
      if (statement.includes("FROM uais_teaching_course_management_snapshots")) {
        return [
          {
            course_ids: ["course-owned"],
            resources: {
              sampleAssets: [
                {
                  sampleAssetId: "sample-owned",
                  courseId: "course-owned",
                  privateSourcePath: "/private/teacher.wav",
                },
                { sampleAssetId: "sample-revoked", courseId: "course-revoked" },
              ],
              pptAssets: [
                { pptAssetId: "ppt-owned", courseId: "course-owned" },
                { pptAssetId: "ppt-revoked", courseId: "course-revoked" },
              ],
              clonedVoiceRefs: [
                { voiceRefId: "voice-owned", sampleAssetId: "sample-owned" },
                { voiceRefId: "voice-revoked", sampleAssetId: "sample-revoked" },
              ],
              audioManifests: [
                {
                  audioManifestId: "audio-owned",
                  courseId: "course-owned",
                  pptAssetId: "ppt-owned",
                  voiceRefId: "voice-owned",
                },
                {
                  audioManifestId: "audio-revoked",
                  courseId: "course-revoked",
                  pptAssetId: "ppt-revoked",
                  voiceRefId: "voice-revoked",
                },
              ],
            },
          },
        ];
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    });
    const adapter = createUaisTeacherAiOwnershipAdapter({
      env: {
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "postgres",
        UAIS_CORE_DATABASE_URL: "postgres://redacted.example.test/uais",
      },
      createDatabase: () => scripted.database,
    });

    expect(adapter).toBeDefined();
    const ownership = await adapter?.({
      request: new Request("http://localhost/api/ai/session"),
      authenticatedSession: authenticatedTeacher,
    });

    expect(ownership).toEqual({
      teacherId: "teacher-kang",
      courseIds: ["course-owned"],
      sampleAssets: [{ sampleAssetId: "sample-owned", courseId: "course-owned" }],
      pptAssets: [{ pptAssetId: "ppt-owned", courseId: "course-owned" }],
      clonedVoiceRefs: [{ voiceRefId: "voice-owned", sampleAssetId: "sample-owned" }],
      audioManifests: [
        {
          audioManifestId: "audio-owned",
          courseId: "course-owned",
          pptAssetId: "ppt-owned",
          voiceRefId: "voice-owned",
        },
      ],
    });
    expect(JSON.stringify(ownership)).not.toContain("private/teacher.wav");
    expect(JSON.stringify(ownership)).not.toContain("revoked");
    expect(scripted.invocations[0]?.values).toEqual(["teacher-kang", "teacher-kang"]);
    expect(scripted.ended).toBe(1);
  });

  it("atomically merges redacted resources without duplicating the canonical course ACL", async () => {
    const scripted = createScriptedDatabase(({ statement }) => {
      if (statement.includes("FROM uais_teaching_course_management_snapshots")) {
        return [{ course_id: "course-owned" }];
      }
      if (statement.startsWith("INSERT INTO uais_teacher_ai_ownership")) {
        return [];
      }
      if (
        statement.includes("SELECT resources") &&
        statement.includes("FROM uais_teacher_ai_ownership")
      ) {
        return [
          {
            resources: {
              sampleAssets: [
                { sampleAssetId: "sample-existing", courseId: "course-owned" },
              ],
              pptAssets: [],
              clonedVoiceRefs: [],
              audioManifests: [],
            },
          },
        ];
      }
      if (statement.startsWith("UPDATE uais_teacher_ai_ownership")) {
        return [{ teacher_id: "teacher-kang" }];
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    });
    const merge = createUaisTeacherAiOwnershipMergeAdapter({
      env: {
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "managed",
        UAIS_CORE_DATABASE_URL: "postgres://redacted.example.test/uais",
      },
      createDatabase: () => scripted.database,
    });

    expect(merge).toBeDefined();
    const receipt = await merge?.({
      updatedAt: "2026-08-24T01:30:00.000Z",
      ownership: {
        teacherId: "teacher-kang",
        courseIds: ["course-owned"],
        sampleAssets: [
          {
            sampleAssetId: "sample-new",
            courseId: "course-owned",
            privateSourcePath: "/private/teacher.wav",
          },
        ],
      } as UaisTeacherAiResourceOwnership,
    });

    expect(receipt).toEqual({
      teacherId: "teacher-kang",
      courseIds: ["course-owned"],
      status: "merged",
      storagePolicy: "postgres-redacted-teacher-ai-ownership-resources",
      storageWritePolicy: "postgres-transactional-merge",
      responsibleSession: "S12",
      updatedAt: "2026-08-24T01:30:00.000Z",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    });

    const statements = scripted.invocations.map(({ statement }) => statement);
    expect(statements).toHaveLength(4);
    expect(statements[0]).toContain("FOR SHARE");
    expect(statements[1]).toContain("ON CONFLICT (teacher_id) DO NOTHING");
    expect(statements[2]).toContain("FOR UPDATE");
    expect(statements[3]).toContain("UPDATE uais_teacher_ai_ownership");
    const persistedJson = scripted.invocations[3]?.values.find(
      (value) => typeof value === "string" && value.startsWith("{"),
    );
    expect(JSON.parse(String(persistedJson))).toEqual({
      sampleAssets: [
        { sampleAssetId: "sample-existing", courseId: "course-owned" },
        { sampleAssetId: "sample-new", courseId: "course-owned" },
      ],
      pptAssets: [],
      clonedVoiceRefs: [],
      audioManifests: [],
    });
    expect(String(persistedJson)).not.toContain("courseIds");
    expect(String(persistedJson)).not.toContain("private/teacher.wav");
    expect(scripted.ended).toBe(1);
  });

  it("rejects a forged course reference before creating or changing a resource row", async () => {
    const scripted = createScriptedDatabase(({ statement }) => {
      if (statement.includes("FROM uais_teaching_course_management_snapshots")) {
        return [{ course_id: "course-owned" }];
      }
      throw new Error(`A rejected ACL merge must not continue: ${statement}`);
    });
    const repository = createUaisTeacherAiOwnershipPostgresRepository({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted.example.test/uais" },
      createDatabase: () => scripted.database,
    });

    await expect(
      repository.merge({
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["course-owned", "course-other-teacher"],
          sampleAssets: [
            { sampleAssetId: "sample-forged", courseId: "course-other-teacher" },
          ],
        },
      }),
    ).rejects.toThrow(/course reference is not owned/i);
    expect(scripted.invocations).toHaveLength(1);
    expect(scripted.ended).toBe(1);
  });
});
