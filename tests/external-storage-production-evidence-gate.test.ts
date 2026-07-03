import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const releaseRunId = "UAIS-enterprise-run-2026-07-XX";
const serviceLabel = "UAIS-approved-remote-HTTPS-external-storage-service";
const envSourceLabel = "UAIS-production-external-storage-env-source";
const smokeTeacherIdLabel = "UAIS-production-external-storage-smoke-teacher";
const serviceFingerprint = "sha256:external-storage-service-fingerprint";

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

const readinessResults = {
  externalStorageEndpointRemoteHttps: "passed",
  externalStorageHealthContract: "passed",
  externalStorageOrdinaryTeachingSchemas: "passed",
  externalStorageTeachingOperationsSchema: "passed",
  externalStorageTeachingCourseManagementSchema: "passed",
  externalStorageTeachingCourseAssetsSchema: "passed",
  externalStorageVercelEnvSync: "passed",
  externalStorageProductionLaunchContract: "passed",
  externalStoragePersistenceEvidence: "passed",
  externalStorageReadinessSafety: "passed",
};

describe("external storage production evidence gate", () => {
  it("waits for upstream auth/env-sync and live storage evidence without leaking source paths", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-production-gate-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "external-storage-production-evidence-preflight",
      status: "external-storage-production-evidence-preflight-waiting-for-upstream-auth",
      approvedServiceClass: "approved-remote-https-external-storage-service",
      approvedRemoteHttpsExternalStorageServiceLabel: serviceLabel,
      approvedServerOnlyEnvSourceLabel: envSourceLabel,
      approvedReleaseRunIdLabel: releaseRunId,
      approvedSmokeTeacherIdLabel: smokeTeacherIdLabel,
      summary: {
        upstreamAuthEvidenceCleared: false,
        liveSmokeStillForbidden: true,
        releaseReady: false,
      },
    });
    const envSyncGatePath = writeJson(reportsDir, "env-sync-gate.json", {
      target: "external-storage-vercel-env-sync-evidence-gate",
      status: "external-storage-vercel-env-sync-evidence-gate-waiting-for-upstream-auth",
      approvedServiceClass: "approved-remote-https-external-storage-service",
      approvedReleaseRunIdLabel: releaseRunId,
      summary: {
        operatorInputRequired: true,
        blockingInputRequired: true,
        upstreamAuthEvidenceCleared: false,
        externalStoragePreflightReady: false,
        applyEvidenceAccepted: false,
        externalStorageReadinessMayProceed: false,
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
      "scripts/external-storage-production-evidence-gate.mjs",
      "--external-storage-preflight",
      preflightPath,
      "--external-storage-vercel-env-sync-evidence-gate",
      envSyncGatePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-production-evidence-gate",
        status: "external-storage-production-evidence-gate-waiting-for-upstream-auth",
        releaseReady: false,
        responsibleSession: "S19/S22/S24",
        approvedServiceClass: "approved-remote-https-external-storage-service",
        approvedRemoteHttpsExternalStorageServiceLabel: serviceLabel,
        approvedServerOnlyEnvSourceLabel: envSourceLabel,
        approvedReleaseRunIdLabel: releaseRunId,
        approvedSmokeTeacherIdLabel: smokeTeacherIdLabel,
        summary: {
          operatorInputRequired: true,
          blockingInputRequired: true,
          upstreamAuthEvidenceCleared: false,
          envSyncEvidenceAccepted: false,
          persistenceEvidenceProvided: false,
          persistenceEvidenceAccepted: false,
          readinessEvidenceProvided: false,
          readinessEvidenceAccepted: false,
          smokeEvidenceProvided: false,
          smokeEvidenceAccepted: false,
          releaseRunBound: false,
          externalStorageProductionEvidenceCleared: false,
          liveSmokeStillForbidden: true,
          releaseReady: false,
        },
        persistenceEvidenceStatus: {
          target: "missing",
          status: "missing",
          environment: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
        readinessEvidenceStatus: {
          target: "missing",
          status: "missing",
          mode: "missing",
          environment: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
        smokeEvidenceStatus: {
          target: "missing",
          status: "missing",
          environment: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
        blockedReasons: [
          "upstream-auth-production-evidence-not-cleared",
          "external-storage-vercel-env-sync-evidence-not-accepted",
          "external-storage-persistence-evidence-missing",
          "external-storage-service-readiness-evidence-missing",
          "external-storage-smoke-evidence-missing",
        ],
      }),
    );
    expect(body.upstreamBlockingEvidence).toEqual({
      id: "upstream-external-storage-vercel-env-sync-evidence-gate",
      label: "external-storage-vercel-env-sync-evidence-gate",
      reason:
        "External-storage production evidence must wait for accepted external-storage Vercel env-sync evidence before persistence, readiness, or smoke evidence can be requested.",
      valuesForbidden: true,
      upstreamStatus: "external-storage-vercel-env-sync-evidence-gate-waiting-for-upstream-auth",
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
      providerNetworkCallPerformed: false,
      noRemoteWritePerformed: true,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/external-storage-production-evidence-gate.mjs",
      "--external-storage-preflight",
      preflightPath,
      "--external-storage-vercel-env-sync-evidence-gate",
      envSyncGatePath,
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

  it("clears only when env-sync, persistence, readiness, smoke, and release-run binding match", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-production-gate-ready-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeUrl = "https://external-storage.example.test/api";
    const fakeSecret = "external-storage-secret-must-not-appear";
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "external-storage-production-evidence-preflight",
      status: "external-storage-production-evidence-preflight-ready",
      approvedServiceClass: "approved-remote-https-external-storage-service",
      approvedRemoteHttpsExternalStorageServiceLabel: serviceLabel,
      approvedServerOnlyEnvSourceLabel: envSourceLabel,
      approvedReleaseRunIdLabel: releaseRunId,
      approvedSmokeTeacherIdLabel: smokeTeacherIdLabel,
      summary: {
        upstreamAuthEvidenceCleared: true,
        liveSmokeStillForbidden: true,
        releaseReady: false,
      },
    });
    const envSyncGatePath = writeJson(reportsDir, "env-sync-gate.json", {
      target: "external-storage-vercel-env-sync-evidence-gate",
      status: "external-storage-vercel-env-sync-evidence-gate-apply-evidence-accepted",
      approvedServiceClass: "approved-remote-https-external-storage-service",
      approvedReleaseRunIdLabel: releaseRunId,
      summary: {
        upstreamAuthEvidenceCleared: true,
        externalStoragePreflightReady: true,
        applyEvidenceAccepted: true,
        externalStorageReadinessMayProceed: true,
        releaseReady: false,
      },
      vercelEnvSyncEvidenceStatus: {
        target: "vercel-env-sync",
        status: "matched",
        applyPreflight: "proved",
        releaseRunIdStatus: "matched",
        requiredExternalStorageEnvStatus: "present",
        serviceEndpointStatus: "remote-https",
        serviceFingerprintStatus: "present",
        databaseAdapterProofStatus: "ready",
        valueRedacted: true,
      },
    });
    const persistencePath = writeJson(reportsDir, "persistence.json", {
      target: "external-storage-persistence",
      mode: "live",
      environment: "production",
      phase: "read",
      status: "passed",
      releaseRunId,
      rawServiceUrl: fakeUrl,
      rawAccessToken: fakeSecret,
      storageEndpoint: {
        endpointClass: "remote-https",
        valueRedacted: true,
      },
      storageServiceFingerprint: {
        status: "present",
        source: "origin",
        value: serviceFingerprint,
        valueRedacted: true,
      },
      results: [
        { id: "s22-external-storage-persistence-health", status: "ok" },
        { id: "s22-external-storage-persisted-ownership-read", status: "ok" },
        { id: "s24-external-storage-persisted-audit-read", status: "ok" },
      ],
      safety: {
        secretsRedacted: true,
        serviceUrlOmitted: true,
        teacherIdOmitted: true,
        proofIdOmitted: true,
        responseBodiesOmitted: true,
        localPrivatePathsOmitted: true,
      },
    });
    const readinessPath = writeJson(reportsDir, "readiness.json", {
      target: "external-storage-service-readiness",
      mode: "live",
      environment: "production",
      status: "ready",
      releaseRunId,
      rawServiceUrl: fakeUrl,
      rawAccessToken: fakeSecret,
      storageEndpoint: {
        endpointClass: "remote-https",
        valueRedacted: true,
      },
      storageServiceFingerprint: {
        status: "present",
        source: "origin",
        value: serviceFingerprint,
        valueRedacted: true,
      },
      results: readinessResults,
      vercelEnvSyncEvidence: {
        target: "vercel-env-sync",
        status: "matched",
        applyPreflight: "proved",
        releaseRunIdStatus: "matched",
        valueRedacted: true,
      },
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
      persistenceEvidence: {
        target: "external-storage-persistence",
        status: "matched",
        releaseRunIdStatus: "matched",
        valueRedacted: true,
      },
      safety: {
        valuesRedacted: true,
        serviceUrlOmitted: true,
        responseBodiesOmitted: true,
        localPrivatePathsOmitted: true,
        cookieValuesOmitted: true,
        liveRequiresApproval: true,
        remoteMutationRequiresApproval: true,
        noWriteOperations: true,
      },
    });
    const smokePath = writeJson(reportsDir, "smoke.json", {
      target: "external-storage-smoke",
      mode: "live",
      environment: "production",
      status: "passed",
      releaseRunId,
      rawServiceUrl: fakeUrl,
      rawAccessToken: fakeSecret,
      storageEndpoint: {
        endpointClass: "remote-https",
        valueRedacted: true,
      },
      storageServiceFingerprint: {
        status: "present",
        source: "origin",
        value: serviceFingerprint,
        valueRedacted: true,
      },
      externalStorageServiceReadinessEvidence: {
        target: "external-storage-service-readiness",
        status: "matched",
        releaseRunIdStatus: "matched",
        valueRedacted: true,
      },
      results: [
        { id: "s22-external-storage-health", status: "ok" },
        { id: "s22-external-storage-teaching-operations", status: "ok" },
        { id: "s22-external-storage-course-management", status: "ok" },
        { id: "s24-external-storage-course-assets", status: "ok" },
      ],
      safety: {
        secretsRedacted: true,
        serviceUrlOmitted: true,
        teacherIdOmitted: true,
        responseBodiesOmitted: true,
        localPrivatePathsOmitted: true,
        noCredentialValuesEmitted: true,
      },
    });

    const output = execFileSync("node", [
      "scripts/external-storage-production-evidence-gate.mjs",
      "--external-storage-preflight",
      preflightPath,
      "--external-storage-vercel-env-sync-evidence-gate",
      envSyncGatePath,
      "--external-storage-persistence",
      persistencePath,
      "--external-storage-service-readiness",
      readinessPath,
      "--external-storage-smoke",
      smokePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("external-storage-production-evidence-gate-cleared");
    expect(body.releaseReady).toBe(false);
    expect(body.summary).toEqual({
      operatorInputRequired: false,
      blockingInputRequired: false,
      upstreamAuthEvidenceCleared: true,
      envSyncEvidenceAccepted: true,
      persistenceEvidenceProvided: true,
      persistenceEvidenceAccepted: true,
      readinessEvidenceProvided: true,
      readinessEvidenceAccepted: true,
      smokeEvidenceProvided: true,
      smokeEvidenceAccepted: true,
      releaseRunBound: true,
      externalStorageProductionEvidenceCleared: true,
      liveSmokeStillForbidden: true,
      releaseReady: false,
    });
    expect(body.persistenceEvidenceStatus).toEqual({
      target: "external-storage-persistence",
      status: "matched",
      environment: "production",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    });
    expect(body.readinessEvidenceStatus).toEqual({
      target: "external-storage-service-readiness",
      status: "live-ready",
      mode: "live",
      environment: "production",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    });
    expect(body.smokeEvidenceStatus).toEqual({
      target: "external-storage-smoke",
      status: "live-passed",
      environment: "production",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    });
    expect(body.provedEvidence).toEqual([
      "vercel-env-sync-evidence-with-external-storage-env-present",
      "external-storage-persistence-read-after-restart-proof",
      "external-storage-service-readiness-production-live-ready",
      "external-storage-smoke-live-passed",
      "same-release-run-id-bound-to-external-storage-readiness-and-smoke",
    ]);
    expect(body.safeNextAction).toBe("advance-vercel-env-deploy-production-evidence-preflight");
    expect(output).not.toContain(fakeUrl);
    expect(output).not.toContain(fakeSecret);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}
