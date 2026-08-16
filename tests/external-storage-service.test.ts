import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const spawnedServers: ChildProcessWithoutNullStreams[] = [];

describe("UAIS external durable storage reference service", () => {
  afterEach(async () => {
    await Promise.all(spawnedServers.splice(0).map(stopServer));
  });

  it("persists ownership and lifecycle audit records that pass the live storage smoke harness", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-service-"));
    const accessToken = "test-external-storage-token";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;

      const health = await fetch(`${baseUrl}/healthz`);
      expect(health.status).toBe(200);
      expect(health.headers.get("cache-control")).toBe("no-store");
      await expect(health.json()).resolves.toEqual(
        expect.objectContaining({
          status: "ok",
          apiContractVersion: "uais-external-storage-v1",
          durableBackingStore: {
            status: "ready",
            storageMode: "file-backed",
            probe: "write-read-delete",
            ownershipWritePolicy: "external-atomic-merge",
            lifecycleAuditWritePolicy: "append-only-redacted-lifecycle-audit",
            valueRedacted: true,
          },
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
            productionDatabaseAdapter: createBlockedProductionDatabaseAdapter(),
            valueRedacted: true,
          },
          teachingCourseManagementStorageSchema: createExpectedSnapshotStorageSchema(
            "uais-teaching-course-management-v1",
          ),
          teachingCourseAssetsStorageSchema: createExpectedSnapshotStorageSchema(
            "uais-teaching-course-assets-v1",
          ),
        }),
      );

      const unauthorized = await fetch(`${baseUrl}/teacher-ai-ownership/teacher-kang`);
      expect(unauthorized.status).toBe(401);

      const smokeOutput = execFileSync("node", [
        "scripts/external-storage-smoke.mjs",
        "--live",
        "--approved",
        "--base-url",
        baseUrl,
        "--teacher-id",
        "teacher-kang",
        "--environment",
        "local-reference",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
        },
      });
      const smoke = JSON.parse(smokeOutput);

      expect(smoke.status).toBe("passed");
      expect(smoke.environment).toBe("local-reference");
      expect(smoke.results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "s22-external-storage-health",
          status: "ok",
          responseShape: {
            checked: true,
            status: "ok",
            requiredFields: expect.objectContaining({
              status: "present",
              target: "present",
              apiContractVersion: "present",
              cacheControlNoStore: "present",
              durableBackingStore: "present",
              teachingOperationsStorageSchema: "present",
              "teachingOperationsStorageSchema.status": "present",
              "teachingOperationsStorageSchema.schemaVersion": "present",
              "teachingOperationsStorageSchema.migrationStatus": "present",
              "teachingOperationsStorageSchema.backupStore": "present",
              "teachingOperationsStorageSchema.restoreDrillLog": "present",
              "teachingOperationsStorageSchema.concurrencyControl": "present",
              ...expectedSnapshotStorageShapeChecks("teachingCourseManagementStorageSchema"),
              ...expectedSnapshotStorageShapeChecks("teachingCourseAssetsStorageSchema"),
              productionServiceIdentity: "present",
              redaction: "present",
            }),
          },
        }),
        expect.objectContaining({ id: "s12-external-teacher-ownership-merge", status: "ok" }),
        expect.objectContaining({ id: "s12-external-teacher-ownership-read", status: "ok" }),
        expect.objectContaining({
          id: "s12-external-course-management-backup-restore-drill",
          status: "ok",
        }),
        expect.objectContaining({
          id: "s12-external-course-assets-backup-restore-drill",
          status: "ok",
        }),
        expect.objectContaining({
          id: "s12-external-teaching-operations-backup-restore-drill",
          status: "ok",
        }),
        expect.objectContaining({ id: "s24-external-lifecycle-audit-append", status: "ok" }),
        expect.objectContaining({ id: "s24-external-lifecycle-audit-read", status: "ok" }),
      ]));
      expect(smokeOutput).not.toContain(accessToken);
      expect(smokeOutput).not.toContain(dataDir);
      expect(smokeOutput).not.toContain("/Users/");

      const persistedOwnership = await readFile(
        join(dataDir, "teacher-ai-ownership", "teacher-kang.json"),
        "utf8",
      );
      expect(persistedOwnership).toContain("uais-external-storage-smoke-audio-manifest");
      expect(persistedOwnership).not.toContain(accessToken);

      const persistedAudit = await readFile(
        join(dataDir, "qwen-voice-lifecycle-audit.jsonl"),
        "utf8",
      );
      expect(persistedAudit).toContain("uais-external-storage-smoke-audit");
      expect(persistedAudit).not.toContain(accessToken);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production health without redacted managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-production-service-"));
    const accessToken = "production-external-storage-token-strong-fixture";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
      "--service-mode",
      "production",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const health = await fetch(`http://${ready.host}:${ready.port}/healthz`);
      expect(health.status).toBe(503);
      await expect(health.json()).resolves.toEqual(
        expect.objectContaining({
          status: "blocked",
          target: "uais-external-storage-production-service",
          apiContractVersion: "uais-external-storage-v1",
          teachingOperationsStorageSchema: expect.objectContaining(
            createBlockedTeachingOperationsStorageSchema(),
          ),
          teachingCourseManagementStorageSchema: expect.objectContaining(
            createBlockedSnapshotStorageSchema("uais-teaching-course-management-v1"),
          ),
          teachingCourseAssetsStorageSchema: expect.objectContaining(
            createBlockedSnapshotStorageSchema("uais-teaching-course-assets-v1"),
          ),
          redaction: {
            secrets: "omitted",
            assets: "ids-only",
            localFiles: "omitted",
          },
        }),
      );
      expect(ready.raw).not.toContain(accessToken);
      expect(ready.raw).not.toContain(dataDir);
      expect(ready.raw).not.toContain("/Users/");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("advertises ready production database adapter proof only when the redacted env contract is complete", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-production-adapter-"));
    const accessToken = "production-external-storage-token-strong-fixture";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
      "--service-mode",
      "production",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS: "managed-database",
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS: "up-to-date",
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY: "point-in-time-restore",
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL: "transactional",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const health = await fetch(`http://${ready.host}:${ready.port}/healthz`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual(
        expect.objectContaining({
          status: "ok",
          target: "uais-external-storage-production-service",
          apiContractVersion: "uais-external-storage-v1",
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
            productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
            valueRedacted: true,
          },
          teachingCourseManagementStorageSchema: createExpectedSnapshotStorageSchema(
            "uais-teaching-course-management-v1",
            createReadyProductionDatabaseAdapter(),
          ),
          teachingCourseAssetsStorageSchema: createExpectedSnapshotStorageSchema(
            "uais-teaching-course-assets-v1",
            createReadyProductionDatabaseAdapter(),
          ),
          redaction: {
            secrets: "omitted",
            assets: "ids-only",
            localFiles: "omitted",
          },
        }),
      );
      const courseManagement = await fetch(
        `http://${ready.host}:${ready.port}/teaching-course-management/database`,
        {
          headers: { authorization: `Bearer ${accessToken}` },
        },
      );
      const courseManagementBody = await courseManagement.json();
      expect(courseManagement.status).toBe(200);
      expect(courseManagementBody).toEqual(
        expect.objectContaining({
          revision: "rev-empty",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
        }),
      );
      expect(JSON.stringify(courseManagementBody)).not.toContain(accessToken);
      expect(JSON.stringify(courseManagementBody)).not.toContain(dataDir);
      expect(ready.raw).not.toContain(accessToken);
      expect(ready.raw).not.toContain(dataDir);
      expect(ready.raw).not.toContain("/Users/");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed before production course snapshot readback without managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-production-snapshot-readback-"));
    const accessToken = "production-external-storage-token-strong-fixture";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
      "--service-mode",
      "production",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;
      for (const path of [
        "/teaching-course-management/database",
        "/teaching-course-assets/database",
      ]) {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { authorization: `Bearer ${accessToken}` },
        });
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
        expect(JSON.stringify(body)).not.toContain(accessToken);
        expect(JSON.stringify(body)).not.toContain(dataDir);
        expect(JSON.stringify(body)).not.toContain("/Users/");
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed before appending production teaching operations without managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-production-db-proof-"));
    const accessToken = "production-external-storage-token-strong-fixture";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
      "--service-mode",
      "production",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;
      const response = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/append`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "append-teaching-operation",
            record: {
              recordId: "course-settings-save-course-settings-20260626-db-proof",
              operationId: "course-settings",
              actionSlot: "primary",
              actionId: "save-course-settings",
              actorId: "teacher-kang",
              courseId: "teacher-research-methods",
              createdAt: "2026-06-26T10:15:00.000Z",
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
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error:
            "Production external storage append requires ready managed database adapter proof.",
          redaction: {
            secrets: "omitted",
            assets: "ids-only",
            localFiles: "omitted",
          },
        }),
      );
      await expect(
        readFile(join(dataDir, "teaching-operations", "teacher-kang.jsonl"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(JSON.stringify(body)).not.toContain(accessToken);
      expect(JSON.stringify(body)).not.toContain(dataDir);
      expect(JSON.stringify(body)).not.toContain("/Users/");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("persists course-management snapshots with optimistic revisions", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-course-management-"));
    const accessToken = "test-external-storage-token";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;
      const initialResponse = await fetch(`${baseUrl}/teaching-course-management/database`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const initial = await initialResponse.json();

      expect(initialResponse.status).toBe(200);
      expect(initial.revision).toBe("rev-empty");
      expect(initial.database.courses).toEqual([]);

      const replaceResponse = await fetch(`${baseUrl}/teaching-course-management/database`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
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
            classes: [
              {
                classId: "teacher-course-external-storage-course-20260622-112000-class-1",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                className: "External Storage Class 1",
                students: 0,
                semester: "2026 Spring",
                invitationCode: "55395057",
                joinUrl: "/courses?invite=55395057",
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
            memberships: [],
            inviteCodeDrafts: [
              {
                inviteCodeDraftId:
                  "invite-code-draft-teacher-course-external-storage-course-20260622-112000-55395058",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                classId: "teacher-course-external-storage-course-20260622-112000-class-1",
                ownerTeacherId: "teacher-kang",
                generatedBy: "teacher-kang",
                draftStatus: "generated",
                operationRecordId: "invite-code-draft-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                inviteCode: "55395058",
                joinUrl: "/courses?invite=55395058",
                invitePolicy: "teacher-review-before-publication",
                generatedAt: "2026-06-22T11:20:00.000Z",
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
            courseSettings: [
              {
                settingsId: "course-settings-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                updatedBy: "teacher-kang",
                settingsStatus: "saved",
                operationRecordId: "course-settings-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
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
            studentPreviewSessions: [
              {
                previewSessionId:
                  "student-preview-session-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                previewedBy: "teacher-kang",
                previewStatus: "generated",
                operationRecordId: "student-preview-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                previewId: "student-preview-20260622-112000",
                previewUrl:
                  "/learning?teacherPreview=1&course=teacher-course-external-storage-course-20260622-112000",
                previewScope: "teacher-course-preview",
                previewPolicy: "teacher-visible-preview-only",
                generatedAt: "2026-06-22T11:20:00.000Z",
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
            studentRosters: [
              {
                rosterId: "student-roster-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                syncedBy: "teacher-kang",
                syncStatus: "local-recount",
                operationRecordId: "student-roster-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                approvedStudentCount: 1,
                pendingTeacherReviewCount: 1,
                classCount: 1,
                sourceSystems: ["local-class-memberships", "local-class-records"],
                syncedAt: "2026-06-22T11:20:00.000Z",
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
            studentGroupSuggestions: [
              {
                groupSuggestionId:
                  "group-suggestion-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                generatedBy: "teacher-kang",
                suggestionStatus: "generated",
                operationRecordId: "student-group-suggestion-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                suggestionScope: "teacher-editable-student-groups",
                sourceSignals: [
                  "approved-class-memberships",
                  "existing-learning-groups",
                ],
                reviewPolicy: "teacher-review-before-group-assignment",
                generatedAt: "2026-06-22T11:20:00.000Z",
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
            knowledgeIndexes: [
              {
                indexId: "knowledge-index-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                syncedBy: "teacher-kang",
                syncStatus: "synced",
                operationRecordId: "knowledge-index-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"],
                syncedAt: "2026-06-22T11:20:00.000Z",
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
            resourceReviewItems: [
              {
                resourceReviewItemId:
                  "resource-review-item-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                queuedBy: "teacher-kang",
                reviewStatus: "pending-teacher-review",
                operationRecordId: "resource-review-item-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                resourceSource: "teacher-placeholder",
                reviewPolicy: "teacher-review-before-knowledge-index",
                queuedAt: "2026-06-22T11:20:00.000Z",
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
            contentPackages: [
              {
                contentId: "course-content-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                publishedBy: "teacher-kang",
                publicationStatus: "published",
                operationRecordId: "course-content-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                releaseScope: "course-visible-content",
                publishedAt: "2026-06-22T11:20:00.000Z",
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
            courseUnitDrafts: [
              {
                unitDraftId:
                  "course-unit-draft-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                generatedBy: "teacher-kang",
                draftStatus: "generated",
                operationRecordId: "course-unit-draft-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                draftScope: "teacher-editable-unit-plan",
                sourceSystems: ["course-knowledge-index", "teaching-objectives", "quiz-bank"],
                reviewPolicy: "teacher-review-before-student-release",
                generatedAt: "2026-06-22T11:20:00.000Z",
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
            dashboardStates: [
              {
                dashboardStateId:
                  "dashboard-state-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                refreshedBy: "teacher-kang",
                refreshStatus: "refreshed",
                operationRecordId: "dashboard-state-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                visibleMetrics: ["engagement", "progress", "assessment-quality"],
                refreshPolicy: "teacher-visible-course-dashboard",
                refreshedAt: "2026-06-22T11:20:00.000Z",
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
            dashboardSnapshots: [
              {
                dashboardSnapshotId:
                  "dashboard-snapshot-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                lockedBy: "teacher-kang",
                snapshotStatus: "locked",
                operationRecordId: "dashboard-snapshot-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                teachingOperationSnapshotId: "daily-snapshot-20260622-112000",
                snapshotScope: "daily-course-dashboard",
                retentionPolicy: "teacher-locked-dashboard-snapshot",
                lockedAt: "2026-06-22T11:20:00.000Z",
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
            quizAssessments: [
              {
                quizAssessmentId:
                  "quiz-assessment-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                refreshedBy: "teacher-kang",
                assessmentStatus: "refreshed",
                operationRecordId: "quiz-assessment-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                quizBoardStateId:
                  "quiz-board-state-teacher-course-external-storage-course-20260622-112000",
                visibleMetrics: ["completion-rate", "item-quality", "misconception-clusters"],
                reviewPolicy: "teacher-visible-quiz-quality-board",
                reusePolicy: "teacher-review-before-quiz-reuse",
                refreshedAt: "2026-06-22T11:20:00.000Z",
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
            quizItemReviews: [
              {
                quizItemReviewId:
                  "quiz-item-review-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                flaggedBy: "teacher-kang",
                reviewStatus: "flagged-for-review",
                operationRecordId: "quiz-item-review-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                flaggedSignals: [
                  "low-discrimination",
                  "high-error-rate",
                  "teacher-review-needed",
                ],
                reviewPolicy: "teacher-review-before-quiz-reuse",
                flaggedAt: "2026-06-22T11:20:00.000Z",
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
            agentSettings: [
              {
                agentSettingsId:
                  "agent-settings-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                savedBy: "teacher-kang",
                settingsStatus: "saved",
                operationRecordId: "agent-settings-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                agentScopes: ["research-agent", "method-agent", "writing-agent", "math-agent"],
                governancePolicy: "teacher-controlled-agent-settings",
                savedAt: "2026-06-22T11:20:00.000Z",
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
            agentPermissionPreflights: [
              {
                preflightId:
                  "agent-permission-preflight-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                checkedBy: "teacher-kang",
                preflightStatus: "passed",
                operationRecordId:
                  "agent-permission-preflight-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
                preflightPolicy: "teacher-agent-permission-gate",
                checkedAt: "2026-06-22T11:20:00.000Z",
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
            adminSettings: [
              {
                adminSettingsId:
                  "admin-settings-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                savedBy: "teacher-kang",
                settingsStatus: "saved",
                operationRecordId: "admin-settings-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"],
                governancePolicy: "teacher-controlled-admin-settings",
                savedAt: "2026-06-22T11:20:00.000Z",
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
            collaborationInviteNotifications: [
              {
                notificationId:
                  "collaboration-invite-notification-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                queuedBy: "teacher-kang",
                notificationStatus: "delivery-failed",
                operationRecordId:
                  "collaboration-invite-notification-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                outboxId: "collaboration-invite-outbox-external-storage-snapshot",
                deliveryChannel: "collaboration-invite-email",
                providerStatus: "smtp-provider-bounced",
                providerDeliveryId: "email-delivery-collaboration-invite-external-storage",
                deliveryFailureReason: "mailbox-unavailable",
                providerCallbackAt: "2026-06-22T11:20:45.000Z",
                deliveryPolicy: "server-outbox-before-smtp-provider",
                queuedAt: "2026-06-22T11:20:00.000Z",
                deliveredAt: "2026-06-22T11:20:30.000Z",
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
            exportManifests: [
              {
                exportManifestId:
                  "export-manifest-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                createdBy: "teacher-kang",
                exportStatus: "generated",
                operationRecordId: "course-export-manifest-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                teachingOperationManifestId:
                  "export-manifest-teacher-kang-external-storage-snapshot",
                downloadRoute:
                  "/api/teaching/operations/export/export-manifest-teacher-kang-external-storage-snapshot",
                datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
                formats: ["json", "csv"],
                exportPolicy: "redacted-teacher-export-manifest",
                createdAt: "2026-06-22T11:20:00.000Z",
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
            exportRedactionValidations: [
              {
                exportRedactionValidationId:
                  "export-redaction-validation-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                validatedBy: "teacher-kang",
                validationStatus: "passed",
                operationRecordId:
                  "export-redaction-validation-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                checkedScopes: [
                  "identity-fields",
                  "ai-chat-transcripts",
                  "voice-references",
                  "local-file-paths",
                ],
                blockedSecretCount: 0,
                validationPolicy: "no-secrets-or-local-paths-before-export",
                validatedAt: "2026-06-22T11:20:00.000Z",
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
            gradingQueues: [
              {
                gradingQueueId:
                  "grading-queue-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                savedBy: "teacher-kang",
                queueStatus: "saved",
                operationRecordId: "grading-queue-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                gradebookUpdateId:
                  "gradebook-update-teacher-course-external-storage-course-20260622-112000",
                reviewPolicy: "teacher-review-before-release",
                releasePolicy: "teacher-confirmed-grade-release",
                savedAt: "2026-06-22T11:20:00.000Z",
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
            gradingFeedbackDrafts: [
              {
                gradingFeedbackDraftId:
                  "grading-feedback-draft-teacher-course-external-storage-course-20260622-112000",
                courseId: "teacher-course-external-storage-course-20260622-112000",
                ownerTeacherId: "teacher-kang",
                generatedBy: "teacher-kang",
                feedbackStatus: "generated",
                operationRecordId: "grading-feedback-draft-operation-external-storage-snapshot",
                sourceAction: "external-storage-service-test",
                teachingOperationFeedbackArtifactId: "ai-feedback-20260622-112000",
                feedbackScope: "grading-review-queue",
                reviewPolicy: "teacher-review-before-student-release",
                releasePolicy: "teacher-confirmed-feedback-release",
                generatedAt: "2026-06-22T11:20:00.000Z",
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
            auditEvents: [],
          },
        }),
      });
      const replaceReceipt = await replaceResponse.json();

      expect(replaceResponse.status).toBe(200);
      expect(replaceReceipt).toEqual(
        expect.objectContaining({
          status: "persisted",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
        }),
      );
      expect(replaceReceipt.revision).toMatch(/^rev-[a-f0-9]{16}$/);

      const staleResponse = await fetch(`${baseUrl}/teaching-course-management/database`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "replace-teaching-course-management-database",
          expectedRevision: "rev-empty",
          database: {
            ...initial.database,
            updatedAt: "2026-06-22T11:21:00.000Z",
          },
        }),
      });
      const stale = await staleResponse.json();

      expect(staleResponse.status).toBe(409);
      expect(stale.error).toBe("Teaching course management snapshot revision mismatch.");
      const persistedSnapshot = await readFile(
        join(dataDir, "teaching-course-management", "database.json"),
        "utf8",
      );
      expect(persistedSnapshot).toContain("teacher-course-external-storage-course");
      expect(persistedSnapshot).toContain("invite-code-draft-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain("course-settings-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain("student-preview-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain("student-roster-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain(
        "student-group-suggestion-operation-external-storage-snapshot",
      );
      expect(persistedSnapshot).toContain("knowledge-index-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain(
        "resource-review-item-operation-external-storage-snapshot",
      );
      expect(persistedSnapshot).toContain("course-content-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain("course-unit-draft-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain("dashboard-state-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain("dashboard-snapshot-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain("quiz-assessment-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain("quiz-item-review-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain("agent-settings-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain(
        "agent-permission-preflight-operation-external-storage-snapshot",
      );
      expect(persistedSnapshot).toContain("admin-settings-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain(
        "collaboration-invite-notification-operation-external-storage-snapshot",
      );
      expect(persistedSnapshot).toContain(
        "export-redaction-validation-operation-external-storage-snapshot",
      );
      expect(persistedSnapshot).toContain("smtp-provider-bounced");
      expect(persistedSnapshot).toContain("mailbox-unavailable");
      expect(persistedSnapshot).toContain(
        "course-export-manifest-operation-external-storage-snapshot",
      );
      expect(persistedSnapshot).toContain("grading-queue-operation-external-storage-snapshot");
      expect(persistedSnapshot).toContain(
        "grading-feedback-draft-operation-external-storage-snapshot",
      );
      expect(persistedSnapshot).not.toContain(accessToken);
      expect(JSON.stringify(initial)).not.toContain(accessToken);
      expect(JSON.stringify(replaceReceipt)).not.toContain(accessToken);
      expect(JSON.stringify(stale)).not.toContain(accessToken);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("persists course-cover asset snapshots with optimistic revisions", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-course-assets-"));
    const accessToken = "test-external-storage-token";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;
      const initialResponse = await fetch(`${baseUrl}/teaching-course-assets/database`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const initial = await initialResponse.json();

      expect(initialResponse.status).toBe(200);
      expect(initial.revision).toBe("rev-empty");
      expect(initial.database.assets).toEqual([]);

      const replaceResponse = await fetch(`${baseUrl}/teaching-course-assets/database`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
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
                authSession: {
                  sessionId: "teacher-cover-external-session",
                  authenticatedAt: "2026-06-22T10:30:00.000Z",
                  expiresAt: "2026-06-22T12:00:00.000Z",
                },
                courseId: "teacher-draft-ai-math",
                assetId: "course-cover-request-course-cover-1",
                providerRequestId: "request-course-cover-1",
                requestSource: {
                  userAgent: "UAIS external storage course cover test",
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
      });
      const replaceReceipt = await replaceResponse.json();

      expect(replaceResponse.status).toBe(200);
      expect(replaceReceipt).toEqual(
        expect.objectContaining({
          status: "persisted",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
          storageWritePolicy: "external-optimistic-snapshot-replace",
        }),
      );
      expect(replaceReceipt.revision).toMatch(/^rev-[a-f0-9]{16}$/);

      const staleResponse = await fetch(`${baseUrl}/teaching-course-assets/database`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "replace-teaching-course-assets-database",
          expectedRevision: "rev-empty",
          database: {
            ...initial.database,
            updatedAt: "2026-06-22T11:01:00.000Z",
          },
        }),
      });
      const stale = await staleResponse.json();

      expect(staleResponse.status).toBe(409);
      expect(stale.error).toBe("Teaching course assets snapshot revision mismatch.");
      const persistedSnapshot = await readFile(
        join(dataDir, "teaching-course-assets", "database.json"),
        "utf8",
      );
      expect(persistedSnapshot).toContain("course-cover-request-course-cover-1");
      expect(persistedSnapshot).toContain("teacher-cover-external-session");
      expect(persistedSnapshot).not.toContain(accessToken);
      expect(JSON.stringify(initial)).not.toContain(accessToken);
      expect(JSON.stringify(replaceReceipt)).not.toContain(accessToken);
      expect(JSON.stringify(stale)).not.toContain(accessToken);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed before replacing production course snapshots without managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-course-db-proof-"));
    const accessToken = "production-external-storage-token-strong-fixture";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
      "--service-mode",
      "production",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;
      const courseManagementResponse = await fetch(
        `${baseUrl}/teaching-course-management/database`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "replace-teaching-course-management-database",
            expectedRevision: "rev-empty",
            database: {
              schemaVersion: "uais-teaching-course-management-v1",
              updatedAt: "2026-06-26T11:05:00.000Z",
              courses: [],
              classes: [],
              memberships: [],
              auditEvents: [],
            },
          }),
        },
      );
      const courseManagementBody = await courseManagementResponse.json();
      const courseAssetsResponse = await fetch(
        `${baseUrl}/teaching-course-assets/database`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "replace-teaching-course-assets-database",
            expectedRevision: "rev-empty",
            database: {
              schemaVersion: "uais-teaching-course-assets-v1",
              updatedAt: "2026-06-26T11:05:00.000Z",
              assets: [],
              auditEvents: [],
            },
          }),
        },
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
      expect(JSON.stringify(courseManagementBody)).not.toContain(accessToken);
      expect(JSON.stringify(courseManagementBody)).not.toContain(dataDir);
      expect(JSON.stringify(courseAssetsBody)).not.toContain(accessToken);
      expect(JSON.stringify(courseAssetsBody)).not.toContain(dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("creates restore-drill backups for course-management snapshots", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-course-management-backup-"));
    const accessToken = "test-external-storage-token";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;

      const backupResponse = await fetch(`${baseUrl}/teaching-course-management/backups`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "create-teaching-course-management-backup",
          requestedBy: "s12-course-management-restore-drill",
          requestedAt: "2026-06-25T11:45:00.000Z",
          traceId: "trace-external-course-management-backup-001",
        }),
      });

      expect(backupResponse.status).toBe(200);
      const backupBody = await backupResponse.json();
      expect(backupBody).toEqual(
        expect.objectContaining({
          backupId: "teaching-course-management-backup-20260625-114500",
          status: "persisted",
          eventType: "teaching-course-management-backup.created",
          traceId: "trace-external-course-management-backup-001",
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

      const persistedBackup = await readFile(
        join(
          dataDir,
          "teaching-course-management-backups",
          "teaching-course-management-backup-20260625-114500.json",
        ),
        "utf8",
      );
      expect(persistedBackup).toContain("uais-teaching-course-management-v1");
      expect(persistedBackup).toContain("trace-external-course-management-backup-001");
      expect(persistedBackup).not.toContain(accessToken);
      expect(persistedBackup).not.toContain(dataDir);
      expect(persistedBackup).not.toContain("/Users/");

      const restoreDrillResponse = await fetch(
        `${baseUrl}/teaching-course-management/backups/teaching-course-management-backup-20260625-114500/restore-drill`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "verify-teaching-course-management-backup-restore",
            requestedBy: "s12-course-management-restore-drill",
            requestedAt: "2026-06-25T11:46:00.000Z",
            traceId: "trace-external-course-management-restore-drill-001",
          }),
        },
      );

      expect(restoreDrillResponse.status).toBe(200);
      const restoreDrillBody = await restoreDrillResponse.json();
      expect(restoreDrillBody).toEqual(
        expect.objectContaining({
          backupId: "teaching-course-management-backup-20260625-114500",
          drillId:
            "teaching-course-management-restore-drill-teaching-course-management-backup-20260625-114500",
          status: "verified",
          eventType: "teaching-course-management-backup.restore-drill-verified",
          traceId: "trace-external-course-management-restore-drill-001",
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
      const persistedRestoreDrill = await readFile(
        join(dataDir, "teaching-course-management-restore-drills.jsonl"),
        "utf8",
      );
      expect(persistedRestoreDrill).toContain(
        "trace-external-course-management-restore-drill-001",
      );
      expect(persistedRestoreDrill).toContain(
        "teaching-course-management-backup-20260625-114500",
      );
      expect(persistedRestoreDrill).not.toContain(accessToken);
      expect(persistedRestoreDrill).not.toContain(dataDir);
      expect(persistedRestoreDrill).not.toContain("/Users/");
      expect(JSON.stringify(backupBody)).not.toContain(accessToken);
      expect(JSON.stringify(backupBody)).not.toContain(dataDir);
      expect(JSON.stringify(backupBody)).not.toContain("/Users/");
      expect(JSON.stringify(restoreDrillBody)).not.toContain(accessToken);
      expect(JSON.stringify(restoreDrillBody)).not.toContain(dataDir);
      expect(JSON.stringify(restoreDrillBody)).not.toContain("/Users/");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("creates restore-drill backups for course-cover asset snapshots", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-course-assets-backup-"));
    const accessToken = "test-external-storage-token";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;

      const backupResponse = await fetch(`${baseUrl}/teaching-course-assets/backups`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "create-teaching-course-assets-backup",
          requestedBy: "s12-course-assets-restore-drill",
          requestedAt: "2026-06-25T11:50:00.000Z",
          traceId: "trace-external-course-assets-backup-001",
        }),
      });

      expect(backupResponse.status).toBe(200);
      const backupBody = await backupResponse.json();
      expect(backupBody).toEqual(
        expect.objectContaining({
          backupId: "teaching-course-assets-backup-20260625-115000",
          status: "persisted",
          eventType: "teaching-course-assets-backup.created",
          traceId: "trace-external-course-assets-backup-001",
          sourceRecordCounts: {
            assets: 0,
            auditEvents: 0,
          },
          storagePolicy: "external-redacted-teaching-course-assets-backup",
          storageWritePolicy: "external-atomic-backup-snapshot",
          responsibleSession: "S12",
        }),
      );

      const persistedBackup = await readFile(
        join(
          dataDir,
          "teaching-course-assets-backups",
          "teaching-course-assets-backup-20260625-115000.json",
        ),
        "utf8",
      );
      expect(persistedBackup).toContain("uais-teaching-course-assets-v1");
      expect(persistedBackup).toContain("trace-external-course-assets-backup-001");
      expect(persistedBackup).not.toContain(accessToken);
      expect(persistedBackup).not.toContain(dataDir);
      expect(persistedBackup).not.toContain("/Users/");

      const restoreDrillResponse = await fetch(
        `${baseUrl}/teaching-course-assets/backups/teaching-course-assets-backup-20260625-115000/restore-drill`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "verify-teaching-course-assets-backup-restore",
            requestedBy: "s12-course-assets-restore-drill",
            requestedAt: "2026-06-25T11:51:00.000Z",
            traceId: "trace-external-course-assets-restore-drill-001",
          }),
        },
      );

      expect(restoreDrillResponse.status).toBe(200);
      const restoreDrillBody = await restoreDrillResponse.json();
      expect(restoreDrillBody).toEqual(
        expect.objectContaining({
          backupId: "teaching-course-assets-backup-20260625-115000",
          drillId:
            "teaching-course-assets-restore-drill-teaching-course-assets-backup-20260625-115000",
          status: "verified",
          eventType: "teaching-course-assets-backup.restore-drill-verified",
          traceId: "trace-external-course-assets-restore-drill-001",
          restoredRecordCounts: {
            assets: 0,
            auditEvents: 0,
          },
          storagePolicy: "external-redacted-teaching-course-assets-restore-drill",
          storageWritePolicy: "external-append-only-restore-drill-log",
          responsibleSession: "S12",
        }),
      );
      const persistedRestoreDrill = await readFile(
        join(dataDir, "teaching-course-assets-restore-drills.jsonl"),
        "utf8",
      );
      expect(persistedRestoreDrill).toContain(
        "trace-external-course-assets-restore-drill-001",
      );
      expect(persistedRestoreDrill).toContain("teaching-course-assets-backup-20260625-115000");
      expect(persistedRestoreDrill).not.toContain(accessToken);
      expect(persistedRestoreDrill).not.toContain(dataDir);
      expect(persistedRestoreDrill).not.toContain("/Users/");
      expect(JSON.stringify(backupBody)).not.toContain(accessToken);
      expect(JSON.stringify(backupBody)).not.toContain(dataDir);
      expect(JSON.stringify(backupBody)).not.toContain("/Users/");
      expect(JSON.stringify(restoreDrillBody)).not.toContain(accessToken);
      expect(JSON.stringify(restoreDrillBody)).not.toContain(dataDir);
      expect(JSON.stringify(restoreDrillBody)).not.toContain("/Users/");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("appends ordinary teaching operation records to the durable external store", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-teaching-ops-"));
    const accessToken = "test-external-storage-token";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;
      const response = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/append`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "append-teaching-operation",
            record: {
              recordId: "course-settings-save-course-settings-20260622-110500-abcd1234",
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
                  recordId:
                    "course-settings-save-course-settings-20260622-110500-abcd1234",
                },
                {
                  kind: "domain-object",
                  objectType: "course-settings",
                  objectId: "course-settings-teacher-research-methods",
                },
              ],
              domainProjections: [
                {
                  objectId: "course-settings-teacher-research-methods",
                  objectType: "course-settings",
                  courseId: "teacher-research-methods",
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
              traceId: "trace-external-teaching-ops-001",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              actorRole: "teacher",
              authMode: "signed-teacher-session",
              operationId: "course-settings",
              actionSlot: "primary",
              actionId: "save-course-settings",
              courseId: "teacher-research-methods",
              requestSource: {
                userAgent: "vitest external storage",
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
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          status: "persisted",
          appendSequence: 1,
          storagePolicy: "external-redacted-teaching-operation-append",
          storageWritePolicy: "external-append-only-operation-log",
          redaction: {
            secrets: "omitted",
            assets: "ids-only",
            localFiles: "omitted",
          },
        }),
      );
      const persistedTeachingOperations = await readFile(
        join(dataDir, "teaching-operations", "teacher-kang.jsonl"),
        "utf8",
      );
      expect(persistedTeachingOperations).toContain("trace-external-teaching-ops-001");
      expect(persistedTeachingOperations).toContain("teacher-research-methods");
      expect(persistedTeachingOperations).not.toContain(accessToken);
      expect(persistedTeachingOperations).not.toContain(dataDir);
      const persistedTeachingAuditLedger = await readFile(
        join(dataDir, "teaching-operations-audit", "teacher-kang.jsonl"),
        "utf8",
      );
      expect(persistedTeachingAuditLedger).toContain("trace-external-teaching-ops-001");
      expect(persistedTeachingAuditLedger).toContain(
        "audit-course-settings-save-course-settings-20260622-110500",
      );
      expect(persistedTeachingAuditLedger).not.toContain(accessToken);
      expect(persistedTeachingAuditLedger).not.toContain(dataDir);
      expect(persistedTeachingAuditLedger).not.toContain("/Users/");

      const auditResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/audit`,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
      );
      const auditBody = await auditResponse.json();
      expect(auditResponse.status).toBe(200);
      expect(auditBody).toEqual(
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
      expect(auditBody.records).toEqual([
        expect.objectContaining({
          recordId: "course-settings-save-course-settings-20260622-110500-abcd1234",
          operationId: "course-settings",
          actionSlot: "primary",
          actionId: "save-course-settings",
          actorId: "teacher-kang",
          courseId: "teacher-research-methods",
          appendSequence: 1,
        }),
      ]);
      expect(auditBody.events).toEqual([
        expect.objectContaining({
          auditId: "audit-course-settings-save-course-settings-20260622-110500",
          traceId: "trace-external-teaching-ops-001",
          actorId: "teacher-kang",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          courseId: "teacher-research-methods",
        }),
      ]);
      expect(auditBody.domainProjections).toEqual([
        expect.objectContaining({
          objectId: "course-settings-teacher-research-methods",
          objectType: "course-settings",
          courseId: "teacher-research-methods",
          operationRecordId:
            "course-settings-save-course-settings-20260622-110500-abcd1234",
          storagePolicy: "domain-projection-teaching-course-settings",
        }),
      ]);
      expect(JSON.stringify(auditBody)).not.toContain(accessToken);
      expect(JSON.stringify(auditBody)).not.toContain(dataDir);
      expect(JSON.stringify(auditBody)).not.toContain("/Users/");

      const missingCourseResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/append`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
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
              traceId: "trace-external-teaching-ops-missing-course",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              actorRole: "teacher",
              authMode: "signed-teacher-session",
              operationId: "admins",
              actionSlot: "secondary",
              actionId: "send-admin-email",
              requestSource: {
                userAgent: "vitest external storage",
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
      );
      expect(missingCourseResponse.status).toBe(200);

      const alertsResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/audit/alerts`,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
      );
      const alertsBody = await alertsResponse.json();
      expect(alertsResponse.status).toBe(200);
      expect(alertsBody).toEqual(
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
      expect(alertsBody.alertPolicy).toEqual(
        expect.objectContaining({
          policyId: "s12-teaching-operation-audit-alerts-v1",
          checks: ["missing-course-context"],
        }),
      );
      expect(alertsBody.alerts).toEqual([
        expect.objectContaining({
          alertId:
            "missing-course-context-audit-admins-send-admin-email-20260622-110600",
          severity: "high",
          reason: "missing-course-context",
          auditId: "audit-admins-send-admin-email-20260622-110600",
          traceId: "trace-external-teaching-ops-missing-course",
          actorId: "teacher-kang",
          operationId: "admins",
          actionId: "send-admin-email",
        }),
      ]);
      expect(JSON.stringify(alertsBody)).not.toContain(accessToken);
      expect(JSON.stringify(alertsBody)).not.toContain(dataDir);
      expect(JSON.stringify(alertsBody)).not.toContain("/Users/");

      const notificationResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/audit/alerts/notifications`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "enqueue-teaching-operation-audit-alert-notifications",
            requestedBy: "s12-audit-monitor",
            requestedAt: "2026-06-22T11:07:00.000Z",
          }),
        },
      );
      const notificationBody = await notificationResponse.json();
      expect(notificationResponse.status).toBe(200);
      expect(notificationBody).toEqual(
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
      expect(notificationBody.notifications).toEqual([
        expect.objectContaining({
          notificationId:
            "alert-notification-missing-course-context-audit-admins-send-admin-email-20260622-110600",
          deliveryStatus: "queued",
          alertId:
            "missing-course-context-audit-admins-send-admin-email-20260622-110600",
          auditId: "audit-admins-send-admin-email-20260622-110600",
          traceId: "trace-external-teaching-ops-missing-course",
          actorId: "teacher-kang",
          requestedBy: "s12-audit-monitor",
        }),
      ]);
      const persistedNotifications = await readFile(
        join(
          dataDir,
          "teaching-operation-alert-notifications",
          "teacher-kang.jsonl",
        ),
        "utf8",
      );
      expect(persistedNotifications).toContain(
        "trace-external-teaching-ops-missing-course",
      );
      expect(persistedNotifications).toContain(
        "missing-course-context-audit-admins-send-admin-email-20260622-110600",
      );
      expect(persistedNotifications).not.toContain(accessToken);
      expect(persistedNotifications).not.toContain(dataDir);
      expect(persistedNotifications).not.toContain("/Users/");
      expect(JSON.stringify(notificationBody)).not.toContain(accessToken);
      expect(JSON.stringify(notificationBody)).not.toContain(dataDir);
      expect(JSON.stringify(notificationBody)).not.toContain("/Users/");

      const notificationIndexResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/audit/alerts/notifications`,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
      );
      const notificationIndexBody = await notificationIndexResponse.json();
      expect(notificationIndexResponse.status).toBe(200);
      expect(notificationIndexBody).toEqual(
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
      expect(notificationIndexBody.notifications).toEqual([
        expect.objectContaining({
          notificationId:
            "alert-notification-missing-course-context-audit-admins-send-admin-email-20260622-110600",
          deliveryStatus: "queued",
          traceId: "trace-external-teaching-ops-missing-course",
        }),
      ]);
      expect(JSON.stringify(notificationIndexBody)).not.toContain(accessToken);
      expect(JSON.stringify(notificationIndexBody)).not.toContain(dataDir);
      expect(JSON.stringify(notificationIndexBody)).not.toContain("/Users/");

      expect(JSON.stringify(body)).not.toContain(accessToken);
      expect(JSON.stringify(body)).not.toContain(dataDir);
      expect(JSON.stringify(body)).not.toContain("/Users/");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("serializes concurrent ordinary teaching operation appends without dropping ledger entries", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-teaching-ops-concurrent-"));
    const accessToken = "test-external-storage-token";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;
      const appendBodies = [
        createConcurrentTeachingOperationAppendBody(1),
        createConcurrentTeachingOperationAppendBody(2),
      ];

      const responses = await Promise.all(
        appendBodies.map((body) =>
          fetch(`${baseUrl}/teaching-operations/teacher-kang/append`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          }),
        ),
      );
      const bodies = await Promise.all(responses.map((response) => response.json()));

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(bodies.map((body) => body.appendSequence).sort()).toEqual([1, 2]);
      expect(bodies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            teacherId: "teacher-kang",
            status: "persisted",
            storageWritePolicy: "external-append-only-operation-log",
          }),
        ]),
      );

      const persistedTeachingOperations = await readFile(
        join(dataDir, "teaching-operations", "teacher-kang.jsonl"),
        "utf8",
      );
      const operationLines = persistedTeachingOperations.trim().split(/\r?\n/);
      expect(operationLines).toHaveLength(2);
      expect(persistedTeachingOperations).toContain("trace-concurrent-teaching-ops-001");
      expect(persistedTeachingOperations).toContain("trace-concurrent-teaching-ops-002");
      expect(persistedTeachingOperations).not.toContain(accessToken);
      expect(persistedTeachingOperations).not.toContain(dataDir);
      expect(persistedTeachingOperations).not.toContain("/Users/");

      const persistedTeachingAuditLedger = await readFile(
        join(dataDir, "teaching-operations-audit", "teacher-kang.jsonl"),
        "utf8",
      );
      const auditLines = persistedTeachingAuditLedger.trim().split(/\r?\n/);
      expect(auditLines).toHaveLength(2);
      expect(persistedTeachingAuditLedger).toContain("audit-concurrent-teaching-ops-001");
      expect(persistedTeachingAuditLedger).toContain("audit-concurrent-teaching-ops-002");
      expect(persistedTeachingAuditLedger).not.toContain(accessToken);
      expect(persistedTeachingAuditLedger).not.toContain(dataDir);
      expect(persistedTeachingAuditLedger).not.toContain("/Users/");

      const auditResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/audit`,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
      );
      const auditBody = await auditResponse.json();

      expect(auditResponse.status).toBe(200);
      expect(auditBody).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          recordCount: 2,
          operationRecordCount: 2,
          domainProjectionCount: 2,
        }),
      );
      expect(
        auditBody.records.map((record: { appendSequence?: number }) => record.appendSequence).sort(),
      ).toEqual([1, 2]);
      expect(auditBody.records.map((record: { recordId?: string }) => record.recordId).sort()).toEqual([
        "course-settings-concurrent-teaching-ops-001",
        "course-settings-concurrent-teaching-ops-002",
      ]);
      expect(auditBody.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            recordId: "course-settings-concurrent-teaching-ops-001",
          }),
          expect.objectContaining({
            recordId: "course-settings-concurrent-teaching-ops-002",
          }),
        ]),
      );
      expect(auditBody.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            auditId: "audit-concurrent-teaching-ops-001",
            traceId: "trace-concurrent-teaching-ops-001",
          }),
          expect.objectContaining({
            auditId: "audit-concurrent-teaching-ops-002",
            traceId: "trace-concurrent-teaching-ops-002",
          }),
        ]),
      );
      expect(JSON.stringify(auditBody)).not.toContain(accessToken);
      expect(JSON.stringify(auditBody)).not.toContain(dataDir);
      expect(JSON.stringify(auditBody)).not.toContain("/Users/");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when stored teaching operation alert notifications cross teacher scope", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-alert-scope-"));
    const accessToken = "test-external-storage-token";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;
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

      const response = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/audit/alerts/notifications`,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
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
      expect(JSON.stringify(body)).not.toContain(accessToken);
      expect(JSON.stringify(body)).not.toContain(dataDir);
      expect(JSON.stringify(body)).not.toContain("/Users/");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("appends gradebook release audit events to the durable external teaching operation store", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-gradebook-release-"));
    const accessToken = "test-external-storage-token";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;
      const response = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/append`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "append-teaching-operation",
            record: {
              recordId: "gradebook-release-gradebook-update-teacher-research-methods",
              operationId: "grading",
              actionSlot: "primary",
              actionId: "save-review-queue",
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
                  kind: "domain-object",
                  objectType: "gradebook-update",
                  objectId: "gradebook-update-teacher-research-methods",
                },
              ],
              domainProjections: [
                {
                  objectId: "gradebook-update-teacher-research-methods",
                  objectType: "gradebook-update",
                  courseId: "teacher-research-methods",
                  updatedBy: "teacher-kang",
                  updateStatus: "released",
                  operationRecordId: "grading-save-review-queue-external-seed",
                  releasePolicy: "teacher-confirmed-grade-release",
                  updatedAt: "2026-06-22T11:10:00.000Z",
                  releasedBy: "teacher-kang",
                  releasedAt: "2026-06-22T11:30:00.000Z",
                  storagePolicy: "domain-projection-teaching-gradebook-update",
                  redaction: {
                    secrets: "omitted",
                    localFiles: "omitted",
                    assets: "ids-only",
                  },
                },
              ],
            },
            auditEvent: {
              auditId: "audit-gradebook-release-gradebook-update-teacher-research-methods",
              traceId: "trace-external-gradebook-release",
              eventType: "teaching-gradebook-update.released",
              actorId: "teacher-kang",
              actorRole: "teacher",
              authMode: "signed-teacher-session",
              courseId: "teacher-research-methods",
              gradebookUpdateId: "gradebook-update-teacher-research-methods",
              requestSource: {
                userAgent: "vitest external gradebook release",
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
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      const auditResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/audit`,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
      );
      const auditBody = await auditResponse.json();

      expect(auditResponse.status).toBe(200);
      expect(auditBody.events).toEqual([
        expect.objectContaining({
          eventType: "teaching-gradebook-update.released",
          traceId: "trace-external-gradebook-release",
          courseId: "teacher-research-methods",
          gradebookUpdateId: "gradebook-update-teacher-research-methods",
        }),
      ]);
      expect(auditBody.domainProjections).toEqual([
        expect.objectContaining({
          objectId: "gradebook-update-teacher-research-methods",
          objectType: "gradebook-update",
          updateStatus: "released",
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain(accessToken);
      expect(JSON.stringify(auditBody)).not.toContain(accessToken);
      expect(JSON.stringify(auditBody)).not.toContain(dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("delivers teaching operation audit alert notifications to a configured admin webhook", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-alert-webhook-"));
    const accessToken = "test-external-storage-token";
    const adminAlertWebhookToken = "test-admin-alert-webhook-token";
    const webhook = await startWebhookReceiver();
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
        UAIS_EXTERNAL_STORAGE_ADMIN_ALERT_WEBHOOK_URL: webhook.url,
        UAIS_EXTERNAL_STORAGE_ADMIN_ALERT_WEBHOOK_TOKEN: adminAlertWebhookToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;

      const appendResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/append`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "append-teaching-operation",
            record: {
              recordId: "admins-send-admin-email-20260622-120500-alertwebhook",
              operationId: "admins",
              actionSlot: "secondary",
              actionId: "send-admin-email",
              actorId: "teacher-kang",
              createdAt: "2026-06-22T12:05:00.000Z",
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
                  notificationId: "admin-email-20260622-120500-alertwebhook",
                },
              ],
            },
            auditEvent: {
              auditId: "audit-admins-send-admin-email-20260622-120500",
              traceId: "trace-external-teaching-ops-alert-webhook",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              actorRole: "teacher",
              authMode: "signed-teacher-session",
              operationId: "admins",
              actionSlot: "secondary",
              actionId: "send-admin-email",
              requestSource: {
                userAgent: "vitest external storage webhook",
                ipAddress: "redacted",
              },
              createdAt: "2026-06-22T12:05:00.000Z",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
          }),
        },
      );
      expect(appendResponse.status).toBe(200);

      const notificationResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/audit/alerts/notifications`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "enqueue-teaching-operation-audit-alert-notifications",
            requestedBy: "s12-audit-monitor",
            requestedAt: "2026-06-22T12:06:00.000Z",
          }),
        },
      );
      const notificationBody = await notificationResponse.json();

      expect(notificationResponse.status).toBe(200);
      expect(webhook.requests).toEqual([
        expect.objectContaining({
          method: "POST",
          pathname: "/alerts",
          authorization: `Bearer ${adminAlertWebhookToken}`,
          body: expect.objectContaining({
            eventType: "teaching-operation-audit-alert-notification-webhook",
            teacherId: "teacher-kang",
            requestedBy: "s12-audit-monitor",
            requestedAt: "2026-06-22T12:06:00.000Z",
            notificationCount: 1,
            notifications: [
              expect.objectContaining({
                notificationId:
                  "alert-notification-missing-course-context-audit-admins-send-admin-email-20260622-120500",
                traceId: "trace-external-teaching-ops-alert-webhook",
              }),
            ],
          }),
        }),
      ]);
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
        "trace-external-teaching-ops-alert-webhook",
      );
      expect(persistedDeliveryLedger).toContain(
        "external-redacted-teaching-operation-audit-alert-webhook-delivery",
      );
      expect(persistedDeliveryLedger).not.toContain(accessToken);
      expect(persistedDeliveryLedger).not.toContain(adminAlertWebhookToken);
      expect(persistedDeliveryLedger).not.toContain(webhook.url);
      expect(persistedDeliveryLedger).not.toContain(dataDir);
      expect(persistedDeliveryLedger).not.toContain("/Users/");
      expect(JSON.stringify(notificationBody)).not.toContain(accessToken);
      expect(JSON.stringify(notificationBody)).not.toContain(adminAlertWebhookToken);
      expect(JSON.stringify(notificationBody)).not.toContain(webhook.url);
      expect(JSON.stringify(notificationBody)).not.toContain(dataDir);
      expect(JSON.stringify(notificationBody)).not.toContain("/Users/");
    } finally {
      await webhook.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rolls back ordinary teaching operation records in the durable external store", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-teaching-ops-rollback-"));
    const accessToken = "test-external-storage-token";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;
      const targetRecordId =
        "course-settings-save-course-settings-20260622-110500-abcd1234";
      const appendResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/append`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
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
              traceId: "trace-external-teaching-ops-rollback-before",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              actorRole: "teacher",
              authMode: "signed-teacher-session",
              operationId: "course-settings",
              actionSlot: "primary",
              actionId: "save-course-settings",
              courseId: "teacher-research-methods",
              requestSource: {
                userAgent: "vitest external storage rollback",
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
      );
      expect(appendResponse.status).toBe(200);

      const rollbackResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/records/${targetRecordId}/rollback`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "rollback-teaching-operation-record",
            courseId: "teacher-research-methods",
            rollbackReason: "teacher-control-plane-test",
            traceId: "trace-external-teaching-ops-rollback-001",
            requestedAt: "2026-06-22T11:25:00.000Z",
            requestSource: {
              userAgent: "vitest external storage rollback",
              ipAddress: "redacted",
            },
          }),
        },
      );
      const rollbackBody = await rollbackResponse.json();

      expect(rollbackResponse.status).toBe(200);
      expect(rollbackBody).toEqual(
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

      const auditResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/audit`,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
      );
      const auditBody = await auditResponse.json();
      expect(auditResponse.status).toBe(200);
      expect(auditBody).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          eventType: "teaching-operation-audit",
          recordCount: 2,
        }),
      );
      expect(auditBody.events).toContainEqual(
        expect.objectContaining({
          eventType: "teaching-operation.rolled-back",
          traceId: "trace-external-teaching-ops-rollback-001",
          targetRecordId,
          rollbackReason: "teacher-control-plane-test",
          courseId: "teacher-research-methods",
        }),
      );
      expect(JSON.stringify(rollbackBody)).not.toContain(accessToken);
      expect(JSON.stringify(rollbackBody)).not.toContain(dataDir);
      expect(JSON.stringify(rollbackBody)).not.toContain("/Users/");
      expect(JSON.stringify(auditBody)).not.toContain(accessToken);
      expect(JSON.stringify(auditBody)).not.toContain(dataDir);
      expect(JSON.stringify(auditBody)).not.toContain("/Users/");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed before production teaching operation rollbacks without managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-rollback-proof-"));
    const accessToken = "production-external-storage-token-strong-fixture";
    const targetRecordId =
      "course-settings-save-course-settings-20260626-rollback-proof";
    const seedServer = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
      "--service-mode",
      "production",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS: "managed-database",
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS: "up-to-date",
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY: "point-in-time-restore",
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL: "transactional",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(seedServer);

    try {
      const seedReady = await waitForServiceReady(seedServer);
      const seedBaseUrl = `http://${seedReady.host}:${seedReady.port}`;
      const appendResponse = await fetch(
        `${seedBaseUrl}/teaching-operations/teacher-kang/append`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
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
      );
      expect(appendResponse.status).toBe(200);
      await stopServer(seedServer);

      const blockedServer = spawn("node", [
        "scripts/external-storage-service.mjs",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
        "--data-dir",
        dataDir,
        "--service-mode",
        "production",
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
          UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS: undefined,
          UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS: undefined,
          UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY: undefined,
          UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL: undefined,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      spawnedServers.push(blockedServer);
      const blockedReady = await waitForServiceReady(blockedServer);
      const blockedBaseUrl = `http://${blockedReady.host}:${blockedReady.port}`;
      const rollbackResponse = await fetch(
        `${blockedBaseUrl}/teaching-operations/teacher-kang/records/${targetRecordId}/rollback`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "rollback-teaching-operation-record",
            courseId: "teacher-research-methods",
            rollbackReason: "production-db-proof-required",
            traceId: "trace-external-teaching-ops-rollback-proof",
            requestedAt: "2026-06-26T11:21:00.000Z",
            requestSource: {
              userAgent: "vitest external rollback db proof",
              ipAddress: "redacted",
            },
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
      expect(JSON.stringify(body)).not.toContain(accessToken);
      expect(JSON.stringify(body)).not.toContain(dataDir);
      expect(JSON.stringify(body)).not.toContain("/Users/");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("creates and verifies a teaching operation backup restore drill in the durable external store", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-restore-drill-"));
    const accessToken = "test-external-storage-token";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;
      const recordId = "course-settings-save-course-settings-20260622-113000-abcd1234";
      const appendResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/append`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
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
              traceId: "trace-external-teaching-ops-backup-source",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              actorRole: "teacher",
              authMode: "signed-teacher-session",
              operationId: "course-settings",
              actionSlot: "primary",
              actionId: "save-course-settings",
              courseId: "teacher-research-methods",
              requestSource: {
                userAgent: "vitest external storage restore drill",
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
      );
      expect(appendResponse.status).toBe(200);

      const backupResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/backups`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "create-teaching-operation-backup",
            requestedBy: "s12-restore-drill",
            requestedAt: "2026-06-22T11:35:00.000Z",
            traceId: "trace-external-teaching-ops-backup-001",
          }),
        },
      );
      const backupBody = await backupResponse.json();

      expect(backupResponse.status).toBe(200);
      expect(backupBody).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          backupId: "teaching-operations-backup-teacher-kang-20260622-113500",
          status: "persisted",
          eventType: "teaching-operation-backup.created",
          traceId: "trace-external-teaching-ops-backup-001",
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
      expect(persistedBackup).toContain("trace-external-teaching-ops-backup-source");
      expect(persistedBackup).not.toContain(accessToken);
      expect(persistedBackup).not.toContain(dataDir);
      expect(persistedBackup).not.toContain("/Users/");

      const restoreDrillResponse = await fetch(
        `${baseUrl}/teaching-operations/teacher-kang/backups/teaching-operations-backup-teacher-kang-20260622-113500/restore-drill`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "verify-teaching-operation-backup-restore",
            requestedBy: "s12-restore-drill",
            requestedAt: "2026-06-22T11:36:00.000Z",
            traceId: "trace-external-teaching-ops-restore-drill-001",
          }),
        },
      );
      const restoreDrillBody = await restoreDrillResponse.json();

      expect(restoreDrillResponse.status).toBe(200);
      expect(restoreDrillBody).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          backupId: "teaching-operations-backup-teacher-kang-20260622-113500",
          drillId:
            "teaching-operations-restore-drill-teaching-operations-backup-teacher-kang-20260622-113500",
          status: "verified",
          eventType: "teaching-operation-backup.restore-drill-verified",
          traceId: "trace-external-teaching-ops-restore-drill-001",
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
        "trace-external-teaching-ops-restore-drill-001",
      );
      expect(persistedRestoreDrill).toContain(
        "teaching-operations-backup-teacher-kang-20260622-113500",
      );
      expect(persistedRestoreDrill).not.toContain(accessToken);
      expect(persistedRestoreDrill).not.toContain(dataDir);
      expect(persistedRestoreDrill).not.toContain("/Users/");
      expect(JSON.stringify(backupBody)).not.toContain(accessToken);
      expect(JSON.stringify(backupBody)).not.toContain(dataDir);
      expect(JSON.stringify(backupBody)).not.toContain("/Users/");
      expect(JSON.stringify(restoreDrillBody)).not.toContain(accessToken);
      expect(JSON.stringify(restoreDrillBody)).not.toContain(dataDir);
      expect(JSON.stringify(restoreDrillBody)).not.toContain("/Users/");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed before production backup and restore-drill writes without managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-backup-proof-"));
    const accessToken = "production-external-storage-token-strong-fixture";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      dataDir,
      "--service-mode",
      "production",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS: undefined,
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS: undefined,
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY: undefined,
        UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL: undefined,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    try {
      const ready = await waitForServiceReady(server);
      const baseUrl = `http://${ready.host}:${ready.port}`;
      const post = (path: string, body: unknown) =>
        fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });

      const responses = await Promise.all([
        post("/teaching-course-management/backups", {
          action: "create-teaching-course-management-backup",
          requestedBy: "s12-backup-proof",
          requestedAt: "2026-06-26T11:10:00.000Z",
          traceId: "trace-external-course-management-backup-proof",
        }),
        post(
          "/teaching-course-management/backups/teaching-course-management-backup-20260626-111000/restore-drill",
          {
            action: "verify-teaching-course-management-backup-restore",
            requestedBy: "s12-backup-proof",
            requestedAt: "2026-06-26T11:11:00.000Z",
            traceId: "trace-external-course-management-restore-proof",
          },
        ),
        post("/teaching-course-assets/backups", {
          action: "create-teaching-course-assets-backup",
          requestedBy: "s12-backup-proof",
          requestedAt: "2026-06-26T11:12:00.000Z",
          traceId: "trace-external-course-assets-backup-proof",
        }),
        post(
          "/teaching-course-assets/backups/teaching-course-assets-backup-20260626-111200/restore-drill",
          {
            action: "verify-teaching-course-assets-backup-restore",
            requestedBy: "s12-backup-proof",
            requestedAt: "2026-06-26T11:13:00.000Z",
            traceId: "trace-external-course-assets-restore-proof",
          },
        ),
        post("/teaching-operations/teacher-kang/backups", {
          action: "create-teaching-operation-backup",
          requestedBy: "s12-backup-proof",
          requestedAt: "2026-06-26T11:14:00.000Z",
          traceId: "trace-external-teaching-ops-backup-proof",
        }),
        post(
          "/teaching-operations/teacher-kang/backups/teaching-operations-backup-teacher-kang-20260626-111400/restore-drill",
          {
            action: "verify-teaching-operation-backup-restore",
            requestedBy: "s12-backup-proof",
            requestedAt: "2026-06-26T11:15:00.000Z",
            traceId: "trace-external-teaching-ops-restore-proof",
          },
        ),
      ]);
      const results = await Promise.all(
        responses.map(async (response) => ({
          status: response.status,
          body: await response.json(),
        })),
      );

      for (const result of results) {
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
        expect(JSON.stringify(result.body)).not.toContain(accessToken);
        expect(JSON.stringify(result.body)).not.toContain(dataDir);
        expect(JSON.stringify(result.body)).not.toContain("/Users/");
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

  it("returns a blocked redacted health contract when the backing store probe cannot write", async () => {
    const escapedDataDir = join(tmpdir(), "..", "..");
    const accessToken = "production-external-storage-token-strong-fixture";
    const server = spawn("node", [
      "scripts/external-storage-service.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      escapedDataDir,
      "--service-mode",
      "production",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawnedServers.push(server);

    const ready = await waitForServiceReady(server);
    const health = await fetch(`http://${ready.host}:${ready.port}/healthz`);
    const body = await health.json();

    expect(health.status).toBe(503);
    expect(health.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        target: "uais-external-storage-production-service",
        apiContractVersion: "uais-external-storage-v1",
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
          productionDatabaseAdapter: createBlockedProductionDatabaseAdapter(),
          valueRedacted: true,
        }),
        teachingCourseManagementStorageSchema: expect.objectContaining(
          createBlockedSnapshotStorageSchema("uais-teaching-course-management-v1"),
        ),
        teachingCourseAssetsStorageSchema: expect.objectContaining(
          createBlockedSnapshotStorageSchema("uais-teaching-course-assets-v1"),
        ),
        redaction: {
          secrets: "omitted",
          assets: "ids-only",
          localFiles: "omitted",
        },
      }),
    );
    expect(JSON.stringify(body)).not.toContain(accessToken);
    expect(JSON.stringify(body)).not.toContain(escapedDataDir);
    expect(JSON.stringify(body)).not.toContain("/Users/");
  });

  it("refuses production service identity when the access token is weak", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-production-weak-"));

    try {
      const result = execFileSync("node", [
        "scripts/external-storage-service.mjs",
        "--data-dir",
        dataDir,
        "--access-token",
        "short-token",
        "--service-mode",
        "production",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });

      expect(result).toBe("__unreachable__");
    } catch (error) {
      const failure = error as { status?: number; stderr?: Buffer; stdout?: Buffer };
      expect(failure.status).not.toBe(0);
      const combined = `${failure.stdout?.toString() ?? ""}\n${failure.stderr?.toString() ?? ""}`;
      expect(combined).toContain("Production external storage service requires a strong access token.");
      expect(combined).not.toContain("short-token");
      expect(combined).not.toContain(dataDir);
      expect(combined).not.toContain("/Users/");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

async function startWebhookReceiver() {
  const requests: Array<{
    method: string;
    pathname: string;
    authorization: string | null;
    body: unknown;
  }> = [];
  const server = createServer((request, response) => {
    let rawBody = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      rawBody += chunk;
    });
    request.on("end", () => {
      requests.push({
        method: request.method ?? "",
        pathname: request.url ?? "",
        authorization:
          typeof request.headers.authorization === "string"
            ? request.headers.authorization
            : null,
        body: rawBody ? JSON.parse(rawBody) : null,
      });
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "accepted" }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Webhook receiver failed to bind to a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/alerts`,
    requests,
    close: () => closeServer(server),
  };
}

async function closeServer(server: Server) {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function createExpectedSnapshotStorageSchema(
  schemaVersion: string,
  productionDatabaseAdapter = createBlockedProductionDatabaseAdapter(),
) {
  return {
    status: "ready",
    schemaVersion,
    migrationStatus: "up-to-date",
    snapshotStore: "json-atomic-snapshot",
    auditLog: "jsonl-append-only",
    backupStore: "json-atomic-snapshot",
    restoreDrillLog: "jsonl-append-only",
    revisionControl: "optimistic-revision",
    concurrencyControl: "atomic-rename-with-revision-check",
    productionDatabaseAdapter,
    valueRedacted: true,
  };
}

function createBlockedTeachingOperationsStorageSchema() {
  return {
    status: "blocked",
    schemaVersion: "uais-teaching-operations-v1",
    migrationStatus: "blocked",
    productionDatabaseAdapter: createBlockedProductionDatabaseAdapter(),
    valueRedacted: true,
  };
}

function createBlockedSnapshotStorageSchema(schemaVersion: string) {
  return {
    status: "blocked",
    schemaVersion,
    migrationStatus: "blocked",
    productionDatabaseAdapter: createBlockedProductionDatabaseAdapter(),
    valueRedacted: true,
  };
}

function createBlockedProductionDatabaseAdapter() {
  return {
    status: "blocked",
    providerClass: "not-configured",
    migrationStatus: "blocked",
    backupPolicy: "not-configured",
    concurrencyControl: "blocked",
    valueRedacted: true,
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

function createConcurrentTeachingOperationAppendBody(index: 1 | 2) {
  const suffix = String(index).padStart(3, "0");
  const recordId = `course-settings-concurrent-teaching-ops-${suffix}`;
  const traceId = `trace-concurrent-teaching-ops-${suffix}`;
  const auditId = `audit-concurrent-teaching-ops-${suffix}`;
  const courseId = "teacher-research-methods";
  const createdAt = `2026-06-22T11:08:0${index}.000Z`;

  return {
    action: "append-teaching-operation",
    record: {
      recordId,
      operationId: "course-settings",
      actionSlot: "primary",
      actionId: "save-course-settings",
      actorId: "teacher-kang",
      courseId,
      createdAt,
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
        {
          kind: "domain-object",
          objectType: "course-settings",
          objectId: `course-settings-${courseId}-${suffix}`,
        },
      ],
      domainProjections: [
        {
          objectId: `course-settings-${courseId}-${suffix}`,
          objectType: "course-settings",
          courseId,
          updatedBy: "teacher-kang",
          status: "saved",
          operationRecordId: recordId,
          updatedAt: createdAt,
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
      auditId,
      traceId,
      eventType: "teaching-operation.persisted",
      actorId: "teacher-kang",
      actorRole: "teacher",
      authMode: "signed-teacher-session",
      operationId: "course-settings",
      actionSlot: "primary",
      actionId: "save-course-settings",
      courseId,
      requestSource: {
        userAgent: "vitest external storage concurrent append",
        ipAddress: "redacted",
      },
      createdAt,
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    },
  };
}

function expectedSnapshotStorageShapeChecks(prefix: string) {
  return {
    [prefix]: "present",
    [`${prefix}.status`]: "present",
    [`${prefix}.schemaVersion`]: "present",
    [`${prefix}.migrationStatus`]: "present",
    [`${prefix}.snapshotStore`]: "present",
    [`${prefix}.auditLog`]: "present",
    [`${prefix}.backupStore`]: "present",
    [`${prefix}.restoreDrillLog`]: "present",
    [`${prefix}.revisionControl`]: "present",
    [`${prefix}.concurrencyControl`]: "present",
    [`${prefix}.valueRedacted`]: "present",
  };
}

async function waitForServiceReady(server: ChildProcessWithoutNullStreams) {
  let stdout = "";
  let stderr = "";
  return await new Promise<{ host: string; port: number; raw: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`External storage service did not become ready. ${stderr}`));
    }, 5_000);

    server.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    server.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().startsWith("{"));
      if (!line) return;
      clearTimeout(timeout);
      try {
        const ready = JSON.parse(line) as { host?: unknown; port?: unknown };
        if (typeof ready.host !== "string" || typeof ready.port !== "number") {
          reject(new Error("External storage service ready line was missing host or port."));
          return;
        }
        resolve({ host: ready.host, port: ready.port, raw: line });
      } catch (error) {
        reject(error);
      }
    });
    server.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`External storage service exited before ready with code ${code}. ${stderr}`));
    });
  });
}

async function stopServer(server: ChildProcessWithoutNullStreams) {
  if (server.exitCode !== null || server.killed) {
    return;
  }
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
    setTimeout(() => resolve(), 1_000);
  });
}
