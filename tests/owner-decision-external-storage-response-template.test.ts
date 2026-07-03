import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision external storage response template", () => {
  it("builds a queued redacted owner response template for the external-storage owner decision", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-response-template-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "external-storage-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-external-storage-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--external-storage-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-external-storage-response-template",
        status: "queued-awaiting-upstream-auth-decisions",
        decisionId: "external-storage-production-service",
        responsibleSession: "S22/S19/S10",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        queueRank: 3,
        queueStatus: "owner-decision-needed",
        actionPacketStatus: "owner-decision-needed",
        upstreamBlockedDecisionCount: 2,
        requiredServerOnlyEnvNameCount: 14,
        releaseReady: false,
      }),
    );
    expect(body.upstreamBlockedDecisionIds).toEqual([
      "app-auth-provider-production-selector",
      "teacher-auth-provider-production-selector",
    ]);
    expect(body.ownerResponseTemplate).toEqual(
      expect.objectContaining({
        responseStatus: "owner-response-required",
        decisionId: "external-storage-production-service",
        ownerApprovedServiceClass: null,
        requiredServiceClass: "approved-remote-https-external-storage-service",
        approvedRemoteHttpsExternalStorageServiceLabel: null,
        approvedServerOnlyEnvSourceLabel: null,
        approvedReleaseRunIdLabel: null,
        approvedSmokeTeacherIdLabel: null,
        confirmsNoCredentialValuesInResponse: false,
        confirmsRemoteHttpsServiceApproved: false,
      }),
    );
    expect(body.ownerResponseTemplate.requiredServerOnlyEnvNames).toHaveLength(14);
    expect(body.copySafeOwnerReplyStub).toEqual({
      responseStatus: "owner-response-provided",
      decisionId: "external-storage-production-service",
      ownerApprovedServiceClass: "approved-remote-https-external-storage-service",
      approvedRemoteHttpsExternalStorageServiceLabel: "<label only; no endpoint URL or credential values>",
      approvedServerOnlyEnvSourceLabel: "<label only; no credential values>",
      approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
      approvedSmokeTeacherIdLabel: "<label only; no personal data>",
      confirmsNoCredentialValuesInResponse: true,
      confirmsRemoteHttpsServiceApproved: true,
      confirmsS19MayPrepareExternalStorageEnvSyncDryRun: true,
      confirmsS22MayPrepareExternalStorageReadinessAfterEnvSyncEvidence: true,
      confirmsExternalStorageLiveSmokeRequiresSeparateApproval: true,
    });
    expect(body.ownerResponseValidationCommand).toBe(
      "node scripts/owner-decision-external-storage-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(body.postResponseAllowedChecks).toEqual([
      "validate-owner-response-shape",
      "confirm-no-credential-values-or-endpoints-in-owner-response",
      "prepare-s19-external-storage-env-sync-dry-run-after-auth-clears",
      "prepare-external-storage-readiness-command-after-env-sync-launch-and-persistence-evidence",
      "prepare-external-storage-smoke-command-after-service-readiness",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain("run-live-external-storage-smoke");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-storage.example.test");
    expect(output).not.toContain("UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret");
  });

  it("reports missing when the external-storage decision is not present in the owner queue", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-response-template-missing-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", {
      status: "owner-decisions-required",
      queue: [
        {
          rank: 1,
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
        },
      ],
    });
    const actionPacket = writeJson(tmpDir, "external-storage-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-external-storage-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--external-storage-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("decision-not-in-owner-queue");
    expect(body.ownerResponseTemplate).toBeNull();
    expect(body.summary.queueRank).toBeNull();
  });

  it("renders markdown without source paths, raw endpoints, or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-response-template-md-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "external-storage-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-external-storage-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--external-storage-action-packet",
      actionPacket,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS External Storage Owner Response Template");
    expect(output).toContain("Status: `queued-awaiting-upstream-auth-decisions`");
    expect(output).toContain("Do not include credential values or endpoint URLs.");
    expect(output).toContain("## Copy-Safe Owner Reply Stub");
    expect(output).toContain(
      '"approvedRemoteHttpsExternalStorageServiceLabel": "<label only; no endpoint URL or credential values>"',
    );
    expect(output).toContain("## Validation Command");
    expect(output).toContain(
      "node scripts/owner-decision-external-storage-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(output).toContain("`approved-remote-https-external-storage-service`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-storage.example.test");
  });
});

function buildQueue() {
  return {
    status: "owner-decisions-required",
    queue: [
      {
        rank: 1,
        id: "app-auth-provider-production-selector",
        status: "owner-decision-needed",
      },
      {
        rank: 2,
        id: "teacher-auth-provider-production-selector",
        status: "owner-decision-needed",
      },
      {
        rank: 3,
        id: "external-storage-production-service",
        status: "owner-decision-needed",
        category: "owner-decision",
        nextOwnerQuestion:
          "Confirm the approved remote HTTPS external-storage service and server-only env source.",
      },
    ],
    leakedPath: "/Users/example/private/queue.json",
  };
}

function buildActionPacket() {
  return {
    target: "external-storage-owner-action-packet",
    status: "owner-decision-needed",
    decisionId: "external-storage-production-service",
    queueRank: 3,
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
    forbiddenUntilApproved: [
      "inspect-or-print-external-storage-secret-values",
      "run-live-external-storage-service-readiness",
      "run-live-external-storage-smoke",
      "run-production-smokes-dependent-on-external-storage",
    ],
    currentEvidenceSummary: {
      externalStorageReadinessStatus: "dry-run-blocked",
      healthTarget: "missing",
      productionServiceIdentity: "missing",
      vercelEnvSyncStatus: "missing",
    },
    leakedUrl: "https://private-storage.example.test",
    leakedEnv: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret",
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
