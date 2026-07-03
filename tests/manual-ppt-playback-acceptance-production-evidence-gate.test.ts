import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const releaseRunId = "UAIS-enterprise-run-2026-07-XX";
const deploymentFingerprint = "sha256:manual-ppt-vercel-deployment-fingerprint";
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

describe("manual PPT playback acceptance production evidence gate", () => {
  it("keeps accepted human playback waiting for production deployment binding evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-production-gate-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "manual-ppt-playback-acceptance-production-evidence-preflight",
      status:
        "manual-ppt-playback-acceptance-production-evidence-preflight-waiting-for-production-deployment-binding",
      approvedPowerPointPlaybackEvidenceLabel: "UAIS-human-PowerPoint-playback-accepted",
      approvedWpsPlaybackEvidenceLabel: "UAIS-human-WPS-playback-accepted",
      approvedManualAcceptanceRecordLabel: "UAIS-manual-PPT-playback-acceptance-record",
      approvedReleaseRunIdLabel: releaseRunId,
      approvedVercelProductionDeploymentEvidenceLabel:
        "UAIS-production-deployment-evidence-label",
      summary: {
        ownerResponseAccepted: true,
        manualStageAcceptedAwaitingEvidence: true,
        ownerConfirmedHumanPlaybackEvidence: true,
        vercelProductionDeploymentEvidenceCleared: false,
        releaseRunBindingStillForbidden: true,
        releaseReady: false,
      },
      missingEvidence: [
        "same-release-run-id-bound-to-manual-record",
        "same-vercel-production-deployment-bound-to-manual-playback-record",
      ],
    });
    const vercelEnvDeployGatePath = writeJson(reportsDir, "vercel-env-deploy-gate.json", {
      target: "vercel-env-deploy-production-evidence-gate",
      status: "vercel-env-deploy-production-evidence-gate-waiting-for-upstream-provider-evidence",
      summary: {
        operatorInputRequired: true,
        blockingInputRequired: true,
        vercelEnvDeployProductionEvidenceCleared: false,
        releaseReady: false,
      },
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamBlockingEvidence: {
        id: "upstream-provider-production-evidence",
        valuesForbidden: true,
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
      "scripts/manual-ppt-playback-acceptance-production-evidence-gate.mjs",
      "--manual-ppt-preflight",
      preflightPath,
      "--vercel-env-deploy-production-evidence-gate",
      vercelEnvDeployGatePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "manual-ppt-playback-acceptance-production-evidence-gate",
        status:
          "manual-ppt-playback-acceptance-production-evidence-gate-waiting-for-production-deployment-binding",
        releaseReady: false,
        responsibleSession: "S24/S22/S10",
        approvedPowerPointPlaybackEvidenceLabel: "UAIS-human-PowerPoint-playback-accepted",
        approvedWpsPlaybackEvidenceLabel: "UAIS-human-WPS-playback-accepted",
        approvedManualAcceptanceRecordLabel: "UAIS-manual-PPT-playback-acceptance-record",
        approvedReleaseRunIdLabel: releaseRunId,
        approvedVercelProductionDeploymentEvidenceLabel:
          "UAIS-production-deployment-evidence-label",
        summary: {
          operatorInputRequired: true,
          blockingInputRequired: true,
          ownerResponseAccepted: true,
          ownerConfirmedHumanPlaybackEvidence: true,
          preflightReady: false,
          manualRecordProvided: false,
          manualRecordAccepted: false,
          productionDeploymentEvidenceProvided: false,
          productionDeploymentEvidenceAccepted: false,
          releaseRunBound: false,
          deploymentBound: false,
          manualPptPlaybackAcceptanceEvidenceCleared: false,
          releaseRunBindingStillForbidden: true,
          releaseReady: false,
        },
        manualRecordStatus: {
          target: "missing",
          status: "missing",
          mode: "missing",
          releaseRunIdStatus: "missing",
          deploymentFingerprintStatus: "missing",
          valueRedacted: true,
        },
        productionDeploymentEvidenceStatus: {
          target: "missing",
          status: "missing",
          environment: "missing",
          releaseRunIdStatus: "missing",
          deploymentObservationStatus: "missing",
          valueRedacted: true,
        },
        blockedReasons: [
          "manual-ppt-preflight-not-ready",
          "vercel-production-deployment-evidence-not-cleared",
          "release-run-binding-still-forbidden",
          "manual-ppt-playback-acceptance-record-missing",
          "vercel-production-deployment-evidence-missing",
          "same-release-run-id-bound-to-manual-record-missing",
          "same-vercel-production-deployment-bound-to-manual-playback-record-missing",
        ],
      }),
    );
    expect(body.upstreamBlockingEvidence).toEqual({
      id: "upstream-vercel-env-deploy-production-evidence-gate",
      label: "vercel-env-deploy-production-evidence-gate",
      reason:
        "Manual PPT playback acceptance evidence must wait for Vercel production deployment evidence before the completed human record can be release-run bound.",
      valuesForbidden: true,
      upstreamStatus:
        "vercel-env-deploy-production-evidence-gate-waiting-for-upstream-provider-evidence",
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
      deploymentUrlsOmitted: true,
      packagePathsOmitted: true,
      audioUrlsOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      manualAcceptancePerformed: false,
      machineEvidenceDoesNotCountAsAcceptance: true,
      humanPlaybackRequired: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/manual-ppt-playback-acceptance-production-evidence-gate.mjs",
      "--manual-ppt-preflight",
      preflightPath,
      "--vercel-env-deploy-production-evidence-gate",
      vercelEnvDeployGatePath,
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

  it("clears only with a completed human record bound to the same release run and deployment fingerprint", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-production-gate-ready-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakePackagePath = "/Users/example/private/KangXia.pptx";
    const fakeAudioUrl = "https://private-audio.example.test/slide-01.wav";
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "manual-ppt-playback-acceptance-production-evidence-preflight",
      status: "manual-ppt-playback-acceptance-production-evidence-preflight-ready",
      approvedPowerPointPlaybackEvidenceLabel: "UAIS-human-PowerPoint-playback-accepted",
      approvedWpsPlaybackEvidenceLabel: "UAIS-human-WPS-playback-accepted",
      approvedManualAcceptanceRecordLabel: "UAIS-manual-PPT-playback-acceptance-record",
      approvedReleaseRunIdLabel: releaseRunId,
      approvedVercelProductionDeploymentEvidenceLabel:
        "UAIS-production-deployment-evidence-label",
      summary: {
        ownerResponseAccepted: true,
        manualStageAcceptedAwaitingEvidence: true,
        ownerConfirmedHumanPlaybackEvidence: true,
        vercelProductionDeploymentEvidenceCleared: true,
        releaseRunBindingStillForbidden: false,
        releaseReady: false,
      },
    });
    const deploymentPath = writeJson(reportsDir, "deployment.json", {
      target: "vercel-production-deployment",
      mode: "live",
      environment: "production",
      status: "deployed",
      releaseRunId,
      deploymentFingerprint,
      deploymentObservation: {
        status: "observed",
        observedAt: "2026-07-02T00:00:00.000Z",
        source: "harness-clock",
      },
      safety: {
        valuesRedacted: true,
        deploymentUrlOmitted: true,
        deploymentUrlsOmitted: true,
        tokenOmitted: true,
        localPrivatePathsOmitted: true,
      },
    });
    const manualRecordPath = writeJson(reportsDir, "manual-record.json", {
      target: "ppt-manual-playback-acceptance",
      mode: "record",
      status: "accepted",
      releaseRunId,
      deploymentFingerprint,
      deploymentEvidenceSource: "vercel-production-deployment",
      deploymentObservationBindingStatus: "proved",
      packageId: "kangxia-natural-number-ordinal-theory-v1",
      packageArtifactFingerprintStatus: "present",
      packageTargetVoiceLabelStatus: "present",
      manualRecordPackageIdentityStatus: "matched",
      manualRecordArtifactFingerprintStatus: "matched",
      manualRecordReleaseRunStatus: "matched",
      manualRecordDeploymentFingerprintStatus: "matched",
      manualRecordAfterDeploymentStatus: "proved",
      manualRecordConfirmationStatus: "accepted-after-human-playback",
      machinePreflightStatus: "passed",
      manualAcceptanceStatus: "accepted",
      manualRecordEvidenceStatus: "complete",
      manualRecordTimingStatus: "valid-past-or-present",
      expectedSlideCount: 19,
      acceptedApplications: ["Microsoft PowerPoint", "WPS Presentation"],
      checklist: {
        slideChecks: 19,
        requiredApplications: ["Microsoft PowerPoint", "WPS Presentation"],
      },
      rawPackagePath: fakePackagePath,
      rawAudioManifestUrl: fakeAudioUrl,
    });

    const output = execFileSync("node", [
      "scripts/manual-ppt-playback-acceptance-production-evidence-gate.mjs",
      "--manual-ppt-preflight",
      preflightPath,
      "--manual-ppt-record",
      manualRecordPath,
      "--vercel-production-deployment",
      deploymentPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("manual-ppt-playback-acceptance-production-evidence-gate-cleared");
    expect(body.releaseReady).toBe(false);
    expect(body.summary).toEqual({
      operatorInputRequired: false,
      blockingInputRequired: false,
      ownerResponseAccepted: true,
      ownerConfirmedHumanPlaybackEvidence: true,
      preflightReady: true,
      manualRecordProvided: true,
      manualRecordAccepted: true,
      productionDeploymentEvidenceProvided: true,
      productionDeploymentEvidenceAccepted: true,
      releaseRunBound: true,
      deploymentBound: true,
      manualPptPlaybackAcceptanceEvidenceCleared: true,
      releaseRunBindingStillForbidden: false,
      releaseReady: false,
    });
    expect(body.manualRecordStatus).toEqual({
      target: "ppt-manual-playback-acceptance",
      status: "accepted",
      mode: "record",
      releaseRunIdStatus: "matched",
      deploymentFingerprintStatus: "matched",
      valueRedacted: true,
    });
    expect(body.productionDeploymentEvidenceStatus).toEqual({
      target: "vercel-production-deployment",
      status: "deployed",
      environment: "production",
      releaseRunIdStatus: "matched",
      deploymentObservationStatus: "observed",
      valueRedacted: true,
    });
    expect(body.provedEvidence).toEqual([
      "human-powerpoint-playback-accepted",
      "human-wps-playback-accepted",
      "explicit-accepted-after-human-playback-status",
      "valid-tested-at-timestamp",
      "all-19-slide-audio-checks-true",
      "target-cloned-voice-label-present",
      "target-cloned-voice-heard-per-slide",
      "same-release-run-id-bound-to-manual-record",
      "same-vercel-production-deployment-bound-to-manual-playback-record",
    ]);
    expect(body.safeNextAction).toBe("advance-enterprise-live-evidence-audit-preflight");
    expect(output).not.toContain(fakePackagePath);
    expect(output).not.toContain(fakeAudioUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}
