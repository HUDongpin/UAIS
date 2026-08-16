import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTeachingInviteCodeJoinPostHandler } from "@/app/api/teaching/invite-codes/[code]/join/route";
import { type UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import { nextOptimisticWriteRetryDelayMs } from "@/lib/server/optimistic-write-retry";
import {
  createTeachingClassRecord,
  createTeachingCourseRecord,
  joinTeachingClassByInviteCode,
  readTeachingCourseManagementDatabase,
  TeachingCourseManagementStoreError,
  type TeachingCourseManagementDatabase,
  type TeachingCourseManagementRepository,
} from "@/lib/server/teaching-course-management-store";
import {
  storeTeachingCourseCoverAsset,
  TeachingCourseAssetsStoreError,
  type TeachingCourseAssetsDatabase,
  type TeachingCourseAssetsRepository,
} from "@/lib/server/teaching-course-assets-store";
import {
  executeTeachingOperationAction,
  restoreTeachingOperationDatabaseBackup,
  rollbackTeachingOperationRecord,
  TeachingOperationStoreError,
  type TeachingOperationDatabase,
} from "@/lib/server/teaching-operations-store";
import { readTeachingOperationDatabase } from "@/lib/server/teaching-operations-store";
import type { TeachingOperationRepository } from "@/lib/server/teaching-operations-postgres-store";

// Contention robustness for the writes that arrive in bursts: enrolment-day
// joins and approvals against one course row, and the teaching-operations
// snapshot that every teacher action replaces wholesale. Both surfaces are
// exercised through repositories that lose the race on purpose, because the
// property under test - "a writer that lost never silently drops its update" -
// is invisible on a store where writes cannot collide.

const appSessionSecret = "test-teaching-contention-app-session-signing-secret";
const externalStorageAccessToken = "test-external-storage-access-token-with-32-chars";
const appAuthProviderToken = "test-app-auth-provider-token-with-32-chars";
const teacherAuthSecret = "test-teaching-contention-session-signing-secret";
const teacherAuthIssuerSecret = "test-teaching-contention-auth-issuer-secret-fixture";
const studentAppSessionUser: UaisAppSessionUser = {
  account: "Peter",
  department: "学生账号",
  displayName: "Peter",
  role: "student",
};

type CourseManagementRepositoryProbe = TeachingCourseManagementRepository & {
  reads: number;
  writes: number;
  stored: () => TeachingCourseManagementDatabase;
};

// An optimistic snapshot store that answers the first `conflicts` writes with
// the same 409 the external/managed backends raise, exactly as a lost race does.
function createContendedCourseManagementRepository(input: {
  database: TeachingCourseManagementDatabase;
  conflicts: number;
}): CourseManagementRepositoryProbe {
  let stored = structuredClone(input.database);
  let revision = 0;
  const probe: CourseManagementRepositoryProbe = {
    storage: {
      recordStoragePolicy: "external-redacted-teaching-course-management-snapshot",
      auditStoragePolicy: "external-redacted-teaching-course-management-audit-log",
      storageWritePolicy: "external-optimistic-snapshot-replace",
    },
    reads: 0,
    writes: 0,
    stored: () => stored,
    read: async () => {
      probe.reads += 1;
      return { database: structuredClone(stored), revision: `rev-${revision}` };
    },
    write: async ({ database }) => {
      probe.writes += 1;
      if (probe.writes <= input.conflicts) {
        // A competing writer committed between this caller's read and its
        // write, so the revision it holds is stale.
        revision += 1;
        throw new TeachingCourseManagementStoreError(
          409,
          "External teaching course management snapshot changed; retry required.",
        );
      }
      stored = structuredClone(database);
      revision += 1;
    },
  };
  return probe;
}

async function seedCourseManagementDatabase(dataDir: string) {
  await createTeachingCourseRecord({
    dataDir,
    actorId: "teacher-kang",
    draft: {
      name: "Contended Enrolment Course",
      instructor: "Kang Xia",
      unit: "Guangzhou University 404",
      department: "Experimental Teaching Center",
      semester: "2026 Spring",
    },
    now: new Date("2026-06-22T10:00:00.000Z"),
  });
  const database = await readTeachingCourseManagementDatabase({ dataDir });
  const courseId = database.courses[0].courseId;
  const { classItem } = await createTeachingClassRecord({
    dataDir,
    actorId: "teacher-kang",
    courseId,
    draft: { className: "Contended Enrolment Class" },
    now: new Date("2026-06-22T10:05:00.000Z"),
  });
  return {
    database: await readTeachingCourseManagementDatabase({ dataDir }),
    courseId,
    invitationCode: classItem.invitationCode,
  };
}

describe("enrolment-day write contention", () => {
  it("keeps a contended invite-code join through repeated lost races", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-contended-join-"));
    try {
      const seed = await seedCourseManagementDatabase(dataDir);
      const repository = createContendedCourseManagementRepository({
        database: seed.database,
        conflicts: 2,
      });

      const { membership } = await joinTeachingClassByInviteCode({
        dataDir,
        repository,
        join: {
          invitationCode: seed.invitationCode,
          studentId: "Peter",
          studentDisplayName: "Peter",
        },
        now: new Date("2026-06-22T11:40:00.000Z"),
      });

      // Two conflicts, three writes: the old single-retry loop stopped at two
      // and answered 409 with the seat unsaved.
      expect(repository.writes).toBe(3);
      expect(membership.membershipStatus).toBe("pending-teacher-review");
      expect(
        repository.stored().memberships.map((item) => item.membershipId),
      ).toEqual([membership.membershipId]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("answers an exhausted invite-code join with a structured contention 409", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-exhausted-join-"));
    try {
      const seed = await seedCourseManagementDatabase(dataDir);
      const repository = createContendedCourseManagementRepository({
        database: seed.database,
        conflicts: Number.POSITIVE_INFINITY,
      });

      const error = await joinTeachingClassByInviteCode({
        dataDir,
        repository,
        join: {
          invitationCode: seed.invitationCode,
          studentId: "Peter",
          studentDisplayName: "Peter",
        },
        now: new Date("2026-06-22T11:40:00.000Z"),
      }).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(TeachingCourseManagementStoreError);
      expect(error).toMatchObject({
        status: 409,
        message: "Teaching course management snapshot changed; retry required.",
        reasonCode: "snapshot-contention",
        diagnostics: { attempts: 5 },
      });
      expect(repository.writes).toBe(5);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("surfaces the contention reason code in the invite-code join response body", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-join-route-contention-"));
    try {
      const seed = await seedCourseManagementDatabase(dataDir);
      const externalDatabase = {
        ...seed.database,
        schemaVersion: "uais-teaching-course-management-v1",
      };
      let putCount = 0;
      const fetchImpl: typeof fetch = async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        if (init?.method === "PUT") {
          putCount += 1;
          return Response.json(
            { error: "Teaching course management snapshot revision mismatch." },
            { status: 409 },
          );
        }
        if (pathname === "/uais/teaching-course-management/database") {
          return Response.json({
            database: externalDatabase,
            revision: `rev-${putCount}`,
            storagePolicy: "external-redacted-teaching-course-management-snapshot",
            productionDatabaseAdapter: {
              status: "ready",
              providerClass: "managed-database",
              migrationStatus: "up-to-date",
              backupPolicy: "point-in-time-restore",
              concurrencyControl: "transactional",
              valueRedacted: true,
            },
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          });
        }
        return Response.json({ error: "unexpected external request" }, { status: 404 });
      };
      const postJoin = createTeachingInviteCodeJoinPostHandler({
        env: {
          NODE_ENV: "production",
          VERCEL_ENV: "production",
          UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
          UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
          UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
          UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
          UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
          UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
          UAIS_APP_AUTH_PROVIDER: "trusted-account-provider",
          UAIS_APP_AUTH_PROVIDER_URL: "https://accounts.example.test/uais/authenticate",
          UAIS_APP_AUTH_PROVIDER_TOKEN: appAuthProviderToken,
        },
        fetch: fetchImpl,
        hasTrustedAccountProvider: true,
        now: new Date("2026-06-22T11:40:00.000Z"),
      });

      const response = await postJoin(
        new Request(
          `https://www.uais.top/api/teaching/invite-codes/${seed.invitationCode}/join`,
          {
            method: "POST",
            headers: {
              cookie: createUaisAppSessionCookie(studentAppSessionUser, {
                secret: appSessionSecret,
                sessionId: "peter-contention-session",
                now: new Date("2026-06-22T11:00:00.000Z"),
              }),
              "x-uais-trace-id": "trace-join-contention",
            },
          },
        ),
        { params: Promise.resolve({ code: seed.invitationCode }) },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(409);
      // The prose is unchanged; the code beside it is what a client branches on.
      expect(body.error).toBe("Teaching course management snapshot changed; retry required.");
      expect(body.reasonCode).toBe("snapshot-contention");
      expect(body.traceId).toBe("trace-join-contention");
      expect(putCount).toBe(5);
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain(dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

type OperationRepositoryProbe = TeachingOperationRepository & {
  writes: number;
  stored: () => TeachingOperationDatabase;
};

// A managed-snapshot double with the same revision guard the Postgres adapter
// enforces, plus a competing writer that commits just before each of the first
// `competingWrites` write attempts.
function createContendedOperationRepository(input: {
  database: TeachingOperationDatabase;
  competingWrites: number;
  compete: (database: TeachingOperationDatabase) => TeachingOperationDatabase;
}): OperationRepositoryProbe {
  let stored = structuredClone(input.database);
  let revision = 0;
  const probe: OperationRepositoryProbe = {
    writes: 0,
    stored: () => stored,
    read: async () => ({ database: structuredClone(stored), revision: `rev-${revision}` }),
    write: async ({ database, expectedRevision }) => {
      probe.writes += 1;
      if (probe.writes <= input.competingWrites) {
        stored = input.compete(structuredClone(stored));
        revision += 1;
      }
      if (expectedRevision && expectedRevision !== `rev-${revision}`) {
        throw new TeachingOperationStoreError(
          409,
          "Postgres teaching operation snapshot changed; retry required.",
        );
      }
      stored = structuredClone(database);
      revision += 1;
    },
  };
  return probe;
}

// A managed-snapshot double with the guard the Postgres adapter now enforces in
// full: an existing row plus a writer that names no revision is a writer that
// read nothing, and is refused. The lenient version of that check is what let
// one teacher's action be replaced by another's with no error anywhere.
function createGuardedOperationRepository(database: TeachingOperationDatabase) {
  let stored = structuredClone(database);
  let revision = 1;
  const probe: TeachingOperationRepository & {
    expectedRevisions: Array<string | undefined>;
    stored: () => TeachingOperationDatabase;
  } = {
    expectedRevisions: [],
    stored: () => stored,
    read: async () => ({ database: structuredClone(stored), revision: `rev-${revision}` }),
    write: async ({ database: next, expectedRevision }) => {
      probe.expectedRevisions.push(expectedRevision);
      if (expectedRevision !== `rev-${revision}`) {
        throw new TeachingOperationStoreError(
          409,
          "Postgres teaching operation snapshot changed; retry required.",
        );
      }
      stored = structuredClone(next);
      revision += 1;
    },
  };
  return probe;
}

async function seedOperationBackupFile(input: {
  dataDir: string;
  backupId: string;
  database: TeachingOperationDatabase;
}) {
  await mkdir(join(input.dataDir, "backups"), { recursive: true });
  await writeFile(
    join(input.dataDir, "backups", `${input.backupId}.json`),
    JSON.stringify({
      schemaVersion: "uais-teaching-operations-backup-v1",
      createdAt: "2026-06-22T08:30:00.000Z",
      sourceFile: "teaching-operations.json",
      reason: "before-atomic-replace",
      responsibleSession: "S12",
      database: input.database,
    }),
    "utf8",
  );
}

async function seedOperationDatabase(dataDir: string) {
  for (const courseId of ["teacher-course-alpha", "teacher-course-beta"]) {
    await executeTeachingOperationAction({
      dataDir,
      operationId: "course-settings",
      actionSlot: "primary",
      courseId,
      sourceAction: "manage",
      actorId: "teacher-kang",
      now: new Date("2026-06-22T08:00:00.000Z"),
    });
  }
  return readTeachingOperationDatabase({ dataDir });
}

function createRollbackAudit(traceId: string) {
  return {
    traceId,
    actorRole: "teacher" as const,
    authMode: "signed-teacher-session" as const,
    requestSource: { userAgent: "vitest", ipAddress: "redacted" as const },
  };
}

describe("teaching-operations snapshot concurrency", () => {
  it("keeps a concurrent writer's update when a guarded rollback loses the race", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-ops-contention-"));
    try {
      const seeded = await seedOperationDatabase(dataDir);
      const [firstRecord, secondRecord] = seeded.records;
      const repository = createContendedOperationRepository({
        database: seeded,
        competingWrites: 1,
        // The competing teacher rolls the OTHER record back. Before the guard,
        // this projection was silently erased by the write below, which had been
        // built from a snapshot that predated it.
        compete: (database) => ({
          ...database,
          domainProjections: [
            ...database.domainProjections,
            {
              objectId: `operation-rollback-${secondRecord.recordId}`,
              objectType: "operation-rollback",
              courseId: secondRecord.courseId ?? "teacher-course-beta",
              targetRecordId: secondRecord.recordId,
              targetOperationId: secondRecord.operationId,
              targetActionSlot: secondRecord.actionSlot,
              targetActionId: secondRecord.actionId,
              rollbackStatus: "rolled-back",
              rollbackReason: "competing-teacher-rollback",
              rolledBackBy: "teacher-lin",
              rolledBackAt: "2026-06-22T08:30:00.000Z",
              storagePolicy: "domain-projection-teaching-operation-rollback",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          ],
        }),
      });

      const { receipt } = await rollbackTeachingOperationRecord({
        dataDir,
        repository,
        recordId: firstRecord.recordId,
        actorId: "teacher-kang",
        rollbackReason: "duplicate-operation",
        audit: createRollbackAudit("trace-ops-contention"),
        now: new Date("2026-06-22T09:00:00.000Z"),
      });

      expect(receipt.targetRecordId).toBe(firstRecord.recordId);
      expect(repository.writes).toBe(2);
      const rolledBack = repository
        .stored()
        .domainProjections.filter((item) => item.objectType === "operation-rollback")
        .map((item) => item.targetRecordId)
        .sort();
      expect(rolledBack).toEqual([firstRecord.recordId, secondRecord.recordId].sort());
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("answers exhausted teaching-operations contention with a structured 409", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-ops-exhausted-"));
    try {
      const seeded = await seedOperationDatabase(dataDir);
      const repository = createContendedOperationRepository({
        database: seeded,
        competingWrites: Number.POSITIVE_INFINITY,
        compete: (database) => ({
          ...database,
          updatedAt: new Date(Date.parse(database.updatedAt) + 1000).toISOString(),
        }),
      });

      const error = await rollbackTeachingOperationRecord({
        dataDir,
        repository,
        recordId: seeded.records[0].recordId,
        actorId: "teacher-kang",
        rollbackReason: "duplicate-operation",
        audit: createRollbackAudit("trace-ops-exhausted"),
        now: new Date("2026-06-22T09:00:00.000Z"),
      }).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(TeachingOperationStoreError);
      expect(error).toMatchObject({
        status: 409,
        message: "Teaching operation snapshot changed; retry required.",
        reasonCode: "snapshot-contention",
      });
      expect(repository.writes).toBe(3);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  // A restore is the one write that does not derive its database from the
  // snapshot it replaces - it comes from a backup file - so it is also the one
  // that used to reach the managed backend with no revision at all. That was
  // harmless only because the backend's guard was lenient enough to accept it,
  // which is the same leniency that dropped concurrent teachers' actions.
  it("names the revision a backup restore is displacing", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-ops-restore-guard-"));
    try {
      const seeded = await seedOperationDatabase(dataDir);
      const backupId = "teaching-operations-backup-20260622-083000";
      await seedOperationBackupFile({ dataDir, backupId, database: seeded });
      const repository = createGuardedOperationRepository(seeded);

      const { receipt } = await restoreTeachingOperationDatabaseBackup({
        dataDir,
        repository,
        backupId,
        actorId: "teacher-kang",
        audit: createRollbackAudit("trace-ops-restore"),
        now: new Date("2026-06-22T09:00:00.000Z"),
      });

      expect(receipt.backupId).toBe(backupId);
      // The revision it read, not `undefined`: a restore that named nothing
      // would be refused by the managed row exactly as a stale writer is.
      expect(repository.expectedRevisions).toEqual(["rev-1"]);
      expect(
        repository.stored().auditEvents.some((event) => event.traceId === "trace-ops-restore"),
      ).toBe(true);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  // Executing an action is the one flow that cannot re-run its body on a lost
  // race: `createArtifacts` allocates the invite code and writes the
  // export-manifest file BEFORE the snapshot is persisted, and the receipt the
  // teacher already holds names them. So the guard here merges the values that
  // were built once onto the fresh snapshot instead of replaying the action.
  it("merges a contended action onto the fresh snapshot without re-allocating its artifacts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-ops-execute-contention-"));
    try {
      const seeded = await seedOperationDatabase(dataDir);
      const repository = createContendedOperationRepository({
        database: seeded,
        competingWrites: 1,
        // The competing teacher publishes an invite code of their own. Replaying
        // the action instead of merging it would derive the next code from THIS
        // record and hand the teacher a code their receipt never mentioned.
        compete: (database) => ({
          ...database,
          inviteCodes: [
            ...database.inviteCodes,
            {
              inviteId: "invite-60000000-20260622-083000",
              operationId: "invite-code",
              code: "60000000",
              status: "generated",
              courseId: "teacher-course-beta",
              actorId: "teacher-lin",
              createdAt: "2026-06-22T08:30:00.000Z",
            },
          ],
        }),
      });

      const receipt = await executeTeachingOperationAction({
        dataDir,
        repository,
        operationId: "invite-code",
        actionSlot: "primary",
        courseId: "teacher-course-alpha",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T09:00:00.000Z"),
      });

      const inviteArtifact = receipt.artifacts.find(
        (artifact) => artifact.kind === "invite-code",
      );
      // Allocated once, from the snapshot this request actually read. The code
      // itself is a random draw, so what is pinned is that the receipt names
      // one code and the merge carries that same one through.
      const allocatedCode =
        inviteArtifact?.kind === "invite-code" ? inviteArtifact.code : "";
      expect(allocatedCode).toEqual(expect.stringMatching(/^\d{8}$/));
      expect(repository.writes).toBe(2);

      const stored = repository.stored();
      // The competing teacher's code is still there - that is the update the
      // unguarded write used to erase - and exactly one code was allocated here.
      expect(stored.inviteCodes.map((item) => item.code)).toEqual([
        "60000000",
        allocatedCode,
      ]);
      expect(stored.records.map((item) => item.recordId)).toContain(receipt.receiptId);
      expect(
        stored.records.filter((item) => item.recordId === receipt.receiptId),
      ).toHaveLength(1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("answers an exhausted action execution with a structured contention 409", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-ops-execute-exhausted-"));
    try {
      const seeded = await seedOperationDatabase(dataDir);
      const repository = createContendedOperationRepository({
        database: seeded,
        competingWrites: Number.POSITIVE_INFINITY,
        compete: (database) => ({
          ...database,
          updatedAt: new Date(Date.parse(database.updatedAt) + 1000).toISOString(),
        }),
      });

      const error = await executeTeachingOperationAction({
        dataDir,
        repository,
        operationId: "invite-code",
        actionSlot: "primary",
        courseId: "teacher-course-alpha",
        sourceAction: "manage",
        actorId: "teacher-kang",
        now: new Date("2026-06-22T09:00:00.000Z"),
      }).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(TeachingOperationStoreError);
      expect(error).toMatchObject({
        status: 409,
        message: "Teaching operation snapshot changed; retry required.",
        reasonCode: "snapshot-contention",
      });
      expect(repository.writes).toBe(3);
      // Nothing landed, so no code was consumed by the failed request.
      expect(repository.stored().inviteCodes).toHaveLength(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

// The cover snapshot is one row for the whole deployment, and the write behind
// it follows a provider image that has already been generated and paid for. A
// single retry dropped the third concurrent writer and threw that work away.
describe("teaching course cover asset write contention", () => {
  const cover = {
    provider: "qwen" as const,
    providerRole: "image-generation" as const,
    model: "qwen-image-2.0",
    imageUrl: "https://dashscope-result.example.test/course-cover-contention.png",
    requestId: "request-course-cover-contention",
    redaction: {
      secrets: "omitted" as const,
      localFiles: "omitted" as const,
      assets: "generated-url-only" as const,
    },
  };

  type AssetRepositoryProbe = TeachingCourseAssetsRepository & {
    writes: number;
    stored: () => TeachingCourseAssetsDatabase;
  };

  function createContendedAssetRepository(input: {
    conflicts: number;
  }): AssetRepositoryProbe {
    let stored: TeachingCourseAssetsDatabase = {
      schemaVersion: "uais-teaching-course-assets-v1",
      updatedAt: "2026-06-22T08:00:00.000Z",
      assets: [],
      auditEvents: [],
    };
    let revision = 0;
    const probe: AssetRepositoryProbe = {
      storage: {
        assetStoragePolicy: "external-redacted-teaching-course-cover-assets",
        auditStoragePolicy: "external-redacted-teaching-course-cover-audit-log",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      },
      writes: 0,
      stored: () => stored,
      read: async () => ({ database: structuredClone(stored), revision: `rev-${revision}` }),
      write: async ({ database }) => {
        probe.writes += 1;
        if (probe.writes <= input.conflicts) {
          revision += 1;
          throw new TeachingCourseAssetsStoreError(
            409,
            "External teaching course cover asset snapshot changed; retry required.",
          );
        }
        stored = structuredClone(database);
        revision += 1;
      },
    };
    return probe;
  }

  it("persists a cover through repeated lost races and reports the ladder honestly", async () => {
    const repository = createContendedAssetRepository({ conflicts: 3 });

    const receipt = await storeTeachingCourseCoverAsset({
      repository,
      courseId: "teacher-course-alpha",
      courseName: "Contended Cover Course",
      cover,
      createdAt: "2026-06-22T09:00:00.000Z",
    });

    // Three conflicts, four writes: the old single-retry loop stopped at two and
    // threw the generated image away.
    expect(repository.writes).toBe(4);
    expect(receipt.persistence.revisionRetry).toEqual({
      status: "retried",
      attempts: 4,
      conflicts: 3,
      maxAttempts: 5,
    });
    expect(repository.stored().assets.map((asset) => asset.assetId)).toEqual([
      receipt.asset.assetId,
    ]);
  });

  it("answers exhausted cover-asset contention with a structured 409", async () => {
    const repository = createContendedAssetRepository({
      conflicts: Number.POSITIVE_INFINITY,
    });

    const error = await storeTeachingCourseCoverAsset({
      repository,
      courseId: "teacher-course-alpha",
      courseName: "Exhausted Cover Course",
      cover,
      createdAt: "2026-06-22T09:00:00.000Z",
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(TeachingCourseAssetsStoreError);
    expect(error).toMatchObject({
      status: 409,
      message: "Teaching course cover asset snapshot changed; retry required.",
      reasonCode: "snapshot-contention",
    });
    expect(repository.writes).toBe(5);
  });
});

describe("optimistic write retry jitter", () => {
  it("draws each wait from the decorrelated band and clamps it to the cap", () => {
    expect(nextOptimisticWriteRetryDelayMs({ previousDelayMs: 0, random: 0 })).toBe(25);
    expect(nextOptimisticWriteRetryDelayMs({ previousDelayMs: 0, random: 1 })).toBe(75);
    expect(nextOptimisticWriteRetryDelayMs({ previousDelayMs: 75, random: 1 })).toBe(225);
    // The ceiling stops climbing at the cap, so the ladder never turns into a
    // wait a learner or teacher would notice as a hang.
    expect(nextOptimisticWriteRetryDelayMs({ previousDelayMs: 225, random: 1 })).toBe(250);
    const spread = new Set(
      Array.from({ length: 24 }, () =>
        nextOptimisticWriteRetryDelayMs({ previousDelayMs: 75 }),
      ),
    );
    expect(spread.size).toBeGreaterThan(1);
  });
});
