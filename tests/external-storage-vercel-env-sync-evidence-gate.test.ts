import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const requiredExternalStorageEnvNames = [
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
];
const upstreamOperatorInputPacket = {
  target: "app-auth-env-source-intake-operator-input",
  status: "operator-approved-source-required",
  firstRequiredInputId: "approved-env-source-path",
  approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
  acceptedInputModes: ["approved-source-handle", "approved-env-file-presence"],
  requiredServerOnlyEnvNames: [
    "UAIS_APP_SESSION_SIGNING_SECRET",
    "UAIS_APP_AUTH_PROVIDER",
    "UAIS_APP_AUTH_PROVIDER_URL",
    "UAIS_APP_AUTH_PROVIDER_TOKEN",
  ],
  nextSafeAction: "provide-approved-env-source-path-to-s19",
  nextSafeCommandTemplateKey: "approvedSourceHandleIntake",
  valuesForbidden: true,
};

describe("external storage vercel env sync evidence gate", () => {
  it("waits for upstream auth evidence before external-storage env sync can be accepted", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-vercel-env-gate-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const preflightPath = writeJson(reportsDir, "external-storage-preflight.json", {
      target: "external-storage-production-evidence-preflight",
      status: "external-storage-production-evidence-preflight-waiting-for-upstream-auth",
      approvedServiceClass: "approved-remote-https-external-storage-service",
      approvedRemoteHttpsExternalStorageServiceLabel:
        "UAIS-approved-remote-HTTPS-external-storage-service",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-external-storage-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      approvedSmokeTeacherIdLabel: "UAIS-approved-smoke-teacher-label",
      summary: {
        upstreamAuthEvidenceCleared: false,
        s19DryRunMayProceedAfterAuthClears: true,
        s22ReadinessMayProceedAfterEnvSyncLaunchAndPersistenceEvidence: true,
        liveSmokeStillForbidden: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: requiredExternalStorageEnvNames,
    });
    const envSourceIntakePath = writeJson(reportsDir, "external-storage-env-source-intake.json", {
      target: "external-storage-env-source-intake",
      status: "external-storage-env-source-intake-waiting-for-upstream-auth",
      summary: {
        operatorInputRequired: true,
        blockingInputRequired: true,
        upstreamEvidenceRequired: true,
        releaseReady: false,
      },
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamBlockingEvidence: {
        id: "upstream-auth-production-evidence",
        safeNextAction: "provide-approved-env-source-path-to-s19",
        upstreamMissingEvidence: ["approved-env-source-path"],
        upstreamOperatorInputPacket,
        upstreamSafeCommandTemplates: {
          approvedSourceHandleIntake:
            "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
        },
      },
      sourceEvidenceHandle: "/Users/private/approved-app-auth.env",
    });

    const output = execFileSync("node", [
      "scripts/external-storage-vercel-env-sync-evidence-gate.mjs",
      "--external-storage-preflight",
      preflightPath,
      "--external-storage-env-source-intake",
      envSourceIntakePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-vercel-env-sync-evidence-gate",
        status: "external-storage-vercel-env-sync-evidence-gate-waiting-for-upstream-auth",
        releaseReady: false,
        responsibleSession: "S19/S22",
        approvedServiceClass: "approved-remote-https-external-storage-service",
        approvedRemoteHttpsExternalStorageServiceLabel:
          "UAIS-approved-remote-HTTPS-external-storage-service",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-external-storage-env-source",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
        summary: {
          ownerInputRequired: false,
          operatorInputRequired: true,
          blockingInputRequired: true,
          upstreamProductionEvidenceRequired: true,
          upstreamAuthEvidenceCleared: false,
          externalStoragePreflightReady: false,
          vercelEnvSyncEvidenceProvided: false,
          applyEvidenceAccepted: false,
          externalStorageEnvPresent: false,
          externalStorageReadinessMayProceed: false,
          releaseReady: false,
        },
        vercelEnvSyncEvidenceStatus: {
          target: "missing",
          status: "missing",
          applyPreflight: "missing",
          releaseRunIdStatus: "missing",
          requiredExternalStorageEnvStatus: "missing",
          serviceEndpointStatus: "missing",
          serviceFingerprintStatus: "missing",
          databaseAdapterProofStatus: "missing",
          valueRedacted: true,
        },
        blockedReasons: [
          "upstream-auth-production-evidence-not-cleared",
        ],
      }),
    );
    expect(body.upstreamBlockingEvidence).toEqual({
      id: "upstream-auth-production-evidence",
      label: "app-auth-and-teacher-auth-production-evidence",
      reason:
        "External-storage Vercel env-sync evidence must wait for app-auth and teacher-auth production evidence before S19 runs or accepts external-storage env-sync evidence.",
      valuesForbidden: true,
      upstreamStatus: "external-storage-production-evidence-preflight-waiting-for-upstream-auth",
      upstreamBlockedReasons: ["upstream-auth-production-evidence-not-cleared"],
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamOperatorInputRequired: true,
      upstreamMissingEvidence: ["approved-env-source-path"],
      upstreamOperatorInputPacket,
      upstreamSafeCommandTemplates: {
        approvedSourceHandleIntake:
          "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
      },
    });
    expect(body.safeNextAction).toBe("provide-approved-env-source-path-to-s19");
    expect(body.safety).toEqual({
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      endpointValuesOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      noRemoteWritePerformed: true,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/external-storage-vercel-env-sync-evidence-gate.mjs",
      "--external-storage-preflight",
      preflightPath,
      "--external-storage-env-source-intake",
      envSourceIntakePath,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("Operator input required: `true`");
    expect(markdown).toContain("Safe next action: `provide-approved-env-source-path-to-s19`");
    expect(markdown).toContain("## Upstream Operator Input Packet");
    expect(markdown).toContain("- First required input: `approved-env-source-path`");
    expect(markdown).toContain("- Next command template: `approvedSourceHandleIntake`");
    expect(markdown).toContain("## Upstream Safe Operator Command Templates");
    expect(markdown).toContain(
      "`approvedSourceHandleIntake`: `node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle>",
    );
    expect(markdown).not.toContain(tmpDir);
    expect(markdown).not.toContain("/Users/");
  });

  it("accepts only redacted apply evidence with external-storage env present and release-run binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-vercel-env-gate-apply-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeUrl = "https://storage.example.test/uais";
    const fakeSecret = "external-storage-token-that-must-not-appear";
    const releaseRunId = "UAIS-enterprise-run-2026-07-XX";
    const preflightPath = writeJson(reportsDir, "external-storage-preflight.json", {
      target: "external-storage-production-evidence-preflight",
      status: "external-storage-production-evidence-preflight-ready",
      approvedServiceClass: "approved-remote-https-external-storage-service",
      approvedRemoteHttpsExternalStorageServiceLabel:
        "UAIS-approved-remote-HTTPS-external-storage-service",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-external-storage-env-source",
      approvedReleaseRunIdLabel: releaseRunId,
      approvedSmokeTeacherIdLabel: "UAIS-approved-smoke-teacher-label",
      summary: {
        upstreamAuthEvidenceCleared: true,
        s19DryRunMayProceedAfterAuthClears: true,
        s22ReadinessMayProceedAfterEnvSyncLaunchAndPersistenceEvidence: true,
        liveSmokeStillForbidden: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: requiredExternalStorageEnvNames,
    });
    const vercelEnvSyncPath = writeJson(reportsDir, "external-storage-vercel-env-sync.json", {
      target: "vercel-env-sync",
      mode: "apply",
      deploymentScope: "external-storage",
      projectReadinessEvidenceStatus: "ready",
      releaseRunId,
      approvedRemoteHttpsExternalStorageServiceLabel:
        "UAIS-approved-remote-HTTPS-external-storage-service",
      rawEndpoint: fakeUrl,
      rawAccessToken: fakeSecret,
      targets: ["production", "preview"],
      externalStorageEndpoint: {
        endpointClass: "remote-https",
        valueRedacted: true,
      },
      externalStorageServiceFingerprint: {
        status: "present",
        source: "origin",
        value: "sha256:external-storage-service-fingerprint",
        valueRedacted: true,
      },
      externalStorageDatabaseAdapterProof: {
        status: "ready",
        providerClassStatus: "present",
        migrationStatus: "ready",
        backupPolicyStatus: "ready",
        concurrencyControlStatus: "ready",
        valuesRedacted: true,
      },
      entries: requiredExternalStorageEnvNames.map((name) => ({
        name,
        status: "present",
        valueRedacted: true,
      })),
      applyPreflight: {
        status: "passed",
        blockedReasons: [],
        valuesRedacted: true,
        cliSafeToInvoke: true,
      },
      applySummary: {
        status: "applied",
        appliedActions: 28,
        appliedByTarget: { production: 14, preview: 14 },
        localOnlyEntriesSkipped: 0,
        valuesRedacted: true,
        apiOutputOmitted: true,
      },
    });

    const output = execFileSync("node", [
      "scripts/external-storage-vercel-env-sync-evidence-gate.mjs",
      "--external-storage-preflight",
      preflightPath,
      "--vercel-env-sync",
      vercelEnvSyncPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe(
      "external-storage-vercel-env-sync-evidence-gate-apply-evidence-accepted",
    );
    expect(body.releaseReady).toBe(false);
    expect(body.summary).toEqual({
      ownerInputRequired: false,
      operatorInputRequired: false,
      blockingInputRequired: false,
      upstreamProductionEvidenceRequired: false,
      upstreamAuthEvidenceCleared: true,
      externalStoragePreflightReady: true,
      vercelEnvSyncEvidenceProvided: true,
      applyEvidenceAccepted: true,
      externalStorageEnvPresent: true,
      externalStorageReadinessMayProceed: true,
      releaseReady: false,
    });
    expect(body.upstreamBlockingEvidence).toBeNull();
    expect(body.vercelEnvSyncEvidenceStatus).toEqual({
      target: "vercel-env-sync",
      status: "matched",
      applyPreflight: "proved",
      releaseRunIdStatus: "matched",
      requiredExternalStorageEnvStatus: "present",
      serviceEndpointStatus: "remote-https",
      serviceFingerprintStatus: "present",
      databaseAdapterProofStatus: "ready",
      valueRedacted: true,
    });
    expect(body.safeNextAction).toBe(
      "run-s22-external-storage-readiness-after-accepted-env-sync-launch-and-persistence-evidence",
    );
    expect(output).not.toContain(fakeUrl);
    expect(output).not.toContain(fakeSecret);
    expect(output).not.toContain(vercelEnvSyncPath);
  });
});

function writeJson(dir: string, name: string, value: unknown) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}
