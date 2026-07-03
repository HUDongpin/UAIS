import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("external storage production evidence preflight", () => {
  it("turns an accepted remote HTTPS service response into a redacted evidence preflight waiting on auth", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-evidence-preflight-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      target: "owner-decision-external-storage-response-validation",
      status: "owner-response-accepted",
      summary: {
        serviceClassAccepted: true,
        s19DryRunMayProceed: true,
        s22ReadinessMayProceed: true,
        liveSmokeStillForbidden: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: [
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
      redactedOwnerResponse: {
        ownerApprovedServiceClass: "approved-remote-https-external-storage-service",
        approvedRemoteHttpsExternalStorageServiceLabel:
          "UAIS-approved-remote-HTTPS-external-storage-service",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-external-storage-env-source",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
        approvedSmokeTeacherIdLabel: "UAIS-approved-smoke-teacher-label",
      },
      postValidationAllowedChecks: [
        "prepare-s19-external-storage-env-sync-dry-run-after-auth-clears",
        "prepare-external-storage-readiness-command-after-env-sync-launch-and-persistence-evidence",
        "prepare-external-storage-smoke-command-after-service-readiness",
      ],
      stillForbiddenUntilSeparateApproval: [
        "run-live-external-storage-service-readiness",
        "run-live-external-storage-smoke",
      ],
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      target: "owner-decision-live-run-approval-gate",
      status: "approval-gate-blocked",
      stages: [
        {
          id: "app-auth-provider-production-selector",
          currentStatus: "accepted-awaiting-production-evidence",
          ownerResponseAccepted: true,
        },
        {
          id: "teacher-auth-provider-production-selector",
          currentStatus: "accepted-awaiting-production-evidence",
          ownerResponseAccepted: true,
        },
        {
          id: "external-storage-production-service",
          queueStatus: "accepted",
          currentStatus: "accepted-awaiting-production-evidence",
          ownerResponseAccepted: true,
          requiredEvidence: [
            "approved-remote-https-external-storage-service",
            "vercel-env-sync-evidence-with-external-storage-env-present",
            "external-storage-production-launch-contract",
            "external-storage-persistence-read-after-restart-proof",
            "external-storage-service-readiness-production-live-ready",
            "external-storage-smoke-live-passed",
            "same-release-run-id-bound-to-external-storage-readiness-and-smoke",
          ],
        },
      ],
    });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {
      target: "external-storage-owner-action-packet",
      decisionId: "external-storage-production-service",
      requiredEnvNames: [
        "UAIS_EXTERNAL_STORAGE_BASE_URL",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
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
      commands: {
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope external-storage --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <external-storage-vercel-env-sync-dry-run-evidence>",
        externalStorageReadinessLive:
          "node scripts/external-storage-service-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <external-storage-vercel-env-sync-evidence> --external-storage-production-launch-contract <external-storage-production-launch-contract-evidence> --external-storage-persistence <external-storage-persistence-evidence> > <external-storage-service-readiness-evidence>",
        externalStorageSmokeLive:
          "node scripts/external-storage-smoke.mjs --live --approved --environment production --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --release-run-id <release-run-id> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <external-storage-smoke-evidence>",
      },
      forbiddenUntilApproved: ["run-live-external-storage-smoke"],
      safeNextActions: ["bind-server-only-external-storage-env-through-s19-vercel-env-sync"],
    });
    const appAuthPreflight = writeJson(tmpDir, "app-auth-preflight.json", {
      status: "app-auth-production-evidence-preflight-ready",
      releaseReady: false,
      summary: { missingEvidenceCount: 3 },
    });
    const teacherAuthPreflight = writeJson(tmpDir, "teacher-auth-preflight.json", {
      status: "teacher-auth-production-evidence-preflight-waiting-for-upstream-app-auth",
      releaseReady: false,
      summary: { missingEvidenceCount: 4 },
    });
    const productionLaunchContract = writeJson(tmpDir, "launch-contract.json", {
      target: "external-storage-service-production-launcher",
      status: "ready",
      safety: {
        accessTokenOmitted: true,
        startupOutputRedacted: true,
      },
    });

    const output = execFileSync("node", [
      "scripts/external-storage-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--external-storage-action-packet",
      actionPacket,
      "--app-auth-preflight",
      appAuthPreflight,
      "--teacher-auth-preflight",
      teacherAuthPreflight,
      "--production-launch-contract",
      productionLaunchContract,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-production-evidence-preflight",
        status: "external-storage-production-evidence-preflight-waiting-for-upstream-auth",
        releaseReady: false,
        ownerDecisionId: "external-storage-production-service",
        approvedServiceClass: "approved-remote-https-external-storage-service",
      }),
    );
    expect(body.summary).toEqual({
      ownerResponseAccepted: true,
      externalStorageStageAcceptedAwaitingEvidence: true,
      upstreamAuthEvidenceCleared: false,
      s19DryRunMayProceedAfterAuthClears: true,
      s22ReadinessMayProceedAfterEnvSyncLaunchAndPersistenceEvidence: true,
      smokeMayProceedAfterServiceReadiness: true,
      liveSmokeStillForbidden: true,
      requiredServerOnlyEnvNameCount: 14,
      requiredEvidenceCount: 7,
      missingEvidenceCount: 5,
      commandTemplateCount: 4,
      releaseReady: false,
    });
    expect(body.provedPrerequisiteEvidence).toEqual([
      "approved-remote-https-external-storage-service",
      "external-storage-production-launch-contract",
    ]);
    expect(body.missingEvidence).toEqual([
      "vercel-env-sync-evidence-with-external-storage-env-present",
      "external-storage-persistence-read-after-restart-proof",
      "external-storage-service-readiness-production-live-ready",
      "external-storage-smoke-live-passed",
      "same-release-run-id-bound-to-external-storage-readiness-and-smoke",
    ]);
    expect(body.blockedReasons).toEqual([
      "upstream-auth-production-evidence-not-cleared",
      "vercel-env-sync-evidence-with-external-storage-env-present-missing",
      "external-storage-persistence-read-after-restart-proof-missing",
      "external-storage-service-readiness-production-live-ready-missing",
      "external-storage-smoke-live-passed-missing",
      "same-release-run-id-bound-to-external-storage-readiness-and-smoke-missing",
    ]);
    expect(body.safeCommandTemplates).toEqual(
      expect.objectContaining({
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope external-storage --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <external-storage-vercel-env-sync-dry-run-evidence>",
        externalStoragePersistence:
          "node scripts/external-storage-persistence-smoke.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> > <external-storage-persistence-evidence>",
      }),
    );
    expect(body.safety).toEqual(
      expect.objectContaining({
        envFileRead: false,
        endpointValuesOmitted: true,
        credentialValuesOmitted: true,
        noRemoteWritePerformed: true,
        noLiveMutationPerformed: true,
        noEnvApplyPerformed: true,
      }),
    );

    const markdown = execFileSync("node", [
      "scripts/external-storage-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--external-storage-action-packet",
      actionPacket,
      "--app-auth-preflight",
      appAuthPreflight,
      "--teacher-auth-preflight",
      teacherAuthPreflight,
      "--production-launch-contract",
      productionLaunchContract,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("# UAIS External Storage Production Evidence Preflight");
    expect(markdown).toContain(
      "Status: `external-storage-production-evidence-preflight-waiting-for-upstream-auth`",
    );
    expect(markdown).toContain("## Safe Command Templates");
    expect(markdown).not.toContain("UAIS-approved-remote-HTTPS-external-storage-service");
    expect(markdown).not.toContain("UAIS-production-external-storage-env-source");
    expect(markdown).not.toContain("UAIS-enterprise-run-2026-07-XX");
    expect(markdown).not.toContain("UAIS-approved-smoke-teacher-label");
    expect(markdown).not.toContain("https://");
  });

  it("stays blocked when the owner response is incomplete", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-evidence-blocked-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      status: "owner-response-incomplete",
      summary: {
        serviceClassAccepted: false,
        s19DryRunMayProceed: false,
        s22ReadinessMayProceed: false,
      },
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", { stages: [] });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {});

    const output = execFileSync("node", [
      "scripts/external-storage-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--external-storage-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("external-storage-production-evidence-preflight-blocked");
    expect(body.blockedReasons).toContain("external-storage-owner-response-not-accepted");
    expect(body.blockedReasons).toContain(
      "external-storage-stage-not-accepted-awaiting-production-evidence",
    );
    expect(body.summary.releaseReady).toBe(false);
  });
});

function writeJson(dir: string, name: string, value: unknown) {
  const filePath = join(dir, name);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}
