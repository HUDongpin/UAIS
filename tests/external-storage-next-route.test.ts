import { appendFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createExternalStorageHealthGetHandler,
  createExternalStorageLifecycleAuditGetHandler,
  createExternalStorageLifecycleAuditPostHandler,
  createExternalStorageTeacherOwnershipGetHandler,
  createExternalStorageTeacherOwnershipMergePostHandler,
  createExternalStorageTeachingCourseAssetsBackupPostHandler,
  createExternalStorageTeachingCourseAssetsBackupRestoreDrillPostHandler,
  createExternalStorageTeachingCourseAssetsDatabaseGetHandler,
  createExternalStorageTeachingCourseAssetsDatabasePutHandler,
  createExternalStorageTeachingCourseManagementBackupPostHandler,
  createExternalStorageTeachingCourseManagementBackupRestoreDrillPostHandler,
  createExternalStorageTeachingCourseManagementDatabaseGetHandler,
  createExternalStorageTeachingCourseManagementDatabasePutHandler,
  createExternalStorageLearningChatroomTranscriptsDatabaseGetHandler,
  createExternalStorageLearningChatroomTranscriptsDatabasePutHandler,
  createExternalStorageTeachingOperationAuditAlertsGetHandler,
  createExternalStorageTeachingOperationAuditAlertNotificationsGetHandler,
  createExternalStorageTeachingOperationAuditAlertNotificationsPostHandler,
  createExternalStorageTeachingOperationAuditGetHandler,
  createExternalStorageTeachingOperationAppendPostHandler,
  createExternalStorageTeachingOperationBackupPostHandler,
  createExternalStorageTeachingOperationBackupRestoreDrillPostHandler,
  createExternalStorageTeachingOperationRollbackPostHandler,
} from "@/lib/server/external-storage-route-service";

const accessToken = "test-external-storage-route-token-strong";

function createProductionDatabaseAdapterEnv() {
  return {
    UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS: "managed-database",
    UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS: "up-to-date",
    UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY: "point-in-time-restore",
    UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL: "transactional",
  };
}

function createReadyProductionDatabaseAdapter() {
  return {
    status: "ready",
    providerClass: "managed-database",
    migrationStatus: "up-to-date",
    backupPolicy: "point-in-time-restore",
    concurrencyControl: "transactional",
    valueRedacted: true,
  };
}

function createEnv(dataDir: string) {
  return {
    UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
    UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR: dataDir,
    UAIS_EXTERNAL_STORAGE_SERVICE_MODE: "production",
    ...createProductionDatabaseAdapterEnv(),
  };
}

function createProductionEnvWithoutDatabaseAdapter(dataDir: string) {
  return {
    UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
    UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR: dataDir,
    UAIS_EXTERNAL_STORAGE_SERVICE_MODE: "production",
  };
}

function authorizedRequest(url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });
}

function deferredAuthorizedRequest(url: string, body: unknown) {
  let releaseBody!: () => void;
  const bodyReady = new Promise<void>((resolve) => {
    releaseBody = resolve;
  });
  const request = authorizedRequest(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const readBody = request.text.bind(request);
  Object.defineProperty(request, "text", {
    configurable: true,
    value: async () => {
      await bodyReady;
      return readBody();
    },
  });
  return { request, releaseBody };
}

function expectSafeResponseBody(value: unknown, dataDir: string) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(accessToken);
  expect(serialized).not.toContain(dataDir);
  expect(serialized).not.toContain("/Users/");
}

function restoreProcessEnvValue(name: string, value: string | undefined) {
  if (typeof value === "undefined") {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe("Next-hosted external storage route service", () => {
  it("uses a transcript-only compare-and-swap lock for concurrent freeze and append writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-transcript-cas-storage-"));
    const env = createEnv(dataDir);
    const putTranscripts =
      createExternalStorageLearningChatroomTranscriptsDatabasePutHandler({ env });
    const getTranscripts =
      createExternalStorageLearningChatroomTranscriptsDatabaseGetHandler({ env });
    const endpoint =
      "https://www.uais.top/api/external-storage/learning-chatroom-transcripts/database";
    const baseTranscript = {
      transcriptId: "chatroom-transcript-cas-room",
      courseId: "course-cas",
      studentId: "student-cas",
      messages: [],
      createdAt: "2026-06-22T11:20:00.000Z",
      updatedAt: "2026-06-22T11:20:00.000Z",
      storagePolicy: "external-redacted-learning-chatroom-transcripts",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
    };
    const frozenDatabase = {
      schemaVersion: "uais-learning-chatroom-transcripts-v2",
      updatedAt: "2026-06-22T11:20:01.000Z",
      transcripts: [
        {
          ...baseTranscript,
          moderation: {
            status: "frozen",
            actorId: "teacher-cas",
            actedAt: "2026-06-22T11:20:01.000Z",
          },
        },
      ],
    };
    const appendedDatabase = {
      schemaVersion: "uais-learning-chatroom-transcripts-v2",
      updatedAt: "2026-06-22T11:20:02.000Z",
      transcripts: [
        {
          ...baseTranscript,
          messages: [
            {
              messageId: "message-cas-append",
              role: "student",
              content: "append wins only if its CAS wins",
              createdAt: "2026-06-22T11:20:02.000Z",
            },
          ],
        },
      ],
    };

    try {
      const initialResponse = await getTranscripts(authorizedRequest(endpoint));
      expect(initialResponse.status).toBe(200);
      const initial = await initialResponse.json();
      expect(initial.revision).toBe("rev-empty");

      const freeze = deferredAuthorizedRequest(endpoint, {
        action: "replace-learning-chatroom-transcripts-database",
        expectedRevision: initial.revision,
        database: frozenDatabase,
      });
      const append = deferredAuthorizedRequest(endpoint, {
        action: "replace-learning-chatroom-transcripts-database",
        expectedRevision: initial.revision,
        database: appendedDatabase,
      });
      const freezeResult = putTranscripts(freeze.request);
      const appendResult = putTranscripts(append.request);
      freeze.releaseBody();
      append.releaseBody();

      const responses = await Promise.all([freezeResult, appendResult]);
      const bodies = await Promise.all(responses.map((response) => response.json()));
      expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
      expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
      expect(bodies.filter((body) => body.error?.includes("revision mismatch"))).toHaveLength(1);

      const persistedResponse = await getTranscripts(authorizedRequest(endpoint));
      const persisted = await persistedResponse.json();
      expect(persistedResponse.status).toBe(200);
      const persistedTranscript = persisted.database.transcripts[0];
      expect(persistedTranscript.transcriptId).toBe("chatroom-transcript-cas-room");
      expect(
        Boolean(persistedTranscript.moderation) !==
          (persistedTranscript.messages.length > 0),
      ).toBe(true);
      expectSafeResponseBody(persisted, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("persists course-management snapshots with optimistic revisions", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-course-management-storage-"));
    const env = createEnv(dataDir);
    const getCourseManagementDatabase =
      createExternalStorageTeachingCourseManagementDatabaseGetHandler({ env });
    const putCourseManagementDatabase =
      createExternalStorageTeachingCourseManagementDatabasePutHandler({ env });

    try {
      const initialResponse = await getCourseManagementDatabase(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-management/database",
        ),
      );
      const initial = await initialResponse.json();

      expect(initialResponse.status).toBe(200);
      expect(initial).toMatchObject({
        revision: "rev-empty",
        database: {
          schemaVersion: "uais-teaching-course-management-v1",
          courses: [],
          classes: [],
          memberships: [],
          auditEvents: [],
        },
        storagePolicy: "external-redacted-teaching-course-management-snapshot",
        productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
      });

      const putResponse = await putCourseManagementDatabase(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-management/database",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "replace-teaching-course-management-database",
              expectedRevision: "rev-empty",
              database: {
                schemaVersion: "uais-teaching-course-management-v1",
                updatedAt: "2026-06-22T11:20:00.000Z",
                courses: [
                  {
                    courseId: "teacher-course-external-storage-course-20260622-112000",
                    ownerTeacherId: "teacher-kang",
                    courseName: "External Storage Course",
                    instructor: "Kang Xia",
                    unit: "Guangzhou University 404",
                    department: "Experimental Teaching Center",
                    semester: "2026 Spring",
                    status: "draft",
                    students: 0,
                    createdAt: "2026-06-22T11:20:00.000Z",
                    updatedAt: "2026-06-22T11:20:00.000Z",
                    storagePolicy: "external-redacted-teaching-course-management-snapshot",
                    storageWritePolicy: "external-optimistic-snapshot-replace",
                    responsibleSession: "S12",
                    redaction: {
                      secrets: "omitted",
                      localFiles: "omitted",
                      assets: "ids-only",
                    },
                  },
                ],
                classes: [],
                memberships: [],
                auditEvents: [
                  {
                    auditId: "audit-create-course-20260622-112000",
                    action: "create-course",
                    actorId: "teacher-kang",
                    courseId: "teacher-course-external-storage-course-20260622-112000",
                    traceId: "trace-external-course-management-snapshot",
                    actorRole: "teacher",
                    authMode: "signed-teacher-session",
                    createdAt: "2026-06-22T11:20:00.000Z",
                    storagePolicy: "external-redacted-teaching-course-management-audit-log",
                    redaction: {
                      secrets: "omitted",
                      localFiles: "omitted",
                      assets: "ids-only",
                    },
                  },
                ],
              },
            }),
          },
        ),
      );
      const putReceipt = await putResponse.json();

      expect(putResponse.status).toBe(200);
      expect(putReceipt).toEqual(
        expect.objectContaining({
          status: "persisted",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          responsibleSession: "S12",
        }),
      );
      expect(putReceipt.revision).toMatch(/^rev-[a-f0-9]{16}$/);

      const persistedResponse = await getCourseManagementDatabase(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-management/database",
        ),
      );
      const persisted = await persistedResponse.json();

      expect(persistedResponse.status).toBe(200);
      expect(persisted.revision).toBe(putReceipt.revision);
      expect(persisted.database.courses).toEqual([
        expect.objectContaining({
          courseId: "teacher-course-external-storage-course-20260622-112000",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
        }),
      ]);

      const staleResponse = await putCourseManagementDatabase(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-management/database",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "replace-teaching-course-management-database",
              expectedRevision: "rev-empty",
              database: persisted.database,
            }),
          },
        ),
      );
      const stale = await staleResponse.json();

      expect(staleResponse.status).toBe(409);
      expect(stale.error).toBe("Teaching course management snapshot revision mismatch.");
      expectSafeResponseBody(initial, dataDir);
      expectSafeResponseBody(putReceipt, dataDir);
      expectSafeResponseBody(persisted, dataDir);
      expectSafeResponseBody(stale, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("persists course-cover asset snapshots with optimistic revisions", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-course-assets-storage-"));
    const env = createEnv(dataDir);
    const getCourseAssetsDatabase =
      createExternalStorageTeachingCourseAssetsDatabaseGetHandler({ env });
    const putCourseAssetsDatabase =
      createExternalStorageTeachingCourseAssetsDatabasePutHandler({ env });

    try {
      const initialResponse = await getCourseAssetsDatabase(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-assets/database",
        ),
      );
      const initial = await initialResponse.json();

      expect(initialResponse.status).toBe(200);
      expect(initial).toMatchObject({
        revision: "rev-empty",
        database: {
          schemaVersion: "uais-teaching-course-assets-v1",
          assets: [],
          auditEvents: [],
        },
        storagePolicy: "external-redacted-teaching-course-cover-assets",
      });

      const putResponse = await putCourseAssetsDatabase(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-assets/database",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "replace-teaching-course-assets-database",
              expectedRevision: "rev-empty",
              database: {
                schemaVersion: "uais-teaching-course-assets-v1",
                updatedAt: "2026-06-22T11:00:00.000Z",
                assets: [
                  {
                    assetId: "course-cover-request-course-cover-1",
                    assetType: "course-cover",
                    courseId: "teacher-draft-ai-math",
                    courseName: "AI支持的初等数学研究",
                    provider: "qwen",
                    providerRole: "image-generation",
                    imageUrl: "https://dashscope-result/course-cover.png",
                    model: "qwen-image-2.0-pro",
                    providerRequestId: "request-course-cover-1",
                    createdAt: "2026-06-22T11:00:00.000Z",
                    storagePolicy: "external-redacted-teaching-course-cover-assets",
                    storageWritePolicy: "external-optimistic-snapshot-replace",
                    responsibleSession: "S12",
                    redaction: {
                      secrets: "omitted",
                      localFiles: "omitted",
                      assets: "generated-url-only",
                    },
                  },
                ],
                auditEvents: [
                  {
                    auditId: "audit-course-cover-course-cover-request-course-cover-1-20260622-110000",
                    traceId: "trace-course-cover-001",
                    eventType: "teaching-course-cover.generated",
                    actorId: "teacher-kang",
                    actorRole: "teacher",
                    authMode: "signed-teacher-session",
                    courseId: "teacher-draft-ai-math",
                    assetId: "course-cover-request-course-cover-1",
                    providerRequestId: "request-course-cover-1",
                    requestSource: {
                      userAgent: "UAIS next external storage course cover test",
                      ipAddress: "redacted",
                    },
                    createdAt: "2026-06-22T11:00:00.000Z",
                    storagePolicy: "external-redacted-teaching-course-cover-audit-log",
                    redaction: {
                      secrets: "omitted",
                      localFiles: "omitted",
                      assets: "generated-url-only",
                    },
                  },
                ],
              },
            }),
          },
        ),
      );
      const putReceipt = await putResponse.json();

      expect(putResponse.status).toBe(200);
      expect(putReceipt).toEqual(
        expect.objectContaining({
          status: "persisted",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          responsibleSession: "S12",
        }),
      );
      expect(putReceipt.revision).toMatch(/^rev-[a-f0-9]{16}$/);

      const persistedResponse = await getCourseAssetsDatabase(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-assets/database",
        ),
      );
      const persisted = await persistedResponse.json();

      expect(persistedResponse.status).toBe(200);
      expect(persisted.revision).toBe(putReceipt.revision);
      expect(persisted.database.assets).toEqual([
        expect.objectContaining({
          assetId: "course-cover-request-course-cover-1",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
        }),
      ]);

      const staleResponse = await putCourseAssetsDatabase(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-assets/database",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "replace-teaching-course-assets-database",
              expectedRevision: "rev-empty",
              database: persisted.database,
            }),
          },
        ),
      );
      const stale = await staleResponse.json();

      expect(staleResponse.status).toBe(409);
      expect(stale.error).toBe("Teaching course assets snapshot revision mismatch.");
      expectSafeResponseBody(initial, dataDir);
      expectSafeResponseBody(putReceipt, dataDir);
      expectSafeResponseBody(stale, dataDir);
      const persistedSnapshot = await readFile(
        join(dataDir, "teaching-course-assets", "database.json"),
        "utf8",
      );
      expect(persistedSnapshot).toContain("course-cover-request-course-cover-1");
      expect(persistedSnapshot).not.toContain(accessToken);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed before production course snapshot readback without managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-production-snapshot-readback-"));
    const env = createProductionEnvWithoutDatabaseAdapter(dataDir);
    const getCourseManagementDatabase =
      createExternalStorageTeachingCourseManagementDatabaseGetHandler({ env });
    const getCourseAssetsDatabase =
      createExternalStorageTeachingCourseAssetsDatabaseGetHandler({ env });

    try {
      for (const [handler, url] of [
        [
          getCourseManagementDatabase,
          "https://www.uais.top/api/external-storage/teaching-course-management/database",
        ],
        [
          getCourseAssetsDatabase,
          "https://www.uais.top/api/external-storage/teaching-course-assets/database",
        ],
      ] as const) {
        const response = await handler(authorizedRequest(url));
        const body = await response.json();

        expect(response.status).toBe(503);
        expect(body).toEqual(
          expect.objectContaining({
            error:
              "Production external storage snapshot readback requires ready managed database adapter proof.",
            redaction: {
              secrets: "omitted",
              assets: "ids-only",
              localFiles: "omitted",
            },
          }),
        );
        expectSafeResponseBody(body, dataDir);
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed before replacing production course snapshots without managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-course-snapshot-db-proof-"));
    const env = createProductionEnvWithoutDatabaseAdapter(dataDir);
    const putCourseManagementDatabase =
      createExternalStorageTeachingCourseManagementDatabasePutHandler({ env });
    const putCourseAssetsDatabase =
      createExternalStorageTeachingCourseAssetsDatabasePutHandler({ env });

    try {
      const courseManagementResponse = await putCourseManagementDatabase(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-management/database",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "replace-teaching-course-management-database",
              expectedRevision: "rev-empty",
              database: {
                schemaVersion: "uais-teaching-course-management-v1",
                updatedAt: "2026-06-26T11:00:00.000Z",
                courses: [],
                classes: [],
                memberships: [],
                auditEvents: [],
              },
            }),
          },
        ),
      );
      const courseManagementBody = await courseManagementResponse.json();
      const courseAssetsResponse = await putCourseAssetsDatabase(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-assets/database",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "replace-teaching-course-assets-database",
              expectedRevision: "rev-empty",
              database: {
                schemaVersion: "uais-teaching-course-assets-v1",
                updatedAt: "2026-06-26T11:00:00.000Z",
                assets: [],
                auditEvents: [],
              },
            }),
          },
        ),
      );
      const courseAssetsBody = await courseAssetsResponse.json();

      expect(courseManagementResponse.status).toBe(503);
      expect(courseManagementBody.error).toBe(
        "Production external storage snapshot replace requires ready managed database adapter proof.",
      );
      expect(courseAssetsResponse.status).toBe(503);
      expect(courseAssetsBody.error).toBe(
        "Production external storage snapshot replace requires ready managed database adapter proof.",
      );
      await expect(
        readFile(join(dataDir, "teaching-course-management", "database.json"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(join(dataDir, "teaching-course-assets", "database.json"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expectSafeResponseBody(courseManagementBody, dataDir);
      expectSafeResponseBody(courseAssetsBody, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed before production backup and restore-drill writes without managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-backup-restore-db-proof-"));
    const env = createProductionEnvWithoutDatabaseAdapter(dataDir);
    const postCourseManagementBackup =
      createExternalStorageTeachingCourseManagementBackupPostHandler({ env });
    const postCourseManagementRestoreDrill =
      createExternalStorageTeachingCourseManagementBackupRestoreDrillPostHandler({
        env,
      });
    const postCourseAssetsBackup =
      createExternalStorageTeachingCourseAssetsBackupPostHandler({ env });
    const postCourseAssetsRestoreDrill =
      createExternalStorageTeachingCourseAssetsBackupRestoreDrillPostHandler({
        env,
      });
    const postTeachingOperationBackup =
      createExternalStorageTeachingOperationBackupPostHandler({ env });
    const postTeachingOperationRestoreDrill =
      createExternalStorageTeachingOperationBackupRestoreDrillPostHandler({ env });

    try {
      const courseManagementBackupResponse = await postCourseManagementBackup(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-management/backups",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "create-teaching-course-management-backup",
              requestedBy: "s12-backup-proof",
              requestedAt: "2026-06-26T11:10:00.000Z",
              traceId: "trace-next-course-management-backup-proof",
            }),
          },
        ),
      );
      const courseManagementRestoreResponse = await postCourseManagementRestoreDrill(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-management/backups/teaching-course-management-backup-20260626-111000/restore-drill",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "verify-teaching-course-management-backup-restore",
              requestedBy: "s12-backup-proof",
              requestedAt: "2026-06-26T11:11:00.000Z",
              traceId: "trace-next-course-management-restore-proof",
            }),
          },
        ),
        {
          params: Promise.resolve({
            backupId: "teaching-course-management-backup-20260626-111000",
          }),
        },
      );
      const courseAssetsBackupResponse = await postCourseAssetsBackup(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-assets/backups",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "create-teaching-course-assets-backup",
              requestedBy: "s12-backup-proof",
              requestedAt: "2026-06-26T11:12:00.000Z",
              traceId: "trace-next-course-assets-backup-proof",
            }),
          },
        ),
      );
      const courseAssetsRestoreResponse = await postCourseAssetsRestoreDrill(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-assets/backups/teaching-course-assets-backup-20260626-111200/restore-drill",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "verify-teaching-course-assets-backup-restore",
              requestedBy: "s12-backup-proof",
              requestedAt: "2026-06-26T11:13:00.000Z",
              traceId: "trace-next-course-assets-restore-proof",
            }),
          },
        ),
        {
          params: Promise.resolve({
            backupId: "teaching-course-assets-backup-20260626-111200",
          }),
        },
      );
      const teachingOperationBackupResponse = await postTeachingOperationBackup(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/backups",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "create-teaching-operation-backup",
              requestedBy: "s12-backup-proof",
              requestedAt: "2026-06-26T11:14:00.000Z",
              traceId: "trace-next-teaching-ops-backup-proof",
            }),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      const teachingOperationRestoreResponse = await postTeachingOperationRestoreDrill(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/backups/teaching-operations-backup-teacher-kang-20260626-111400/restore-drill",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "verify-teaching-operation-backup-restore",
              requestedBy: "s12-backup-proof",
              requestedAt: "2026-06-26T11:15:00.000Z",
              traceId: "trace-next-teaching-ops-restore-proof",
            }),
          },
        ),
        {
          params: Promise.resolve({
            teacherId: "teacher-kang",
            backupId: "teaching-operations-backup-teacher-kang-20260626-111400",
          }),
        },
      );

      const bodies = await Promise.all(
        [
          courseManagementBackupResponse,
          courseManagementRestoreResponse,
          courseAssetsBackupResponse,
          courseAssetsRestoreResponse,
          teachingOperationBackupResponse,
          teachingOperationRestoreResponse,
        ].map(async (response) => ({
          status: response.status,
          body: await response.json(),
        })),
      );

      for (const result of bodies) {
        expect(result.status).toBe(503);
        expect(result.body).toEqual(
          expect.objectContaining({
            error:
              "Production external storage backup and restore drill require ready managed database adapter proof.",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        expectSafeResponseBody(result.body, dataDir);
      }
      await expect(
        readFile(
          join(
            dataDir,
            "teaching-course-management-backups",
            "teaching-course-management-backup-20260626-111000.json",
          ),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(join(dataDir, "teaching-course-management-restore-drills.jsonl"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(
          join(
            dataDir,
            "teaching-course-assets-backups",
            "teaching-course-assets-backup-20260626-111200.json",
          ),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(join(dataDir, "teaching-course-assets-restore-drills.jsonl"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(
          join(
            dataDir,
            "teaching-operation-backups",
            "teacher-kang",
            "teaching-operations-backup-teacher-kang-20260626-111400.json",
          ),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(
          join(dataDir, "teaching-operation-restore-drills", "teacher-kang.jsonl"),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("exposes Next route handlers for course-management and course-asset backup restore drills", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-course-backup-routes-"));
    const previousEnv = {
      token: process.env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN,
      dataDir: process.env.UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR,
      serviceMode: process.env.UAIS_EXTERNAL_STORAGE_SERVICE_MODE,
      adapterProviderClass:
        process.env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS,
      adapterMigrationStatus:
        process.env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS,
      adapterBackupPolicy:
        process.env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY,
      adapterConcurrencyControl:
        process.env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL,
    };
    const adapterEnv = createProductionDatabaseAdapterEnv();
    process.env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN = accessToken;
    process.env.UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR = dataDir;
    process.env.UAIS_EXTERNAL_STORAGE_SERVICE_MODE = "production";
    process.env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS =
      adapterEnv.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS;
    process.env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS =
      adapterEnv.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS;
    process.env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY =
      adapterEnv.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY;
    process.env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL =
      adapterEnv.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL;

    try {
      const managementBackupRoute = await import(
        "@/app/api/external-storage/teaching-course-management/backups/route"
      );
      const managementRestoreDrillRoute = await import(
        "@/app/api/external-storage/teaching-course-management/backups/[backupId]/restore-drill/route"
      );
      const assetsBackupRoute = await import(
        "@/app/api/external-storage/teaching-course-assets/backups/route"
      );
      const assetsRestoreDrillRoute = await import(
        "@/app/api/external-storage/teaching-course-assets/backups/[backupId]/restore-drill/route"
      );

      const managementBackupResponse = await managementBackupRoute.POST(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-management/backups",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "create-teaching-course-management-backup",
              requestedBy: "s12-next-course-management-restore-drill",
              requestedAt: "2026-06-25T12:00:00.000Z",
              traceId: "trace-next-course-management-backup-001",
            }),
          },
        ),
      );
      const managementBackup = await managementBackupResponse.json();

      expect(managementBackupResponse.status).toBe(200);
      expect(managementBackup).toEqual(
        expect.objectContaining({
          backupId: "teaching-course-management-backup-20260625-120000",
          status: "persisted",
          eventType: "teaching-course-management-backup.created",
          sourceRecordCounts: {
            courses: 0,
            classes: 0,
            memberships: 0,
            auditEvents: 0,
          },
          storagePolicy: "external-redacted-teaching-course-management-backup",
          storageWritePolicy: "external-atomic-backup-snapshot",
          responsibleSession: "S12",
        }),
      );

      const managementRestoreDrillResponse = await managementRestoreDrillRoute.POST(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-management/backups/teaching-course-management-backup-20260625-120000/restore-drill",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "verify-teaching-course-management-backup-restore",
              requestedBy: "s12-next-course-management-restore-drill",
              requestedAt: "2026-06-25T12:01:00.000Z",
              traceId: "trace-next-course-management-restore-drill-001",
            }),
          },
        ),
        {
          params: Promise.resolve({
            backupId: "teaching-course-management-backup-20260625-120000",
          }),
        },
      );
      const managementRestoreDrill = await managementRestoreDrillResponse.json();

      expect(managementRestoreDrillResponse.status).toBe(200);
      expect(managementRestoreDrill).toEqual(
        expect.objectContaining({
          backupId: "teaching-course-management-backup-20260625-120000",
          status: "verified",
          eventType: "teaching-course-management-backup.restore-drill-verified",
          restoredRecordCounts: {
            courses: 0,
            classes: 0,
            memberships: 0,
            auditEvents: 0,
          },
          storagePolicy: "external-redacted-teaching-course-management-restore-drill",
          storageWritePolicy: "external-append-only-restore-drill-log",
          responsibleSession: "S12",
        }),
      );

      const assetsBackupResponse = await assetsBackupRoute.POST(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-assets/backups",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "create-teaching-course-assets-backup",
              requestedBy: "s12-next-course-assets-restore-drill",
              requestedAt: "2026-06-25T12:05:00.000Z",
              traceId: "trace-next-course-assets-backup-001",
            }),
          },
        ),
      );
      const assetsBackup = await assetsBackupResponse.json();

      expect(assetsBackupResponse.status).toBe(200);
      expect(assetsBackup).toEqual(
        expect.objectContaining({
          backupId: "teaching-course-assets-backup-20260625-120500",
          status: "persisted",
          eventType: "teaching-course-assets-backup.created",
          sourceRecordCounts: {
            assets: 0,
            auditEvents: 0,
          },
          storagePolicy: "external-redacted-teaching-course-assets-backup",
          storageWritePolicy: "external-atomic-backup-snapshot",
          responsibleSession: "S12",
        }),
      );

      const assetsRestoreDrillResponse = await assetsRestoreDrillRoute.POST(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-course-assets/backups/teaching-course-assets-backup-20260625-120500/restore-drill",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "verify-teaching-course-assets-backup-restore",
              requestedBy: "s12-next-course-assets-restore-drill",
              requestedAt: "2026-06-25T12:06:00.000Z",
              traceId: "trace-next-course-assets-restore-drill-001",
            }),
          },
        ),
        {
          params: Promise.resolve({
            backupId: "teaching-course-assets-backup-20260625-120500",
          }),
        },
      );
      const assetsRestoreDrill = await assetsRestoreDrillResponse.json();

      expect(assetsRestoreDrillResponse.status).toBe(200);
      expect(assetsRestoreDrill).toEqual(
        expect.objectContaining({
          backupId: "teaching-course-assets-backup-20260625-120500",
          status: "verified",
          eventType: "teaching-course-assets-backup.restore-drill-verified",
          restoredRecordCounts: {
            assets: 0,
            auditEvents: 0,
          },
          storagePolicy: "external-redacted-teaching-course-assets-restore-drill",
          storageWritePolicy: "external-append-only-restore-drill-log",
          responsibleSession: "S12",
        }),
      );

      const managementBackupFile = await readFile(
        join(
          dataDir,
          "teaching-course-management-backups",
          "teaching-course-management-backup-20260625-120000.json",
        ),
        "utf8",
      );
      const managementRestoreDrillLog = await readFile(
        join(dataDir, "teaching-course-management-restore-drills.jsonl"),
        "utf8",
      );
      const assetsBackupFile = await readFile(
        join(
          dataDir,
          "teaching-course-assets-backups",
          "teaching-course-assets-backup-20260625-120500.json",
        ),
        "utf8",
      );
      const assetsRestoreDrillLog = await readFile(
        join(dataDir, "teaching-course-assets-restore-drills.jsonl"),
        "utf8",
      );

      expect(managementBackupFile).toContain("trace-next-course-management-backup-001");
      expect(managementRestoreDrillLog).toContain(
        "trace-next-course-management-restore-drill-001",
      );
      expect(assetsBackupFile).toContain("trace-next-course-assets-backup-001");
      expect(assetsRestoreDrillLog).toContain(
        "trace-next-course-assets-restore-drill-001",
      );
      expectSafeResponseBody(managementBackup, dataDir);
      expectSafeResponseBody(managementRestoreDrill, dataDir);
      expectSafeResponseBody(assetsBackup, dataDir);
      expectSafeResponseBody(assetsRestoreDrill, dataDir);
    } finally {
      restoreProcessEnvValue("UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN", previousEnv.token);
      restoreProcessEnvValue(
        "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
        previousEnv.dataDir,
      );
      restoreProcessEnvValue(
        "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
        previousEnv.serviceMode,
      );
      restoreProcessEnvValue(
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
        previousEnv.adapterProviderClass,
      );
      restoreProcessEnvValue(
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
        previousEnv.adapterMigrationStatus,
      );
      restoreProcessEnvValue(
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
        previousEnv.adapterBackupPolicy,
      );
      restoreProcessEnvValue(
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
        previousEnv.adapterConcurrencyControl,
      );
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("serves the external storage contract through route handlers without leaking secrets", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-external-storage-"));
    const env = createEnv(dataDir);
    const getHealth = createExternalStorageHealthGetHandler({ env });
    const getOwnership = createExternalStorageTeacherOwnershipGetHandler({ env });
    const postOwnershipMerge = createExternalStorageTeacherOwnershipMergePostHandler({ env });
    const postTeachingOperationAppend =
      createExternalStorageTeachingOperationAppendPostHandler({ env });
    const getTeachingOperationAuditAlerts =
      createExternalStorageTeachingOperationAuditAlertsGetHandler({ env });
    const getTeachingOperationAuditAlertNotifications =
      createExternalStorageTeachingOperationAuditAlertNotificationsGetHandler({ env });
    const postTeachingOperationAuditAlertNotifications =
      createExternalStorageTeachingOperationAuditAlertNotificationsPostHandler({ env });
    const getTeachingOperationAudit =
      createExternalStorageTeachingOperationAuditGetHandler({ env });
    const getLifecycleAudit = createExternalStorageLifecycleAuditGetHandler({ env });
    const postLifecycleAudit = createExternalStorageLifecycleAuditPostHandler({ env });

    try {
      const healthResponse = await getHealth(
        new Request("https://www.uais.top/api/external-storage/healthz"),
      );
      const health = await healthResponse.json();

      expect(healthResponse.status).toBe(200);
      expect(healthResponse.headers.get("cache-control")).toBe("no-store");
      expect(health).toEqual(
        expect.objectContaining({
          status: "ok",
          target: "uais-external-storage-production-service",
          apiContractVersion: "uais-external-storage-v1",
          productionServiceIdentity: expect.objectContaining({
            status: "proved",
            serviceMode: "production",
            serviceTarget: "uais-external-storage-production-service",
            valueRedacted: true,
          }),
          durableBackingStore: expect.objectContaining({
            status: "ready",
            storageMode: "file-backed",
            probe: "write-read-delete",
            valueRedacted: true,
          }),
          teachingOperationsStorageSchema: {
            status: "ready",
            schemaVersion: "uais-teaching-operations-v1",
            migrationStatus: "up-to-date",
            operationLedger: "jsonl-append-only",
            auditLedger: "jsonl-append-only",
            rollbackLedger: "jsonl-append-only",
            backupStore: "json-atomic-snapshot",
            restoreDrillLog: "jsonl-append-only",
            concurrencyControl: "atomic-append-and-rename",
            productionDatabaseAdapter: {
              status: "ready",
              providerClass: "managed-database",
              migrationStatus: "up-to-date",
              backupPolicy: "point-in-time-restore",
              concurrencyControl: "transactional",
              valueRedacted: true,
            },
            valueRedacted: true,
          },
        }),
      );
      expectSafeResponseBody(health, dataDir);

      const unauthorizedResponse = await getOwnership(
        new Request("https://www.uais.top/api/external-storage/teacher-ai-ownership/teacher-kang"),
        { params: { teacherId: "teacher-kang" } },
      );
      const unauthorized = await unauthorizedResponse.json();
      expect(unauthorizedResponse.status).toBe(401);
      expect(unauthorized.redaction).toEqual({
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      });

      const mergeResponse = await postOwnershipMerge(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teacher-ai-ownership/teacher-kang/merge",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "merge-teacher-ai-ownership",
              updatedAt: "2026-06-20T00:00:00.000Z",
              ownership: {
                teacherId: "teacher-kang",
                courseIds: ["elementary-math-research"],
                sampleAssets: [
                  {
                    sampleAssetId: "teacher-kang-10s-sample",
                    courseId: "elementary-math-research",
                  },
                ],
                pptAssets: [
                  {
                    pptAssetId: "kang-xia-ppt-19",
                    courseId: "elementary-math-research",
                  },
                ],
                clonedVoiceRefs: [
                  {
                    voiceRefId: "qwen-voice-ref-teacher-kang-10s-sample",
                    sampleAssetId: "teacher-kang-10s-sample",
                  },
                ],
                audioManifests: [
                  {
                    audioManifestId: "audio-manifest-kang-xia-ppt-19",
                    courseId: "elementary-math-research",
                    pptAssetId: "kang-xia-ppt-19",
                    voiceRefId: "qwen-voice-ref-teacher-kang-10s-sample",
                  },
                ],
              },
            }),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      const mergeReceipt = await mergeResponse.json();
      expect(mergeResponse.status).toBe(200);
      expect(mergeReceipt).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
        }),
      );
      expectSafeResponseBody(mergeReceipt, dataDir);

      const ownershipResponse = await getOwnership(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teacher-ai-ownership/teacher-kang",
        ),
        { params: { teacherId: "teacher-kang" } },
      );
      const ownership = await ownershipResponse.json();
      expect(ownershipResponse.status).toBe(200);
      expect(ownership.audioManifests).toEqual([
        expect.objectContaining({
          audioManifestId: "audio-manifest-kang-xia-ppt-19",
          pptAssetId: "kang-xia-ppt-19",
        }),
      ]);
      expectSafeResponseBody(ownership, dataDir);

      const teachingAppendResponse = await postTeachingOperationAppend(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/append",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "append-teaching-operation",
              record: {
                recordId: "course-settings-save-course-settings-20260622-110500-abcd1234",
                operationId: "course-settings",
                actionSlot: "primary",
                actionId: "save-course-settings",
                actorId: "teacher-kang",
                courseId: "elementary-math-research",
                createdAt: "2026-06-22T11:05:00.000Z",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
                artifacts: [
                  {
                    kind: "database-record",
                    table: "course_settings",
                    recordId:
                      "course-settings-save-course-settings-20260622-110500-abcd1234",
                  },
                  {
                    kind: "domain-object",
                    objectType: "course-settings",
                    objectId: "course-settings-elementary-math-research",
                  },
                ],
                domainProjections: [
                  {
                    objectId: "course-settings-elementary-math-research",
                    objectType: "course-settings",
                    courseId: "elementary-math-research",
                    updatedBy: "teacher-kang",
                    status: "saved",
                    operationRecordId:
                      "course-settings-save-course-settings-20260622-110500-abcd1234",
                    updatedAt: "2026-06-22T11:05:00.000Z",
                    storagePolicy: "domain-projection-teaching-course-settings",
                    redaction: {
                      secrets: "omitted",
                      localFiles: "omitted",
                      assets: "ids-only",
                    },
                  },
                ],
              },
              auditEvent: {
                auditId: "audit-course-settings-save-course-settings-20260622-110500",
                traceId: "trace-next-teaching-ops-001",
                eventType: "teaching-operation.persisted",
                actorId: "teacher-kang",
                actorRole: "teacher",
                authMode: "signed-teacher-session",
                operationId: "course-settings",
                actionSlot: "primary",
                actionId: "save-course-settings",
                courseId: "elementary-math-research",
                requestSource: {
                  userAgent: "vitest next external storage",
                  ipAddress: "redacted",
                },
                createdAt: "2026-06-22T11:05:00.000Z",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      const teachingAppendReceipt = await teachingAppendResponse.json();
      expect(teachingAppendResponse.status).toBe(200);
      expect(teachingAppendReceipt).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-append",
          storageWritePolicy: "external-append-only-operation-log",
          responsibleSession: "S12",
        }),
      );
      const persistedTeachingOperations = await readFile(
        join(dataDir, "teaching-operations", "teacher-kang.jsonl"),
        "utf8",
      );
      expect(persistedTeachingOperations).toContain("trace-next-teaching-ops-001");
      expect(persistedTeachingOperations).toContain("elementary-math-research");
      const persistedTeachingAuditLedger = await readFile(
        join(dataDir, "teaching-operations-audit", "teacher-kang.jsonl"),
        "utf8",
      );
      expect(persistedTeachingAuditLedger).toContain("trace-next-teaching-ops-001");
      expect(persistedTeachingAuditLedger).toContain(
        "audit-course-settings-save-course-settings-20260622-110500",
      );
      expect(persistedTeachingAuditLedger).not.toContain(accessToken);
      expect(persistedTeachingAuditLedger).not.toContain(dataDir);
      expect(persistedTeachingAuditLedger).not.toContain("/Users/");
      expectSafeResponseBody(teachingAppendReceipt, dataDir);

      const teachingAuditResponse = await getTeachingOperationAudit(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/audit",
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      const teachingAudit = await teachingAuditResponse.json();
      expect(teachingAuditResponse.status).toBe(200);
      expect(teachingAudit).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit",
          storagePolicy: "external-redacted-teaching-operation-audit-log",
          storageWritePolicy: "external-append-only-audit-log",
          responsibleSession: "S12",
          recordCount: 1,
          operationRecordCount: 1,
          domainProjectionCount: 1,
        }),
      );
      expect(teachingAudit.records).toEqual([
        expect.objectContaining({
          recordId: "course-settings-save-course-settings-20260622-110500-abcd1234",
          operationId: "course-settings",
          actionSlot: "primary",
          actionId: "save-course-settings",
          actorId: "teacher-kang",
          courseId: "elementary-math-research",
        }),
      ]);
      expect(teachingAudit.events).toEqual([
        expect.objectContaining({
          auditId: "audit-course-settings-save-course-settings-20260622-110500",
          traceId: "trace-next-teaching-ops-001",
          actorId: "teacher-kang",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          courseId: "elementary-math-research",
        }),
      ]);
      expect(teachingAudit.domainProjections).toEqual([
        expect.objectContaining({
          objectId: "course-settings-elementary-math-research",
          objectType: "course-settings",
          courseId: "elementary-math-research",
          operationRecordId:
            "course-settings-save-course-settings-20260622-110500-abcd1234",
          storagePolicy: "domain-projection-teaching-course-settings",
        }),
      ]);
      expectSafeResponseBody(teachingAudit, dataDir);

      const teachingAppendWithoutCourseResponse = await postTeachingOperationAppend(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/append",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "append-teaching-operation",
              record: {
                recordId: "admins-send-admin-email-20260622-110600-alert001",
                operationId: "admins",
                actionSlot: "secondary",
                actionId: "send-admin-email",
                actorId: "teacher-kang",
                createdAt: "2026-06-22T11:06:00.000Z",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
                artifacts: [
                  {
                    kind: "notification-record",
                    notificationId: "admin-email-20260622-110600-alert001",
                  },
                ],
              },
              auditEvent: {
                auditId: "audit-admins-send-admin-email-20260622-110600",
                traceId: "trace-next-teaching-ops-missing-course",
                eventType: "teaching-operation.persisted",
                actorId: "teacher-kang",
                actorRole: "teacher",
                authMode: "signed-teacher-session",
                operationId: "admins",
                actionSlot: "secondary",
                actionId: "send-admin-email",
                requestSource: {
                  userAgent: "vitest next external storage",
                  ipAddress: "redacted",
                },
                createdAt: "2026-06-22T11:06:00.000Z",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      expect(teachingAppendWithoutCourseResponse.status).toBe(200);

      const teachingAuditAlertsResponse = await getTeachingOperationAuditAlerts(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/audit/alerts",
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      const teachingAuditAlerts = await teachingAuditAlertsResponse.json();
      expect(teachingAuditAlertsResponse.status).toBe(200);
      expect(teachingAuditAlerts).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          status: "attention-required",
          eventType: "teaching-operation-audit-alert-summary",
          storagePolicy: "external-redacted-teaching-operation-audit-alerts",
          sourceStoragePolicy: "external-redacted-teaching-operation-audit-log",
          alertCount: 1,
          responsibleSession: "S12",
        }),
      );
      expect(teachingAuditAlerts.alertPolicy).toEqual(
        expect.objectContaining({
          policyId: "s12-teaching-operation-audit-alerts-v1",
          checks: ["missing-course-context"],
        }),
      );
      expect(teachingAuditAlerts.alerts).toEqual([
        expect.objectContaining({
          alertId:
            "missing-course-context-audit-admins-send-admin-email-20260622-110600",
          severity: "high",
          reason: "missing-course-context",
          auditId: "audit-admins-send-admin-email-20260622-110600",
          traceId: "trace-next-teaching-ops-missing-course",
          actorId: "teacher-kang",
          operationId: "admins",
          actionId: "send-admin-email",
        }),
      ]);
      expectSafeResponseBody(teachingAuditAlerts, dataDir);

      const teachingAuditAlertNotificationResponse =
        await postTeachingOperationAuditAlertNotifications(
          authorizedRequest(
            "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/audit/alerts/notifications",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "enqueue-teaching-operation-audit-alert-notifications",
                requestedBy: "s12-audit-monitor",
                requestedAt: "2026-06-22T11:07:00.000Z",
              }),
            },
          ),
          { params: Promise.resolve({ teacherId: "teacher-kang" }) },
        );
      const teachingAuditAlertNotification =
        await teachingAuditAlertNotificationResponse.json();
      expect(teachingAuditAlertNotificationResponse.status).toBe(200);
      expect(teachingAuditAlertNotification).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          status: "queued",
          eventType: "teaching-operation-audit-alert-notification-dispatch",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          storageWritePolicy: "external-append-only-notification-outbox",
          notificationCount: 1,
          responsibleSession: "S12",
        }),
      );
      expect(teachingAuditAlertNotification.notifications).toEqual([
        expect.objectContaining({
          notificationId:
            "alert-notification-missing-course-context-audit-admins-send-admin-email-20260622-110600",
          deliveryStatus: "queued",
          alertId:
            "missing-course-context-audit-admins-send-admin-email-20260622-110600",
          auditId: "audit-admins-send-admin-email-20260622-110600",
          traceId: "trace-next-teaching-ops-missing-course",
          actorId: "teacher-kang",
          requestedBy: "s12-audit-monitor",
        }),
      ]);
      const persistedTeachingAlertNotifications = await readFile(
        join(
          dataDir,
          "teaching-operation-alert-notifications",
          "teacher-kang.jsonl",
        ),
        "utf8",
      );
      expect(persistedTeachingAlertNotifications).toContain(
        "trace-next-teaching-ops-missing-course",
      );
      expect(persistedTeachingAlertNotifications).toContain(
        "missing-course-context-audit-admins-send-admin-email-20260622-110600",
      );
      expect(persistedTeachingAlertNotifications).not.toContain(accessToken);
      expect(persistedTeachingAlertNotifications).not.toContain(dataDir);
      expect(persistedTeachingAlertNotifications).not.toContain("/Users/");
      expectSafeResponseBody(teachingAuditAlertNotification, dataDir);

      const teachingAuditAlertNotificationIndexResponse =
        await getTeachingOperationAuditAlertNotifications(
          authorizedRequest(
            "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/audit/alerts/notifications",
          ),
          { params: Promise.resolve({ teacherId: "teacher-kang" }) },
        );
      const teachingAuditAlertNotificationIndex =
        await teachingAuditAlertNotificationIndexResponse.json();
      expect(teachingAuditAlertNotificationIndexResponse.status).toBe(200);
      expect(teachingAuditAlertNotificationIndex).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit-alert-notification-outbox",
          deliveryChannel: "admin-outbox",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          recordCount: 1,
          responsibleSession: "S12",
        }),
      );
      expect(teachingAuditAlertNotificationIndex.notifications).toEqual([
        expect.objectContaining({
          notificationId:
            "alert-notification-missing-course-context-audit-admins-send-admin-email-20260622-110600",
          deliveryStatus: "queued",
          traceId: "trace-next-teaching-ops-missing-course",
        }),
      ]);
      expectSafeResponseBody(teachingAuditAlertNotificationIndex, dataDir);

      const lifecycleAppendResponse = await postLifecycleAudit(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/qwen-voice-lifecycle-audit",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              eventId: "qwen-voice-lifecycle-qwen-voice-ref-teacher-kang-20260620",
              eventType: "qwen-voice-lifecycle",
              provider: "qwen",
              providerRole: "voice-clone",
              action: "voice-clone-revoke",
              status: "recorded",
              occurredAt: "2026-06-20T00:00:00.000Z",
              actor: { actorId: "teacher-kang", role: "teacher" },
              resource: {
                teacherId: "teacher-kang",
                sampleAssetId: "teacher-kang-10s-sample",
                voiceRefId: "qwen-voice-ref-teacher-kang-10s-sample",
              },
              deletionReason: "owner-request",
              providerRevocation: { status: "revoked" },
              localReference: { status: "deleted" },
              localAuditRecord: {
                auditId: "local-audit-qwen-voice-ref-teacher-kang-20260620",
                storagePolicy: "local-redacted-lifecycle-audit",
              },
              storagePolicy: "append-only-redacted-lifecycle-audit",
              responsibleSession: "S12/S24",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            }),
          },
        ),
      );
      const lifecycleReceipt = await lifecycleAppendResponse.json();
      expect(lifecycleAppendResponse.status).toBe(200);
      expect(lifecycleReceipt).toEqual(
        expect.objectContaining({
          eventId: "qwen-voice-lifecycle-qwen-voice-ref-teacher-kang-20260620",
          status: "recorded",
          storagePolicy: "append-only-redacted-lifecycle-audit",
        }),
      );
      expectSafeResponseBody(lifecycleReceipt, dataDir);

      const lifecycleIndexResponse = await getLifecycleAudit(
        authorizedRequest("https://www.uais.top/api/external-storage/qwen-voice-lifecycle-audit"),
      );
      const lifecycleIndex = await lifecycleIndexResponse.json();
      expect(lifecycleIndexResponse.status).toBe(200);
      expect(lifecycleIndex.recordCount).toBe(1);
      expect(lifecycleIndex.events[0]).toEqual(
        expect.objectContaining({
          eventId: "qwen-voice-lifecycle-qwen-voice-ref-teacher-kang-20260620",
          provider: "qwen",
          providerRole: "voice-clone",
        }),
      );
      expectSafeResponseBody(lifecycleIndex, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("delivers teaching operation audit alert notifications to a configured admin webhook with redacted evidence", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-external-storage-webhook-"));
    const adminAlertWebhookUrl = "https://alerts.example.test/uais-admin-alerts";
    const adminAlertWebhookToken = "test-admin-alert-webhook-token";
    const env = {
      ...createEnv(dataDir),
      UAIS_EXTERNAL_STORAGE_ADMIN_ALERT_WEBHOOK_URL: adminAlertWebhookUrl,
      UAIS_EXTERNAL_STORAGE_ADMIN_ALERT_WEBHOOK_TOKEN: adminAlertWebhookToken,
    };
    const webhookRequests: Array<{
      url: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const webhookFetch: typeof fetch = async (input, init) => {
      const webhookRequest = new Request(input, init);
      webhookRequests.push({
        url: webhookRequest.url,
        authorization: webhookRequest.headers.get("authorization"),
        body: await webhookRequest.json(),
      });

      return new Response(JSON.stringify({ status: "accepted" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    };
    const deps = { env, fetch: webhookFetch };
    const postTeachingOperationAppend =
      createExternalStorageTeachingOperationAppendPostHandler(deps);
    const postTeachingOperationAuditAlertNotifications =
      createExternalStorageTeachingOperationAuditAlertNotificationsPostHandler(deps);

    try {
      const teachingAppendWithoutCourseResponse = await postTeachingOperationAppend(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/append",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "append-teaching-operation",
              record: {
                recordId: "admins-send-admin-email-20260622-120000-alertwebhook",
                operationId: "admins",
                actionSlot: "secondary",
                actionId: "send-admin-email",
                actorId: "teacher-kang",
                createdAt: "2026-06-22T12:00:00.000Z",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
                artifacts: [
                  {
                    kind: "notification-record",
                    notificationId: "admin-email-20260622-120000-alertwebhook",
                  },
                ],
              },
              auditEvent: {
                auditId: "audit-admins-send-admin-email-20260622-120000",
                traceId: "trace-next-teaching-ops-alert-webhook",
                eventType: "teaching-operation.persisted",
                actorId: "teacher-kang",
                actorRole: "teacher",
                authMode: "signed-teacher-session",
                operationId: "admins",
                actionSlot: "secondary",
                actionId: "send-admin-email",
                requestSource: {
                  userAgent: "vitest next external storage webhook",
                  ipAddress: "redacted",
                },
                createdAt: "2026-06-22T12:00:00.000Z",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      expect(teachingAppendWithoutCourseResponse.status).toBe(200);

      const notificationResponse =
        await postTeachingOperationAuditAlertNotifications(
          authorizedRequest(
            "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/audit/alerts/notifications",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "enqueue-teaching-operation-audit-alert-notifications",
                requestedBy: "s12-audit-monitor",
                requestedAt: "2026-06-22T12:01:00.000Z",
              }),
            },
          ),
          { params: Promise.resolve({ teacherId: "teacher-kang" }) },
        );
      const notificationBody = await notificationResponse.json();

      expect(notificationResponse.status).toBe(200);
      expect(webhookRequests).toHaveLength(1);
      expect(webhookRequests[0]).toEqual(
        expect.objectContaining({
          url: adminAlertWebhookUrl,
          authorization: `Bearer ${adminAlertWebhookToken}`,
        }),
      );
      expect(webhookRequests[0].body).toEqual(
        expect.objectContaining({
          eventType: "teaching-operation-audit-alert-notification-webhook",
          teacherId: "teacher-kang",
          requestedBy: "s12-audit-monitor",
          requestedAt: "2026-06-22T12:01:00.000Z",
          notificationCount: 1,
          notifications: [
            expect.objectContaining({
              notificationId:
                "alert-notification-missing-course-context-audit-admins-send-admin-email-20260622-120000",
              traceId: "trace-next-teaching-ops-alert-webhook",
            }),
          ],
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(notificationBody).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          status: "queued",
          deliveryChannel: "admin-outbox",
          notificationCount: 1,
          externalDelivery: expect.objectContaining({
            eventType: "teaching-operation-audit-alert-webhook-delivery",
            deliveryChannel: "admin-webhook",
            deliveryStatus: "delivered",
            provider: "configured-admin-alert-webhook",
            endpoint: "redacted",
            responseStatus: 202,
            notificationCount: 1,
            storagePolicy:
              "external-redacted-teaching-operation-audit-alert-webhook-delivery",
            storageWritePolicy: "external-append-only-webhook-delivery-ledger",
            responsibleSession: "S12",
          }),
        }),
      );
      const persistedDeliveryLedger = await readFile(
        join(
          dataDir,
          "teaching-operation-alert-webhook-deliveries",
          "teacher-kang.jsonl",
        ),
        "utf8",
      );
      expect(persistedDeliveryLedger).toContain(
        "trace-next-teaching-ops-alert-webhook",
      );
      expect(persistedDeliveryLedger).toContain(
        "external-redacted-teaching-operation-audit-alert-webhook-delivery",
      );
      expect(persistedDeliveryLedger).not.toContain(accessToken);
      expect(persistedDeliveryLedger).not.toContain(adminAlertWebhookToken);
      expect(persistedDeliveryLedger).not.toContain(adminAlertWebhookUrl);
      expect(persistedDeliveryLedger).not.toContain(dataDir);
      expect(persistedDeliveryLedger).not.toContain("/Users/");
      expectSafeResponseBody(notificationBody, dataDir);
      expect(JSON.stringify(notificationBody)).not.toContain(adminAlertWebhookToken);
      expect(JSON.stringify(notificationBody)).not.toContain(adminAlertWebhookUrl);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed before appending production teaching operations without managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-teaching-ops-db-proof-"));
    const env = createProductionEnvWithoutDatabaseAdapter(dataDir);
    const postTeachingOperationAppend =
      createExternalStorageTeachingOperationAppendPostHandler({ env });

    try {
      const response = await postTeachingOperationAppend(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/append",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "append-teaching-operation",
              record: {
                recordId: "course-settings-save-course-settings-20260626-db-proof",
                operationId: "course-settings",
                actionSlot: "primary",
                actionId: "save-course-settings",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                createdAt: "2026-06-26T10:10:00.000Z",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
                artifacts: [],
              },
            }),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error:
            "Production external storage append requires ready managed database adapter proof.",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      await expect(
        readFile(join(dataDir, "teaching-operations", "teacher-kang.jsonl"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expectSafeResponseBody(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("treats repeated teaching operation append requests as idempotent without duplicating ledgers", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-teaching-ops-idempotent-"));
    const env = createEnv(dataDir);
    const postTeachingOperationAppend =
      createExternalStorageTeachingOperationAppendPostHandler({ env });
    const getTeachingOperationAudit =
      createExternalStorageTeachingOperationAuditGetHandler({ env });
    const appendPayload = {
      action: "append-teaching-operation",
      record: {
        recordId: "course-settings-save-course-settings-20260623-idempotent",
        operationId: "course-settings",
        actionSlot: "primary",
        actionId: "save-course-settings",
        actorId: "teacher-kang",
        courseId: "teacher-research-methods",
        createdAt: "2026-06-23T10:00:00.000Z",
        status: "persisted",
        storagePolicy: "external-redacted-teaching-operation-append",
        storageWritePolicy: "external-append-only-operation-log",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
        artifacts: [],
        domainProjections: [
          {
            objectId: "course-settings-teacher-research-methods",
            objectType: "course-settings",
            courseId: "teacher-research-methods",
            updatedBy: "teacher-kang",
            status: "saved",
            operationRecordId: "course-settings-save-course-settings-20260623-idempotent",
            updatedAt: "2026-06-23T10:00:00.000Z",
            storagePolicy: "domain-projection-teaching-course-settings",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          },
        ],
      },
      auditEvent: {
        auditId: "audit-course-settings-save-course-settings-20260623-idempotent",
        traceId: "trace-next-teaching-ops-idempotent",
        eventType: "teaching-operation.persisted",
        actorId: "teacher-kang",
        actorRole: "teacher",
        authMode: "signed-teacher-session",
        operationId: "course-settings",
        actionSlot: "primary",
        actionId: "save-course-settings",
        courseId: "teacher-research-methods",
        requestSource: {
          userAgent: "vitest next external storage idempotency",
          ipAddress: "redacted",
        },
        createdAt: "2026-06-23T10:00:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      },
    };

    try {
      const firstResponse = await postTeachingOperationAppend(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/append",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(appendPayload),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      const firstReceipt = await firstResponse.json();
      const retryResponse = await postTeachingOperationAppend(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/append",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(appendPayload),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      const retryReceipt = await retryResponse.json();

      expect(firstResponse.status).toBe(200);
      expect(firstReceipt).toEqual(
        expect.objectContaining({
          status: "persisted",
          idempotencyStatus: "created",
          appendSequence: 1,
        }),
      );
      expect(retryResponse.status).toBe(200);
      expect(retryReceipt).toEqual(
        expect.objectContaining({
          status: "persisted",
          idempotencyStatus: "already-persisted",
          receiptId: "course-settings-save-course-settings-20260623-idempotent",
          appendSequence: 1,
          storagePolicy: "external-redacted-teaching-operation-append",
          storageWritePolicy: "external-append-only-operation-log",
        }),
      );
      const persistedTeachingOperations = await readFile(
        join(dataDir, "teaching-operations", "teacher-kang.jsonl"),
        "utf8",
      );
      const persistedTeachingAuditLedger = await readFile(
        join(dataDir, "teaching-operations-audit", "teacher-kang.jsonl"),
        "utf8",
      );
      expect(persistedTeachingOperations.trim().split(/\r?\n/)).toHaveLength(1);
      expect(persistedTeachingAuditLedger.trim().split(/\r?\n/)).toHaveLength(1);

      const auditResponse = await getTeachingOperationAudit(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/audit",
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      const audit = await auditResponse.json();
      expect(auditResponse.status).toBe(200);
      expect(audit).toEqual(
        expect.objectContaining({
          recordCount: 1,
          operationRecordCount: 1,
          domainProjectionCount: 1,
        }),
      );
      expect(audit.records).toHaveLength(1);
      expect(audit.records[0]).toEqual(
        expect.objectContaining({
          recordId: "course-settings-save-course-settings-20260623-idempotent",
          appendSequence: 1,
        }),
      );
      expect(audit.events).toHaveLength(1);
      expectSafeResponseBody(firstReceipt, dataDir);
      expectSafeResponseBody(retryReceipt, dataDir);
      expectSafeResponseBody(audit, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects teaching operation append retries that reuse a record id for a different payload", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-teaching-ops-id-conflict-"));
    const env = createEnv(dataDir);
    const postTeachingOperationAppend =
      createExternalStorageTeachingOperationAppendPostHandler({ env });
    const appendPayload = {
      action: "append-teaching-operation",
      record: {
        recordId: "course-settings-save-course-settings-20260623-conflict",
        operationId: "course-settings",
        actionSlot: "primary",
        actionId: "save-course-settings",
        actorId: "teacher-kang",
        courseId: "teacher-research-methods",
        createdAt: "2026-06-23T10:10:00.000Z",
        status: "persisted",
        storagePolicy: "external-redacted-teaching-operation-append",
        storageWritePolicy: "external-append-only-operation-log",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
        artifacts: [],
      },
      auditEvent: {
        auditId: "audit-course-settings-save-course-settings-20260623-conflict",
        traceId: "trace-next-teaching-ops-conflict",
        eventType: "teaching-operation.persisted",
        actorId: "teacher-kang",
        actorRole: "teacher",
        authMode: "signed-teacher-session",
        operationId: "course-settings",
        actionSlot: "primary",
        actionId: "save-course-settings",
        courseId: "teacher-research-methods",
        requestSource: {
          userAgent: "vitest next external storage conflict",
          ipAddress: "redacted",
        },
        createdAt: "2026-06-23T10:10:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      },
    };
    const conflictingPayload = {
      ...appendPayload,
      record: {
        ...appendPayload.record,
        courseId: "other-teacher-course",
      },
      auditEvent: {
        ...appendPayload.auditEvent,
        courseId: "other-teacher-course",
      },
    };

    try {
      const firstResponse = await postTeachingOperationAppend(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/append",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(appendPayload),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      expect(firstResponse.status).toBe(200);

      const conflictResponse = await postTeachingOperationAppend(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/append",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(conflictingPayload),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      const conflict = await conflictResponse.json();

      expect(conflictResponse.status).toBe(409);
      expect(conflict).toEqual(
        expect.objectContaining({
          error: "Teaching operation record id already exists.",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      const persistedTeachingOperations = await readFile(
        join(dataDir, "teaching-operations", "teacher-kang.jsonl"),
        "utf8",
      );
      const persistedTeachingAuditLedger = await readFile(
        join(dataDir, "teaching-operations-audit", "teacher-kang.jsonl"),
        "utf8",
      );
      expect(persistedTeachingOperations.trim().split(/\r?\n/)).toHaveLength(1);
      expect(persistedTeachingAuditLedger.trim().split(/\r?\n/)).toHaveLength(1);
      expect(persistedTeachingOperations).not.toContain("other-teacher-course");
      expect(persistedTeachingAuditLedger).not.toContain("other-teacher-course");
      expectSafeResponseBody(conflict, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("persists teaching operation rollback records with audit evidence through route handlers", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-external-storage-rollback-"));
    const env = createEnv(dataDir);
    const postTeachingOperationAppend =
      createExternalStorageTeachingOperationAppendPostHandler({ env });
    const postTeachingOperationRollback =
      createExternalStorageTeachingOperationRollbackPostHandler({ env });
    const getTeachingOperationAudit =
      createExternalStorageTeachingOperationAuditGetHandler({ env });

    try {
      const targetRecordId =
        "course-settings-save-course-settings-20260622-110500-abcd1234";
      const appendResponse = await postTeachingOperationAppend(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/append",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "append-teaching-operation",
              record: {
                recordId: targetRecordId,
                operationId: "course-settings",
                actionSlot: "primary",
                actionId: "save-course-settings",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                createdAt: "2026-06-22T11:05:00.000Z",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
                artifacts: [
                  {
                    kind: "database-record",
                    table: "course_settings",
                    recordId: targetRecordId,
                  },
                ],
              },
              auditEvent: {
                auditId: "audit-course-settings-save-course-settings-20260622-110500",
                traceId: "trace-next-teaching-ops-rollback-before",
                eventType: "teaching-operation.persisted",
                actorId: "teacher-kang",
                actorRole: "teacher",
                authMode: "signed-teacher-session",
                operationId: "course-settings",
                actionSlot: "primary",
                actionId: "save-course-settings",
                courseId: "teacher-research-methods",
                requestSource: {
                  userAgent: "vitest next external storage rollback",
                  ipAddress: "redacted",
                },
                createdAt: "2026-06-22T11:05:00.000Z",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      expect(appendResponse.status).toBe(200);

      const rollbackResponse = await postTeachingOperationRollback(
        authorizedRequest(
          `https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/records/${targetRecordId}/rollback`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "rollback-teaching-operation-record",
              courseId: "teacher-research-methods",
              rollbackReason: "teacher-control-plane-test",
              traceId: "trace-next-teaching-ops-rollback-001",
              requestedAt: "2026-06-22T11:25:00.000Z",
              requestSource: {
                userAgent: "vitest next external storage rollback",
                ipAddress: "redacted",
              },
            }),
          },
        ),
        {
          params: Promise.resolve({
            teacherId: "teacher-kang",
            recordId: targetRecordId,
          }),
        },
      );
      const rollback = await rollbackResponse.json();

      expect(rollbackResponse.status).toBe(200);
      expect(rollback).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          rollbackId: `teaching-operation-rollback-${targetRecordId}`,
          targetRecordId,
          courseId: "teacher-research-methods",
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-rollback",
          storageWritePolicy: "external-append-only-rollback-log",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      const persistedRollbacks = await readFile(
        join(dataDir, "teaching-operation-rollbacks", "teacher-kang.jsonl"),
        "utf8",
      );
      expect(persistedRollbacks).toContain(targetRecordId);
      expect(persistedRollbacks).toContain("teacher-control-plane-test");
      expect(persistedRollbacks).not.toContain(accessToken);
      expect(persistedRollbacks).not.toContain(dataDir);
      expect(persistedRollbacks).not.toContain("/Users/");

      const persistedAuditLedger = await readFile(
        join(dataDir, "teaching-operations-audit", "teacher-kang.jsonl"),
        "utf8",
      );
      expect(persistedAuditLedger).toContain("teaching-operation.rolled-back");
      expect(persistedAuditLedger).toContain("trace-next-teaching-ops-rollback-001");
      expect(persistedAuditLedger).not.toContain(accessToken);
      expect(persistedAuditLedger).not.toContain(dataDir);
      expect(persistedAuditLedger).not.toContain("/Users/");

      const auditResponse = await getTeachingOperationAudit(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/audit",
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      const audit = await auditResponse.json();
      expect(auditResponse.status).toBe(200);
      expect(audit).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit",
          recordCount: 2,
        }),
      );
      expect(audit.events).toContainEqual(
        expect.objectContaining({
          eventType: "teaching-operation.rolled-back",
          traceId: "trace-next-teaching-ops-rollback-001",
          targetRecordId,
          rollbackReason: "teacher-control-plane-test",
          courseId: "teacher-research-methods",
        }),
      );
      expectSafeResponseBody(rollback, dataDir);
      expectSafeResponseBody(audit, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when a teaching operation alert notification ledger contains a cross-teacher row", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-alert-notification-scope-"));
    const env = createEnv(dataDir);
    const getTeachingOperationAuditAlertNotifications =
      createExternalStorageTeachingOperationAuditAlertNotificationsGetHandler({ env });

    try {
      await mkdir(join(dataDir, "teaching-operation-alert-notifications"), {
        recursive: true,
      });
      await appendFile(
        join(dataDir, "teaching-operation-alert-notifications", "teacher-kang.jsonl"),
        `${JSON.stringify({
          notificationId: "alert-notification-cross-teacher",
          eventType: "teaching-operation-audit-alert-notification",
          deliveryChannel: "admin-outbox",
          deliveryStatus: "queued",
          teacherId: "teacher-other",
          alertId: "missing-course-context-audit-cross-teacher",
          severity: "high",
          reason: "missing-course-context",
          auditId: "audit-cross-teacher",
          traceId: "trace-cross-teacher-alert",
          actorId: "teacher-other",
          operationId: "admins",
          actionSlot: "secondary",
          actionId: "send-admin-email",
          requestedBy: "s12-audit-monitor",
          requestedAt: "2026-06-22T11:40:00.000Z",
          queuedAt: "2026-06-22T11:40:00.000Z",
          storagePolicy:
            "external-redacted-teaching-operation-audit-alert-notification-outbox",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        })}\n`,
        "utf8",
      );

      const response = await getTeachingOperationAuditAlertNotifications(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/audit/alerts/notifications",
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: "External storage service request failed.",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      expect(JSON.stringify(body)).not.toContain("teacher-other");
      expectSafeResponseBody(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed before production teaching operation rollbacks without managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-rollback-db-proof-"));
    const readyEnv = createEnv(dataDir);
    const blockedEnv = createProductionEnvWithoutDatabaseAdapter(dataDir);
    const postTeachingOperationAppend =
      createExternalStorageTeachingOperationAppendPostHandler({ env: readyEnv });
    const postTeachingOperationRollback =
      createExternalStorageTeachingOperationRollbackPostHandler({ env: blockedEnv });

    try {
      const targetRecordId =
        "course-settings-save-course-settings-20260626-rollback-proof";
      const appendResponse = await postTeachingOperationAppend(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/append",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "append-teaching-operation",
              record: {
                recordId: targetRecordId,
                operationId: "course-settings",
                actionSlot: "primary",
                actionId: "save-course-settings",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                createdAt: "2026-06-26T11:20:00.000Z",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
                artifacts: [],
              },
            }),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      expect(appendResponse.status).toBe(200);

      const rollbackResponse = await postTeachingOperationRollback(
        authorizedRequest(
          `https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/records/${targetRecordId}/rollback`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "rollback-teaching-operation-record",
              courseId: "teacher-research-methods",
              rollbackReason: "production-db-proof-required",
              traceId: "trace-next-teaching-ops-rollback-proof",
              requestedAt: "2026-06-26T11:21:00.000Z",
              requestSource: {
                userAgent: "vitest next rollback db proof",
                ipAddress: "redacted",
              },
            }),
          },
        ),
        {
          params: Promise.resolve({
            teacherId: "teacher-kang",
            recordId: targetRecordId,
          }),
        },
      );
      const body = await rollbackResponse.json();

      expect(rollbackResponse.status).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error:
            "Production external storage rollback requires ready managed database adapter proof.",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      await expect(
        readFile(
          join(dataDir, "teaching-operation-rollbacks", "teacher-kang.jsonl"),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(
          join(dataDir, "teaching-operations-audit", "teacher-kang.jsonl"),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expectSafeResponseBody(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("creates and verifies a teaching operation backup restore drill through route handlers", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-next-external-storage-restore-drill-"));
    const env = createEnv(dataDir);
    const postTeachingOperationAppend =
      createExternalStorageTeachingOperationAppendPostHandler({ env });
    const postTeachingOperationBackup =
      createExternalStorageTeachingOperationBackupPostHandler({ env });
    const postTeachingOperationRestoreDrill =
      createExternalStorageTeachingOperationBackupRestoreDrillPostHandler({ env });

    try {
      const recordId = "course-settings-save-course-settings-20260622-113000-abcd1234";
      const appendResponse = await postTeachingOperationAppend(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/append",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "append-teaching-operation",
              record: {
                recordId,
                operationId: "course-settings",
                actionSlot: "primary",
                actionId: "save-course-settings",
                actorId: "teacher-kang",
                courseId: "teacher-research-methods",
                createdAt: "2026-06-22T11:30:00.000Z",
                status: "persisted",
                storagePolicy: "external-redacted-teaching-operation-append",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
                artifacts: [
                  {
                    kind: "database-record",
                    table: "course_settings",
                    recordId,
                  },
                ],
              },
              auditEvent: {
                auditId: "audit-course-settings-save-course-settings-20260622-113000",
                traceId: "trace-next-teaching-ops-backup-source",
                eventType: "teaching-operation.persisted",
                actorId: "teacher-kang",
                actorRole: "teacher",
                authMode: "signed-teacher-session",
                operationId: "course-settings",
                actionSlot: "primary",
                actionId: "save-course-settings",
                courseId: "teacher-research-methods",
                requestSource: {
                  userAgent: "vitest next external storage restore drill",
                  ipAddress: "redacted",
                },
                createdAt: "2026-06-22T11:30:00.000Z",
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "ids-only",
                },
              },
            }),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      expect(appendResponse.status).toBe(200);

      const backupResponse = await postTeachingOperationBackup(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/backups",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "create-teaching-operation-backup",
              requestedBy: "s12-restore-drill",
              requestedAt: "2026-06-22T11:35:00.000Z",
              traceId: "trace-next-teaching-ops-backup-001",
            }),
          },
        ),
        { params: Promise.resolve({ teacherId: "teacher-kang" }) },
      );
      const backup = await backupResponse.json();

      expect(backupResponse.status).toBe(200);
      expect(backup).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          backupId: "teaching-operations-backup-teacher-kang-20260622-113500",
          status: "persisted",
          eventType: "teaching-operation-backup.created",
          traceId: "trace-next-teaching-ops-backup-001",
          requestedBy: "s12-restore-drill",
          sourceRecordCounts: {
            operations: 1,
            auditEvents: 1,
            rollbacks: 0,
            alertNotifications: 0,
          },
          storagePolicy: "external-redacted-teaching-operation-backup",
          storageWritePolicy: "external-atomic-backup-snapshot",
          responsibleSession: "S12",
        }),
      );
      const persistedBackup = await readFile(
        join(
          dataDir,
          "teaching-operation-backups",
          "teacher-kang",
          "teaching-operations-backup-teacher-kang-20260622-113500.json",
        ),
        "utf8",
      );
      expect(persistedBackup).toContain(recordId);
      expect(persistedBackup).toContain("trace-next-teaching-ops-backup-source");
      expect(persistedBackup).not.toContain(accessToken);
      expect(persistedBackup).not.toContain(dataDir);
      expect(persistedBackup).not.toContain("/Users/");

      const restoreDrillResponse = await postTeachingOperationRestoreDrill(
        authorizedRequest(
          "https://www.uais.top/api/external-storage/teaching-operations/teacher-kang/backups/teaching-operations-backup-teacher-kang-20260622-113500/restore-drill",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "verify-teaching-operation-backup-restore",
              requestedBy: "s12-restore-drill",
              requestedAt: "2026-06-22T11:36:00.000Z",
              traceId: "trace-next-teaching-ops-restore-drill-001",
            }),
          },
        ),
        {
          params: Promise.resolve({
            teacherId: "teacher-kang",
            backupId: "teaching-operations-backup-teacher-kang-20260622-113500",
          }),
        },
      );
      const restoreDrill = await restoreDrillResponse.json();

      expect(restoreDrillResponse.status).toBe(200);
      expect(restoreDrill).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          backupId: "teaching-operations-backup-teacher-kang-20260622-113500",
          drillId:
            "teaching-operations-restore-drill-teaching-operations-backup-teacher-kang-20260622-113500",
          status: "verified",
          eventType: "teaching-operation-backup.restore-drill-verified",
          traceId: "trace-next-teaching-ops-restore-drill-001",
          restoredRecordCounts: {
            operations: 1,
            auditEvents: 1,
            rollbacks: 0,
            alertNotifications: 0,
          },
          storagePolicy: "external-redacted-teaching-operation-restore-drill",
          storageWritePolicy: "external-append-only-restore-drill-log",
          responsibleSession: "S12",
        }),
      );
      const persistedRestoreDrill = await readFile(
        join(dataDir, "teaching-operation-restore-drills", "teacher-kang.jsonl"),
        "utf8",
      );
      expect(persistedRestoreDrill).toContain(
        "trace-next-teaching-ops-restore-drill-001",
      );
      expect(persistedRestoreDrill).toContain(
        "teaching-operations-backup-teacher-kang-20260622-113500",
      );
      expect(persistedRestoreDrill).not.toContain(accessToken);
      expect(persistedRestoreDrill).not.toContain(dataDir);
      expect(persistedRestoreDrill).not.toContain("/Users/");
      expectSafeResponseBody(backup, dataDir);
      expectSafeResponseBody(restoreDrill, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns a redacted blocked health response when the durable backing store probe fails", async () => {
    const escapedDataDir = join(tmpdir(), "..", "..");
    const getHealth = createExternalStorageHealthGetHandler({
      env: {
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
        UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR: escapedDataDir,
        UAIS_EXTERNAL_STORAGE_SERVICE_MODE: "production",
      },
    });

    const healthResponse = await getHealth(
      new Request("https://www.uais.top/api/external-storage/healthz"),
    );
    const health = await healthResponse.json();

    expect(healthResponse.status).toBe(503);
    expect(healthResponse.headers.get("cache-control")).toBe("no-store");
    expect(health).toEqual(
      expect.objectContaining({
        status: "blocked",
        target: "uais-external-storage-production-service",
        apiContractVersion: "uais-external-storage-v1",
        productionServiceIdentity: expect.objectContaining({
          status: "proved",
          serviceMode: "production",
          serviceTarget: "uais-external-storage-production-service",
          valueRedacted: true,
        }),
        durableBackingStore: expect.objectContaining({
          status: "blocked",
          storageMode: "file-backed",
          probe: "write-read-delete",
          valueRedacted: true,
        }),
        teachingOperationsStorageSchema: expect.objectContaining({
          status: "blocked",
          schemaVersion: "uais-teaching-operations-v1",
          migrationStatus: "blocked",
          valueRedacted: true,
        }),
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    );
    expectSafeResponseBody(health, escapedDataDir);
  });
});
