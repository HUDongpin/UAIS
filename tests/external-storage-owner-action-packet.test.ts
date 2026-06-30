import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("external storage owner action packet", () => {
  it("summarizes the external storage owner decision without exposing endpoints, tokens, or paths", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-owner-packet-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "external-storage-production-service",
          status: "owner-decision-needed",
          ownerDecisionNeeded: "provision-approved-remote-https-external-storage-service-and-env",
          blockedReasons: [
            "external-storage-service-readiness-not-live-ready",
            "external-storage-smoke-not-live-passed",
          ],
          containerBuildReadinessSummary: {
            evidenceStatus: "ready",
            currentStatus: "ready",
            localImageBuild: "passed",
            releaseGateEligible: true,
            leakedImageTag: "registry.example.test/private/uais-external-storage:secret",
          },
          externalStorageServiceReadinessSummary: {
            evidenceStatus: "dry-run-blocked",
            blockedReason: "external-storage-service-readiness-not-live-ready",
            evidenceEnvironment: "production",
            health: {
              httpStatus: 0,
              status: "missing",
              target: "missing",
              productionServiceIdentity: "missing",
              apiContractVersion: "missing",
              cacheControl: "missing",
              durableBackingStore: "missing",
              teachingOperationsStorageSchema: {
                status: "missing",
                productionDatabaseAdapterStatus: "missing",
                backupStore: "missing",
                restoreDrillLog: "missing",
                leakedDataDir: "/Users/example/private-external-storage-data",
              },
              teachingCourseManagementStorageSchema: {
                status: "missing",
                productionDatabaseAdapterStatus: "missing",
                backupStore: "missing",
                restoreDrillLog: "missing",
              },
              teachingCourseAssetsStorageSchema: {
                status: "missing",
                productionDatabaseAdapterStatus: "missing",
                backupStore: "missing",
                restoreDrillLog: "missing",
              },
              redaction: "missing",
              leakedEndpoint: "https://private-external-storage.example.test",
              leakedToken: "secret-external-storage-token",
            },
          },
          safeNextActions: [
            "confirm-approved-remote-https-external-storage-service",
            "bind-server-only-external-storage-env-through-s19-vercel-env-sync",
            "run-approved-external-storage-persistence-read-after-restart-smoke",
            "run-external-storage-service-readiness-after-env-sync-launch-and-persistence-evidence",
          ],
          forbiddenUntilApproved: [
            "inspect-or-print-external-storage-secret-values",
            "run-live-external-storage-service-readiness",
            "run-live-external-storage-smoke",
          ],
        },
      ],
      leakedEnvAssignment: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-external-storage-token",
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "external-storage-production-service",
          rank: 3,
          category: "owner-decision",
          releaseGateRequirementIds: [
            "external-storage-service-readiness",
            "external-durable-storage-smoke",
            "external-storage-service-consistency",
          ],
          enterpriseAuditMissingTargets: [
            "external-storage-persistence",
            "external-storage-service-readiness",
            "external-storage-smoke",
          ],
          nextOwnerQuestion: "Confirm the approved remote HTTPS external-storage service and server-only env source.",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/external-storage-owner-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-owner-action-packet",
        status: "owner-decision-needed",
        releaseGateStatus: "blocked",
        responsibleSession: "S22",
        decisionId: "external-storage-production-service",
        queueRank: 3,
        classification: "owner-env-service-live-smoke-blocked",
        ownerDecisionNeeded: "provision-approved-remote-https-external-storage-service-and-env",
        requiredServiceClass: "approved-remote-https-external-storage-service",
        requiredEnvNames: [
          "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
          "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
          "UAIS_TEACHING_OPERATIONS_BACKEND",
          "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
          "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
          "UAIS_EXTERNAL_STORAGE_BASE_URL",
          "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
          "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
          "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
          "UAIS_EXTERNAL_STORAGE_DATA_DIR",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
          "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
        ],
        requiredEvidence: [
          "approved-remote-https-external-storage-service",
          "vercel-env-sync-evidence-with-external-storage-env-present",
          "external-storage-production-launch-contract",
          "external-storage-persistence-read-after-restart-proof",
          "external-storage-service-readiness-production-live-ready",
          "external-storage-smoke-live-passed",
          "same-release-run-id-bound-to-external-storage-readiness-and-smoke",
        ],
        currentEvidenceSummary: {
          containerBuildReadinessStatus: "ready",
          localImageBuild: "passed",
          externalStorageReadinessStatus: "dry-run-blocked",
          evidenceEnvironment: "production",
          healthStatus: "missing",
          healthTarget: "missing",
          productionServiceIdentity: "missing",
          apiContractVersion: "missing",
          cacheControl: "missing",
          durableBackingStore: "missing",
          teachingOperationsSchemaStatus: "missing",
          teachingCourseManagementSchemaStatus: "missing",
          teachingCourseAssetsSchemaStatus: "missing",
          vercelEnvSyncStatus: "missing",
        },
        releaseGateRequirementIds: [
          "external-storage-service-readiness",
          "external-durable-storage-smoke",
          "external-storage-service-consistency",
        ],
        enterpriseAuditMissingTargets: [
          "external-storage-persistence",
          "external-storage-service-readiness",
          "external-storage-smoke",
        ],
        commands: expect.objectContaining({
          vercelEnvSyncDryRun: "node scripts/vercel-env-sync.mjs --dry-run --scope external-storage --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <external-storage-vercel-env-sync-dry-run-evidence>",
          vercelEnvSyncApply: "node scripts/vercel-env-sync.mjs --apply --approved --scope external-storage --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <external-storage-vercel-env-sync-evidence>",
          externalStorageReadinessLive: "node scripts/external-storage-service-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <external-storage-vercel-env-sync-evidence> --external-storage-production-launch-contract <external-storage-production-launch-contract-evidence> --external-storage-persistence <external-storage-persistence-evidence> > <external-storage-service-readiness-evidence>",
          externalStorageSmokeLive: "node scripts/external-storage-smoke.mjs --live --approved --environment production --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --release-run-id <release-run-id> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <external-storage-smoke-evidence>",
        }),
        safety: {
          sourcePathsOmitted: true,
          endpointValuesOmitted: true,
          valuesRedacted: true,
          envValuesOmitted: true,
          liveMutationPerformed: false,
          deploymentMutationPerformed: false,
          remoteWritePerformed: false,
          responseBodiesOmitted: true,
        },
      }),
    );
    expect(body.stopConditions).toEqual(
      expect.arrayContaining([
        "Stop if owner has not confirmed the approved remote HTTPS external-storage service and env source.",
        "Stop if approved env source is unavailable to S19.",
        "Stop if production launch contract or persistence evidence is missing.",
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-external-storage.example.test");
    expect(output).not.toContain("secret-external-storage-token");
    expect(output).not.toContain("registry.example.test/private");
    expect(output).not.toContain("UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret");
  });

  it("renders a markdown external storage owner packet for handoff", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-owner-packet-md-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "external-storage-production-service",
          status: "owner-decision-needed",
          blockedReasons: ["external-storage-service-readiness-not-live-ready"],
          containerBuildReadinessSummary: {
            evidenceStatus: "ready",
            localImageBuild: "passed",
          },
          externalStorageServiceReadinessSummary: {
            evidenceStatus: "dry-run-blocked",
            evidenceEnvironment: "production",
            health: {
              status: "missing",
              target: "missing",
              productionServiceIdentity: "missing",
              apiContractVersion: "missing",
              cacheControl: "missing",
              durableBackingStore: "missing",
              teachingOperationsStorageSchema: { status: "missing" },
              teachingCourseManagementStorageSchema: { status: "missing" },
              teachingCourseAssetsStorageSchema: { status: "missing" },
            },
          },
          safeNextActions: ["confirm-approved-remote-https-external-storage-service"],
          forbiddenUntilApproved: ["inspect-or-print-external-storage-secret-values"],
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "external-storage-production-service",
          rank: 3,
          nextOwnerQuestion: "Confirm the approved remote HTTPS external-storage service and server-only env source.",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/external-storage-owner-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS External Storage Owner Action Packet");
    expect(output).toContain("Status: `owner-decision-needed`");
    expect(output).toContain("Queue rank: 3");
    expect(output).toContain("`UAIS_EXTERNAL_STORAGE_BASE_URL`");
    expect(output).toContain("`UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY`");
    expect(output).toContain("Do not inspect, print, or copy endpoint, credential, token, data-dir, or response-body values.");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(tmpDir: string, filename: string, body: unknown) {
  const filePath = join(tmpDir, filename);
  writeFileSync(filePath, JSON.stringify(body, null, 2));
  return filePath;
}
