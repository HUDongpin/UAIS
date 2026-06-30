import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("external storage smoke service readiness binding", () => {
  it("preserves ordinary teaching provider receipts in course-management snapshots", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-provider-receipts-"));
    const port = 45941;
    const accessToken = "test-production-external-storage-token-32-chars";
    const service = execFile(
      "node",
      [
        "scripts/external-storage-service.mjs",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--data-dir",
        dataDir,
        "--service-mode",
        "production",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
          UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS: "managed-database",
          UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS: "up-to-date",
          UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY: "point-in-time-restore",
          UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL: "transactional",
        },
      },
    );

    try {
      await waitForExternalStorageService(port);
      const database = createCourseManagementProviderReceiptDatabase();
      const putResponse = await fetch(
        `http://127.0.0.1:${port}/teaching-course-management/database`,
        {
          method: "PUT",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "replace-teaching-course-management-database",
            expectedRevision: "rev-empty",
            database,
          }),
        },
      );
      expect(putResponse.status, await putResponse.text()).toBe(200);

      const getResponse = await fetch(
        `http://127.0.0.1:${port}/teaching-course-management/database`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
          },
        },
      );
      const body = (await getResponse.json()) as {
        database?: {
          studentRosters?: Array<Record<string, unknown>>;
          exportManifests?: Array<Record<string, unknown>>;
          gradebookUpdates?: Array<Record<string, unknown>>;
          gradingFeedbackDrafts?: Array<Record<string, unknown>>;
        };
      };

      expect(getResponse.status).toBe(200);
      expect(body.database?.studentRosters?.[0]).toEqual(
        expect.objectContaining({
          providerStatus: "sis-provider-synced",
          providerSyncId: "sis-sync-repro",
          providerSyncedAt: "2026-06-22T10:02:00.000Z",
        }),
      );
      expect(body.database?.exportManifests?.[0]).toEqual(
        expect.objectContaining({
          providerStatus: "export-provider-exported",
          providerExportId: "course-export-repro",
          providerExportedAt: "2026-06-22T10:02:00.000Z",
        }),
      );
      expect(body.database?.gradebookUpdates?.[0]).toEqual(
        expect.objectContaining({
          objectId: "gradebook-update-teacher-research-methods",
          objectType: "gradebook-update",
          updateStatus: "pending-release",
          storagePolicy: "domain-projection-teaching-gradebook-update",
        }),
      );
      expect(body.database?.gradingFeedbackDrafts?.[0]).toEqual(
        expect.objectContaining({
          providerStatus: "feedback-provider-generated",
          providerFeedbackId: "grading-feedback-repro",
          providerGeneratedAt: "2026-06-22T10:02:00.000Z",
        }),
      );
      expect(JSON.stringify(body)).not.toContain(accessToken);
      expect(JSON.stringify(body)).not.toContain(dataDir);
      expect(JSON.stringify(body)).not.toContain("/Users/");
    } finally {
      service.kill();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns managed database adapter proof on course-assets readback in production mode", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-external-storage-course-assets-adapter-"));
    const port = 45942;
    const accessToken = "test-production-external-storage-token-32-chars";
    const service = execFile(
      "node",
      [
        "scripts/external-storage-service.mjs",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--data-dir",
        dataDir,
        "--service-mode",
        "production",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
          UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS: "managed-database",
          UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS: "up-to-date",
          UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY: "point-in-time-restore",
          UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL: "transactional",
        },
      },
    );

    try {
      await waitForExternalStorageService(port);
      const response = await fetch(
        `http://127.0.0.1:${port}/teaching-course-assets/database`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
          },
        },
      );
      const body = (await response.json()) as {
        revision?: string;
        productionDatabaseAdapter?: Record<string, unknown>;
      };

      expect(response.status).toBe(200);
      expect(body.revision).toBe("rev-empty");
      expect(body.productionDatabaseAdapter).toEqual(
        expect.objectContaining({
          status: "ready",
          providerClass: "managed-database",
          migrationStatus: "up-to-date",
          backupPolicy: "point-in-time-restore",
          concurrencyControl: "transactional",
          valueRedacted: true,
        }),
      );
      expect(JSON.stringify(body)).not.toContain(accessToken);
      expect(JSON.stringify(body)).not.toContain(dataDir);
      expect(JSON.stringify(body)).not.toContain("/Users/");
    } finally {
      service.kill();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("plans health response-shape checks for ordinary teaching managed database adapter proof", () => {
    const output = execFileSync("node", [
      "scripts/external-storage-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);
    const healthCheck = body.checks.find(
      (check: { id?: string }) => check.id === "s22-external-storage-health",
    );
    const checkIds = body.checks.map((check: { id?: string }) => check.id);

    expect(healthCheck).toEqual(
      expect.objectContaining({
        responseShapeChecks: expect.arrayContaining([
          "teachingOperationsStorageSchema.productionDatabaseAdapter",
          "teachingOperationsStorageSchema.productionDatabaseAdapter.status",
          "teachingOperationsStorageSchema.productionDatabaseAdapter.providerClass",
          "teachingOperationsStorageSchema.productionDatabaseAdapter.migrationStatus",
          "teachingOperationsStorageSchema.productionDatabaseAdapter.backupPolicy",
          "teachingOperationsStorageSchema.productionDatabaseAdapter.concurrencyControl",
          "teachingOperationsStorageSchema.productionDatabaseAdapter.valueRedacted",
          "teachingCourseManagementStorageSchema.productionDatabaseAdapter",
          "teachingCourseManagementStorageSchema.productionDatabaseAdapter.status",
          "teachingCourseManagementStorageSchema.productionDatabaseAdapter.providerClass",
          "teachingCourseManagementStorageSchema.productionDatabaseAdapter.migrationStatus",
          "teachingCourseManagementStorageSchema.productionDatabaseAdapter.backupPolicy",
          "teachingCourseManagementStorageSchema.productionDatabaseAdapter.concurrencyControl",
          "teachingCourseManagementStorageSchema.productionDatabaseAdapter.valueRedacted",
          "teachingCourseAssetsStorageSchema.productionDatabaseAdapter",
          "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.status",
          "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.providerClass",
          "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.migrationStatus",
          "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.backupPolicy",
          "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.concurrencyControl",
          "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.valueRedacted",
        ]),
      }),
    );
    expect(checkIds).toEqual(
      expect.arrayContaining([
        "s12-external-teaching-operations-concurrent-append-readback",
        "s12-external-teaching-operations-unauthenticated-append-denied",
        "s12-external-teaching-operations-invalid-token-append-denied",
      ]),
    );
    expect(output).not.toContain("/Users/");
  });

  it("blocks production smoke planning when service readiness lacks launch contract proof", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-smoke-launch-"));
    const envFile = join(tmpDir, "storage.env");
    const readinessFile = join(tmpDir, "service-readiness.json");
    const baseUrl = "https://storage-production.example.test/uais";
    const accessToken = "secret-production-storage-token";
    const teacherId = "teacher-kang-smoke";
    const releaseRunId = "uais-release-storage-smoke-launch-binding";
    writeFileSync(
      envFile,
      [
        `UAIS_EXTERNAL_STORAGE_BASE_URL=${baseUrl}`,
        `UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=${accessToken}`,
      ].join("\n"),
    );
    writeFileSync(
      readinessFile,
      JSON.stringify(
        {
          target: "external-storage-service-readiness",
          mode: "live",
          environment: "production",
          status: "ready",
          releaseRunId,
          storageEndpoint: {
            status: "present",
            networkClass: "remote",
            endpointClass: "remote-https",
            valueRedacted: true,
          },
          storageServiceFingerprint: createStorageServiceFingerprintForTest(baseUrl),
        },
        null,
        2,
      ),
    );

    const output = execFileSync("node", [
      "scripts/external-storage-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--teacher-id",
      teacherId,
      "--release-run-id",
      releaseRunId,
      "--external-storage-service-readiness",
      readinessFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-smoke",
        mode: "dry-run",
        environment: "production",
        status: "blocked",
        blockedReasons: [
          "external-storage-service-readiness-launch-contract-not-proven",
        ],
        externalStorageServiceReadinessEvidence: {
          target: "external-storage-service-readiness",
          status: "launch-contract-not-proven",
          valueRedacted: true,
          releaseRunIdStatus: "matched",
          productionLaunchContractEvidence: {
            target: "missing",
            status: "missing",
            valueRedacted: true,
            serviceMode: "missing",
            runtime: "missing",
            envContract: "missing",
            dataDirPersistence: "missing",
            containerArtifact: "missing",
            redactionSafety: "missing",
          },
        },
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(accessToken);
    expect(output).not.toContain(teacherId);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks production smoke planning when readiness launch proof lacks persistent-volume data-dir binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-smoke-volume-"));
    const envFile = join(tmpDir, "storage.env");
    const readinessFile = join(tmpDir, "service-readiness.json");
    const baseUrl = "https://storage-production.example.test/uais";
    const accessToken = "secret-production-storage-token";
    const teacherId = "teacher-kang-smoke";
    const releaseRunId = "uais-release-storage-smoke-volume-binding";
    writeFileSync(
      envFile,
      [
        `UAIS_EXTERNAL_STORAGE_BASE_URL=${baseUrl}`,
        `UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=${accessToken}`,
      ].join("\n"),
    );
    writeFileSync(
      readinessFile,
      JSON.stringify(
        {
          target: "external-storage-service-readiness",
          mode: "live",
          environment: "production",
          status: "ready",
          releaseRunId,
          storageEndpoint: {
            status: "present",
            networkClass: "remote",
            endpointClass: "remote-https",
            valueRedacted: true,
          },
          storageServiceFingerprint: createStorageServiceFingerprintForTest(baseUrl),
          productionLaunchContractEvidence: {
            target: "external-storage-service-production-launcher",
            status: "ready",
            valueRedacted: true,
            serviceMode: "production",
            runtime: "proved",
            envContract: "proved",
            containerArtifact: "proved",
            redactionSafety: "proved",
          },
        },
        null,
        2,
      ),
    );

    const output = execFileSync("node", [
      "scripts/external-storage-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--teacher-id",
      teacherId,
      "--release-run-id",
      releaseRunId,
      "--external-storage-service-readiness",
      readinessFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-smoke",
        mode: "dry-run",
        environment: "production",
        status: "blocked",
        blockedReasons: [
          "external-storage-service-readiness-launch-contract-not-proven",
        ],
        externalStorageServiceReadinessEvidence: expect.objectContaining({
          status: "launch-contract-not-proven",
          productionLaunchContractEvidence: expect.objectContaining({
            status: "not-ready",
            dataDirPersistence: "missing",
          }),
        }),
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(accessToken);
    expect(output).not.toContain(teacherId);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("allows local reference smoke planning to bind local readiness with launch contract proof", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-smoke-local-readiness-"));
    const envFile = join(tmpDir, "storage.env");
    const readinessFile = join(tmpDir, "service-readiness.json");
    const baseUrl = "http://127.0.0.1:8788";
    const accessToken = "secret-local-storage-token";
    const teacherId = "teacher-kang-smoke";
    writeFileSync(
      envFile,
      [
        `UAIS_EXTERNAL_STORAGE_BASE_URL=${baseUrl}`,
        `UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=${accessToken}`,
      ].join("\n"),
    );
    writeFileSync(
      readinessFile,
      JSON.stringify(
        {
          target: "external-storage-service-readiness",
          mode: "live",
          environment: "local-production",
          status: "blocked",
          blockedReasons: ["external-storage-service-readiness-not-production"],
          storageEndpoint: {
            status: "present",
            networkClass: "local-loopback",
            endpointClass: "local-loopback",
            valueRedacted: true,
          },
          storageServiceFingerprint: createStorageServiceFingerprintForTest(baseUrl),
          productionLaunchContractEvidence: {
            target: "external-storage-service-production-launcher",
            status: "ready",
            valueRedacted: true,
            serviceMode: "production",
            runtime: "proved",
            envContract: "proved",
            dataDirPersistence: "proved",
            containerArtifact: "proved",
            redactionSafety: "proved",
          },
          health: {
            httpStatus: 200,
            status: "ok",
            target: "uais-external-storage-production-service",
            cacheControl: "no-store",
            productionServiceIdentity: "proved",
            apiContractVersion: "matched",
            durableBackingStore: "ready",
            redaction: "present",
          },
        },
        null,
        2,
      ),
    );

    const output = execFileSync("node", [
      "scripts/external-storage-smoke.mjs",
      "--dry-run",
      "--environment",
      "local-reference",
      "--env-file",
      envFile,
      "--teacher-id",
      teacherId,
      "--external-storage-service-readiness",
      readinessFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-smoke",
        mode: "dry-run",
        environment: "local-reference",
        status: "ready",
        blockedReasons: [],
        externalStorageServiceReadinessEvidence: {
          target: "external-storage-service-readiness",
          status: "local-reference-matched",
          valueRedacted: true,
          releaseRunIdStatus: "not-required",
          productionLaunchContractEvidence: {
            target: "external-storage-service-production-launcher",
            status: "ready",
            valueRedacted: true,
            serviceMode: "production",
            runtime: "proved",
            envContract: "proved",
            dataDirPersistence: "proved",
            containerArtifact: "proved",
            redactionSafety: "proved",
          },
        },
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(accessToken);
    expect(output).not.toContain(teacherId);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("retries transient storage smoke request failures before evaluating response shapes", async () => {
    const accessToken = "secret-production-storage-token";
    const teacherId = "teacher-kang-smoke";
    const attempts = new Map<string, number>();
    let ownership: unknown;
    let auditEvent: unknown;
    const teachingOperationRecords: unknown[] = [];
    const teachingOperationAuditEvents: unknown[] = [];
    const teachingOperationDomainProjections: unknown[] = [];
    const courseManagementBackupId = "teaching-course-management-backup-20260625-120000";
    const courseAssetsBackupId = "teaching-course-assets-backup-20260625-120500";
    const teachingOperationsBackupId =
      "teaching-operations-backup-teacher-kang-smoke-20260625-121000";
    const server = createServer(async (request, response) => {
      const route = request.url ?? "/";
      const attempt = (attempts.get(route) ?? 0) + 1;
      attempts.set(route, attempt);
      if (request.method === "GET" && route === "/healthz" && attempt === 1) {
        request.socket.destroy();
        return;
      }

      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && route === "/healthz") {
        response.setHeader("cache-control", "no-store");
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            productionServiceIdentity: {
              status: "proved",
              serviceMode: "production",
              serviceTarget: "uais-external-storage-production-service",
              valueRedacted: true,
            },
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
              valueRedacted: true,
            },
            teachingCourseManagementStorageSchema: createReadySnapshotStorageSchemaForTest(
              "uais-teaching-course-management-v1",
            ),
            teachingCourseAssetsStorageSchema: createReadySnapshotStorageSchemaForTest(
              "uais-teaching-course-assets-v1",
            ),
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.headers.authorization !== `Bearer ${accessToken}`) {
        response.statusCode = 401;
        response.end(
          JSON.stringify({
            error: "unauthorized",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (
        request.method === "POST" &&
        route === `/teacher-ai-ownership/${teacherId}/merge`
      ) {
        const body = JSON.parse(await readRequestBodyForTest(request));
        ownership = body.ownership;
        response.end(
          JSON.stringify({
            teacherId,
            status: "merged",
            storageWritePolicy: "external-atomic-merge",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.method === "GET" && route === `/teacher-ai-ownership/${teacherId}`) {
        response.end(JSON.stringify(ownership));
        return;
      }
      if (request.method === "POST" && route === "/teaching-course-management/backups") {
        await readRequestBodyForTest(request);
        response.end(
          JSON.stringify({
            backupId: courseManagementBackupId,
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
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (
        request.method === "POST" &&
        route === `/teaching-course-management/backups/${courseManagementBackupId}/restore-drill`
      ) {
        await readRequestBodyForTest(request);
        response.end(
          JSON.stringify({
            backupId: courseManagementBackupId,
            drillId: `teaching-course-management-restore-drill-${courseManagementBackupId}`,
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
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.method === "POST" && route === "/teaching-course-assets/backups") {
        await readRequestBodyForTest(request);
        response.end(
          JSON.stringify({
            backupId: courseAssetsBackupId,
            status: "persisted",
            eventType: "teaching-course-assets-backup.created",
            sourceRecordCounts: {
              assets: 0,
              auditEvents: 0,
            },
            storagePolicy: "external-redacted-teaching-course-assets-backup",
            storageWritePolicy: "external-atomic-backup-snapshot",
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (
        request.method === "POST" &&
        route === `/teaching-course-assets/backups/${courseAssetsBackupId}/restore-drill`
      ) {
        await readRequestBodyForTest(request);
        response.end(
          JSON.stringify({
            backupId: courseAssetsBackupId,
            drillId: `teaching-course-assets-restore-drill-${courseAssetsBackupId}`,
            status: "verified",
            eventType: "teaching-course-assets-backup.restore-drill-verified",
            restoredRecordCounts: {
              assets: 0,
              auditEvents: 0,
            },
            storagePolicy: "external-redacted-teaching-course-assets-restore-drill",
            storageWritePolicy: "external-append-only-restore-drill-log",
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (
        request.method === "POST" &&
        route === `/teaching-operations/${teacherId}/backups`
      ) {
        await readRequestBodyForTest(request);
        response.end(
          JSON.stringify({
            backupId: teachingOperationsBackupId,
            status: "persisted",
            eventType: "teaching-operation-backup.created",
            sourceRecordCounts: {
              operations: 0,
              auditEvents: 0,
              rollbacks: 0,
              alertNotifications: 0,
            },
            storagePolicy: "external-redacted-teaching-operation-backup",
            storageWritePolicy: "external-atomic-backup-snapshot",
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (
        request.method === "POST" &&
        route ===
          `/teaching-operations/${teacherId}/backups/${teachingOperationsBackupId}/restore-drill`
      ) {
        await readRequestBodyForTest(request);
        response.end(
          JSON.stringify({
            backupId: teachingOperationsBackupId,
            drillId: `teaching-operations-restore-drill-${teachingOperationsBackupId}`,
            status: "verified",
            eventType: "teaching-operation-backup.restore-drill-verified",
            restoredRecordCounts: {
              operations: 0,
              auditEvents: 0,
              rollbacks: 0,
              alertNotifications: 0,
            },
            storagePolicy: "external-redacted-teaching-operation-restore-drill",
            storageWritePolicy: "external-append-only-restore-drill-log",
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.method === "POST" && route === `/teaching-operations/${teacherId}/append`) {
        const body = JSON.parse(await readRequestBodyForTest(request));
        const appendSequence = teachingOperationRecords.length + 1;
        const record = {
          ...body.record,
          appendSequence,
        };
        teachingOperationRecords.push(record);
        if (body.auditEvent) {
          teachingOperationAuditEvents.push(body.auditEvent);
        }
        if (Array.isArray(body.record?.domainProjections)) {
          teachingOperationDomainProjections.push(...body.record.domainProjections);
        }
        response.end(
          JSON.stringify({
            teacherId,
            receiptId: body.record.recordId,
            status: "persisted",
            idempotencyStatus: "created",
            appendSequence,
            storagePolicy: "external-redacted-teaching-operation-append",
            storageWritePolicy: "external-append-only-operation-log",
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.method === "GET" && route === `/teaching-operations/${teacherId}/audit`) {
        response.end(
          JSON.stringify({
            teacherId,
            eventType: "teaching-operation-audit",
            storagePolicy: "external-redacted-teaching-operation-audit-log",
            storageWritePolicy: "external-append-only-audit-log",
            recordCount: teachingOperationAuditEvents.length,
            events: teachingOperationAuditEvents,
            auditEvents: teachingOperationAuditEvents,
            records: teachingOperationRecords,
            rollbackRecords: [],
            domainProjections: teachingOperationDomainProjections,
            operationRecordCount: teachingOperationRecords.length,
            rollbackRecordCount: 0,
            domainProjectionCount: teachingOperationDomainProjections.length,
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.method === "POST" && route === "/qwen-voice-lifecycle-audit") {
        auditEvent = JSON.parse(await readRequestBodyForTest(request));
        response.end(
          JSON.stringify({
            status: "recorded",
            provider: "qwen",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.method === "GET" && route === "/qwen-voice-lifecycle-audit") {
        response.end(
          JSON.stringify({
            provider: "qwen",
            eventType: "qwen-voice-lifecycle",
            events: auditEvent ? [auditEvent] : [],
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected fake storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const result = await execFileResultForTest("node", [
        "scripts/external-storage-smoke.mjs",
        "--live",
        "--approved",
        "--base-url",
        baseUrl,
        "--teacher-id",
        teacherId,
        "--environment",
        "local-reference",
      ], {
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      });
      const body = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(body.status).toBe("passed");
      expect(body.networkRetryPolicy).toEqual({
        maxAttempts: 3,
        perAttemptTimeoutMs: 10_000,
        retryOn: ["request-error"],
        valuesRedacted: true,
      });
      expect(body.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "s22-external-storage-health",
            status: "ok",
            networkAttempts: {
              attempted: 2,
              maxAttempts: 3,
              retried: true,
              valueRedacted: true,
            },
          }),
          expect.objectContaining({
            id: "s12-external-teacher-ownership-merge",
            status: "ok",
            networkAttempts: {
              attempted: 1,
              maxAttempts: 3,
              retried: false,
              valueRedacted: true,
            },
          }),
          expect.objectContaining({
            id: "s12-external-course-management-backup-restore-drill",
            status: "ok",
            responseShape: expect.objectContaining({
              requiredFields: expect.objectContaining({
                backupStatus: "present",
                restoreDrillStatus: "present",
                backupStorageWritePolicy: "present",
                restoreDrillStorageWritePolicy: "present",
              }),
            }),
          }),
          expect.objectContaining({
            id: "s12-external-course-assets-backup-restore-drill",
            status: "ok",
            responseShape: expect.objectContaining({
              requiredFields: expect.objectContaining({
                backupStatus: "present",
                restoreDrillStatus: "present",
                backupStorageWritePolicy: "present",
                restoreDrillStorageWritePolicy: "present",
              }),
            }),
          }),
          expect.objectContaining({
            id: "s12-external-teaching-operations-backup-restore-drill",
            status: "ok",
            responseShape: expect.objectContaining({
              requiredFields: expect.objectContaining({
                backupStatus: "present",
                restoreDrillStatus: "present",
                backupStorageWritePolicy: "present",
                restoreDrillStorageWritePolicy: "present",
              }),
            }),
          }),
          expect.objectContaining({
            id: "s12-external-teaching-operations-concurrent-append-readback",
            status: "ok",
            responseShape: expect.objectContaining({
              requiredFields: expect.objectContaining({
                bothAppendsPersisted: "present",
                appendSequencesReturned: "present",
                appendSequencesDistinct: "present",
                auditReadbackReturned: "present",
                operationRecordsPresent: "present",
                auditEventsPresent: "present",
                domainProjectionsPresent: "present",
                redaction: "present",
              }),
            }),
          }),
          expect.objectContaining({
            id: "s12-external-teaching-operations-unauthenticated-append-denied",
            status: "ok",
            responseShape: expect.objectContaining({
              requiredFields: expect.objectContaining({
                appendDenied: "present",
                appendResponseRedacted: "present",
                auditReadbackReturned: "present",
                operationRecordAbsent: "present",
                auditEventAbsent: "present",
              }),
            }),
          }),
          expect.objectContaining({
            id: "s12-external-teaching-operations-invalid-token-append-denied",
            status: "ok",
            responseShape: expect.objectContaining({
              requiredFields: expect.objectContaining({
                appendDenied: "present",
                appendResponseRedacted: "present",
                auditReadbackReturned: "present",
                operationRecordAbsent: "present",
                auditEventAbsent: "present",
              }),
            }),
          }),
        ]),
      );
      expect(attempts.get("/healthz")).toBe(2);
      expect(result.stdout).not.toContain(accessToken);
      expect(result.stdout).not.toContain(baseUrl);
      expect(result.stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("fails live smoke health shape when service identity or cache-control proof is missing", async () => {
    const accessToken = "secret-production-storage-token";
    const teacherId = "teacher-kang-smoke";
    let ownership: unknown;
    let auditEvent: unknown;
    const server = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url === "/healthz") {
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            durableBackingStore: {
              status: "ready",
              storageMode: "file-backed",
              probe: "write-read-delete",
              ownershipWritePolicy: "external-atomic-merge",
              lifecycleAuditWritePolicy: "append-only-redacted-lifecycle-audit",
              valueRedacted: true,
            },
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.headers.authorization !== `Bearer ${accessToken}`) {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      if (
        request.method === "POST" &&
        request.url === `/teacher-ai-ownership/${teacherId}/merge`
      ) {
        const body = JSON.parse(await readRequestBodyForTest(request));
        ownership = body.ownership;
        response.end(
          JSON.stringify({
            teacherId,
            status: "merged",
            storageWritePolicy: "external-atomic-merge",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.method === "GET" && request.url === `/teacher-ai-ownership/${teacherId}`) {
        response.end(JSON.stringify(ownership));
        return;
      }
      if (request.method === "POST" && request.url === "/qwen-voice-lifecycle-audit") {
        auditEvent = JSON.parse(await readRequestBodyForTest(request));
        response.end(
          JSON.stringify({
            status: "recorded",
            provider: "qwen",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      if (request.method === "GET" && request.url === "/qwen-voice-lifecycle-audit") {
        response.end(
          JSON.stringify({
            provider: "qwen",
            eventType: "qwen-voice-lifecycle",
            events: auditEvent ? [auditEvent] : [],
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected fake storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const result = await execFileResultForTest("node", [
        "scripts/external-storage-smoke.mjs",
        "--live",
        "--approved",
        "--base-url",
        baseUrl,
        "--teacher-id",
        teacherId,
        "--environment",
        "local-reference",
      ], {
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      });
      const body = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(1);
      expect(body.status).toBe("failed");
      expect(body.results[0]).toEqual(
        expect.objectContaining({
          id: "s22-external-storage-health",
          status: "failed",
          responseShape: {
            checked: true,
            status: "failed",
            requiredFields: expect.objectContaining({
              cacheControlNoStore: "missing",
              productionServiceIdentity: "missing",
              teachingOperationsStorageSchema: "missing",
              teachingCourseManagementStorageSchema: "missing",
              teachingCourseAssetsStorageSchema: "missing",
            }),
          },
        }),
      );
      expect(result.stdout).not.toContain(accessToken);
      expect(result.stdout).not.toContain(baseUrl);
      expect(result.stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("fails live smoke health shape when ordinary course schemas omit managed database adapter proof", async () => {
    const accessToken = "secret-production-storage-token";
    const teacherId = "teacher-kang-smoke";
    const server = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url === "/healthz") {
        response.setHeader("cache-control", "no-store");
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            productionServiceIdentity: {
              status: "proved",
              serviceMode: "production",
              serviceTarget: "uais-external-storage-production-service",
              valueRedacted: true,
            },
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
              valueRedacted: true,
            },
            teachingCourseManagementStorageSchema:
              omitProductionDatabaseAdapterForTest(
                createReadySnapshotStorageSchemaForTest(
                  "uais-teaching-course-management-v1",
                ),
              ),
            teachingCourseAssetsStorageSchema: omitProductionDatabaseAdapterForTest(
              createReadySnapshotStorageSchemaForTest("uais-teaching-course-assets-v1"),
            ),
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected fake storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const result = await execFileResultForTest("node", [
        "scripts/external-storage-smoke.mjs",
        "--live",
        "--approved",
        "--base-url",
        baseUrl,
        "--teacher-id",
        teacherId,
        "--environment",
        "preview",
      ], {
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      });
      const body = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(1);
      expect(body.results[0]).toEqual(
        expect.objectContaining({
          id: "s22-external-storage-health",
          status: "failed",
          responseShape: {
            checked: true,
            status: "failed",
            requiredFields: expect.objectContaining({
              "teachingOperationsStorageSchema.productionDatabaseAdapter":
                "missing",
              "teachingOperationsStorageSchema.productionDatabaseAdapter.status":
                "missing",
              "teachingOperationsStorageSchema.productionDatabaseAdapter.providerClass":
                "missing",
              "teachingOperationsStorageSchema.productionDatabaseAdapter.migrationStatus":
                "missing",
              "teachingOperationsStorageSchema.productionDatabaseAdapter.backupPolicy":
                "missing",
              "teachingOperationsStorageSchema.productionDatabaseAdapter.concurrencyControl":
                "missing",
              "teachingOperationsStorageSchema.productionDatabaseAdapter.valueRedacted":
                "missing",
              "teachingCourseManagementStorageSchema.productionDatabaseAdapter":
                "missing",
              "teachingCourseManagementStorageSchema.productionDatabaseAdapter.status":
                "missing",
              "teachingCourseManagementStorageSchema.productionDatabaseAdapter.providerClass":
                "missing",
              "teachingCourseManagementStorageSchema.productionDatabaseAdapter.migrationStatus":
                "missing",
              "teachingCourseManagementStorageSchema.productionDatabaseAdapter.backupPolicy":
                "missing",
              "teachingCourseManagementStorageSchema.productionDatabaseAdapter.concurrencyControl":
                "missing",
              "teachingCourseManagementStorageSchema.productionDatabaseAdapter.valueRedacted":
                "missing",
              "teachingCourseAssetsStorageSchema.productionDatabaseAdapter":
                "missing",
              "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.status":
                "missing",
              "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.providerClass":
                "missing",
              "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.migrationStatus":
                "missing",
              "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.backupPolicy":
                "missing",
              "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.concurrencyControl":
                "missing",
              "teachingCourseAssetsStorageSchema.productionDatabaseAdapter.valueRedacted":
                "missing",
            }),
          },
        }),
      );
      expect(result.stdout).not.toContain(accessToken);
      expect(result.stdout).not.toContain(baseUrl);
      expect(result.stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

async function waitForExternalStorageService(port: number) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the child process opens the HTTP socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("External storage service did not become ready.");
}

function createCourseManagementProviderReceiptDatabase() {
  const course = {
    courseId: "teacher-research-methods",
    ownerTeacherId: "teacher-kang",
    courseName: "Research Methods",
    instructor: "Kang Xia",
    unit: "Unit 1",
    department: "Experimental Teaching Center",
    semester: "2026 Spring",
    status: "draft",
    students: 0,
    createdAt: "2026-06-22T10:00:00.000Z",
    updatedAt: "2026-06-22T10:00:00.000Z",
    storagePolicy: "external-redacted-teaching-course-management-snapshot",
    storageWritePolicy: "external-optimistic-snapshot-replace",
    responsibleSession: "S12",
    redaction: {
      secrets: "omitted",
      localFiles: "omitted",
      assets: "ids-only",
    },
  };

  return {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: "2026-06-22T10:01:00.000Z",
    courses: [course],
    classes: [],
    memberships: [],
    studentRosters: [
      {
        rosterId: "student-roster-teacher-research-methods",
        courseId: "teacher-research-methods",
        ownerTeacherId: "teacher-kang",
        syncedBy: "teacher-kang",
        syncStatus: "synced",
        operationRecordId: "teaching-operation-students-primary-abc",
        approvedStudentCount: 0,
        pendingTeacherReviewCount: 0,
        classCount: 0,
        sourceSystems: ["sis-roster", "invite-code-joins", "withdrawals"],
        providerStatus: "sis-provider-synced",
        providerSyncId: "sis-sync-repro",
        providerSyncedAt: "2026-06-22T10:02:00.000Z",
        syncedAt: "2026-06-22T10:01:00.000Z",
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
        exportManifestId: "export-manifest-teacher-research-methods",
        courseId: "teacher-research-methods",
        ownerTeacherId: "teacher-kang",
        createdBy: "teacher-kang",
        exportStatus: "generated",
        operationRecordId: "teaching-operation-data-export-primary-abc",
        teachingOperationManifestId: "export-manifest-abc",
        downloadRoute: "/api/teaching/operations/export/export-manifest-abc",
        datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
        formats: ["json", "csv"],
        exportPolicy: "redacted-teacher-export-manifest",
        providerStatus: "export-provider-exported",
        providerExportId: "course-export-repro",
        providerExportedAt: "2026-06-22T10:02:00.000Z",
        createdAt: "2026-06-22T10:01:00.000Z",
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
    gradebookUpdates: [
      {
        objectId: "gradebook-update-teacher-research-methods",
        objectType: "gradebook-update",
        courseId: "teacher-research-methods",
        updatedBy: "teacher-kang",
        updateStatus: "pending-release",
        operationRecordId: "teaching-operation-grading-primary-abc",
        sourceAction: "route-smoke-gradebook-release",
        releasePolicy: "teacher-confirmed-grade-release",
        updatedAt: "2026-06-22T10:01:00.000Z",
        storagePolicy: "domain-projection-teaching-gradebook-update",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      },
    ],
    gradingFeedbackDrafts: [
      {
        gradingFeedbackDraftId: "grading-feedback-draft-teacher-research-methods",
        courseId: "teacher-research-methods",
        ownerTeacherId: "teacher-kang",
        generatedBy: "teacher-kang",
        feedbackStatus: "generated",
        operationRecordId: "teaching-operation-grading-secondary-abc",
        teachingOperationFeedbackArtifactId: "ai-feedback-20260622T100100000Z",
        feedbackScope: "grading-review-queue",
        reviewPolicy: "teacher-review-before-student-release",
        releasePolicy: "teacher-confirmed-feedback-release",
        providerStatus: "feedback-provider-generated",
        providerFeedbackId: "grading-feedback-repro",
        providerGeneratedAt: "2026-06-22T10:02:00.000Z",
        generatedAt: "2026-06-22T10:01:00.000Z",
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
  };
}

async function readRequestBodyForTest(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function execFileResultForTest(
  command: string,
  args: string[],
  env: Record<string, string>,
) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    });
    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error: unknown) {
    const candidate = error as {
      code?: unknown;
      stdout?: unknown;
      stderr?: unknown;
    };
    return {
      exitCode: typeof candidate.code === "number" ? candidate.code : 1,
      stdout: String(candidate.stdout ?? ""),
      stderr: String(candidate.stderr ?? ""),
    };
  }
}

function createStorageServiceFingerprintForTest(baseUrl: string) {
  const parsed = new URL(baseUrl);
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(parsed.origin).digest("hex").slice(0, 16)}`,
    source: "origin",
    valueRedacted: true,
  };
}

function createReadySnapshotStorageSchemaForTest(schemaVersion: string) {
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
    valueRedacted: true,
    productionDatabaseAdapter: {
      status: "ready",
      providerClass: "managed-database",
      migrationStatus: "up-to-date",
      backupPolicy: "point-in-time-restore",
      concurrencyControl: "transactional",
      valueRedacted: true,
    },
  };
}

function omitProductionDatabaseAdapterForTest(
  schema: ReturnType<typeof createReadySnapshotStorageSchemaForTest>,
) {
  const { productionDatabaseAdapter, ...rest } = schema;
  void productionDatabaseAdapter;
  return rest;
}
