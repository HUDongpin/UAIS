import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("manual PPT playback acceptance production evidence preflight", () => {
  it("turns an accepted human playback response into a redacted preflight waiting on deployment binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-evidence-preflight-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      target: "owner-decision-manual-ppt-playback-acceptance-response-validation",
      status: "owner-response-accepted",
      decisionId: "manual-ppt-playback-acceptance",
      summary: {
        humanQaMayProceedToFinalEvidence: true,
        enterpriseAuditCollectionMayProceed: true,
        releaseRunBindingStillForbidden: true,
        releaseReady: false,
      },
      requiredEvidenceAfterApproval: [
        "human-powerpoint-playback-accepted",
        "human-wps-playback-accepted",
        "explicit-accepted-after-human-playback-status",
        "valid-tested-at-timestamp",
        "same-release-run-id-bound-to-manual-record",
        "same-vercel-production-deployment-bound-to-manual-playback-record",
        "all-19-slide-audio-checks-true",
        "target-cloned-voice-label-present",
        "target-cloned-voice-heard-per-slide",
      ],
      redactedOwnerResponse: {
        approvedPowerPointPlaybackEvidenceLabel: "UAIS-human-PowerPoint-playback-accepted",
        approvedWpsPlaybackEvidenceLabel: "UAIS-human-WPS-playback-accepted",
        approvedManualAcceptanceRecordLabel: "UAIS-manual-PPT-playback-acceptance-record",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
        approvedVercelProductionDeploymentEvidenceLabel: "UAIS-production-deployment-evidence-label",
        approvedTargetClonedVoiceLabel: "UAIS-target-cloned-voice-heard-per-slide",
        approvedSlideAudioChecklistLabel: "UAIS-all-19-slide-audio-checks-passed",
        approvedTestedAtTimestampLabel: "UAIS-manual-playback-tested-at-owner-approved-timestamp",
        confirmsHumanPowerPointPlaybackAccepted: true,
        confirmsHumanWpsPlaybackAccepted: true,
        confirmsAcceptedAfterHumanPlayback: true,
        confirmsAll19SlideAudioChecksTrue: true,
        confirmsTargetClonedVoiceHeardPerSlide: true,
        confirmsSameReleaseRunAndVercelDeploymentBinding: true,
        confirmsMachinePreflightNotUsedAsFinalHumanAcceptance: true,
      },
      postValidationAllowedChecks: [
        "prepare-final-manual-ppt-playback-acceptance-evidence-after-human-record",
        "prepare-enterprise-audit-evidence-collection-after-manual-acceptance",
      ],
      stillForbiddenUntilSeparateApproval: [
        "reuse-manual-ppt-record-from-different-release-run",
        "reuse-manual-ppt-record-from-different-vercel-deployment",
        "bind-production-release-run-id-while-release-gate-blocked",
      ],
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      target: "owner-decision-live-run-approval-gate",
      status: "approval-gate-blocked",
      stages: [
        {
          id: "manual-ppt-playback-acceptance",
          queueStatus: "accepted",
          currentStatus: "accepted-awaiting-production-evidence",
          ownerResponseAccepted: true,
          requiredEvidence: [
            "human-powerpoint-playback-accepted",
            "human-wps-playback-accepted",
            "explicit-accepted-after-human-playback-status",
            "valid-tested-at-timestamp",
            "same-release-run-id-bound-to-manual-record",
            "same-vercel-production-deployment-bound-to-manual-playback-record",
            "all-19-slide-audio-checks-true",
            "target-cloned-voice-label-present",
            "target-cloned-voice-heard-per-slide",
          ],
        },
      ],
    });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {
      target: "manual-ppt-playback-acceptance-action-packet",
      decisionId: "manual-ppt-playback-acceptance",
      requiredEvidence: [
        "human-powerpoint-playback-accepted",
        "human-wps-playback-accepted",
        "explicit-accepted-after-human-playback-status",
        "valid-tested-at-timestamp",
        "same-release-run-id-bound-to-manual-record",
        "same-vercel-production-deployment-bound-to-manual-playback-record",
        "all-19-slide-audio-checks-true",
        "target-cloned-voice-label-present",
        "target-cloned-voice-heard-per-slide",
      ],
      currentEvidenceSummary: {
        evidenceStatus: "plan-blocked",
        manualRecordEvidenceStatus: "missing",
        manualRecordReleaseRunStatus: "not-required",
        manualRecordAfterDeploymentStatus: "not-required",
        machinePreflightStatus: "passed",
        expectedSlideCount: 19,
        checklistSlideChecks: 19,
        packageTargetVoiceLabelStatus: "present",
      },
      commands: {
        finalManualAcceptanceEvidence:
          "node scripts/ppt-manual-playback-acceptance.mjs --package-json <kangxia-package-json> --preflight-report <desktop-preflight-report> --manual-record <completed-human-manual-record> --openxml-integrity <openxml-integrity-evidence> --desktop-app-evidence <desktop-app-evidence> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <ppt-manual-playback-acceptance-evidence>",
      },
      safeNextActions: ["submit-human-accepted-playback-record-for-release-gate"],
      forbiddenUntilApproved: [
        "reuse-manual-ppt-record-from-different-release-run",
        "reuse-manual-ppt-record-from-different-vercel-deployment",
      ],
    });
    const vercelPreflight = writeJson(tmpDir, "vercel-preflight.json", {
      status:
        "vercel-env-deploy-production-evidence-preflight-waiting-for-upstream-provider-evidence",
      releaseReady: false,
      summary: { missingEvidenceCount: 12 },
      missingEvidence: [
        "vercel-production-deployment-evidence",
        "same-release-run-id-bound-to-env-deploy-and-smokes",
      ],
    });

    const output = execFileSync("node", [
      "scripts/manual-ppt-playback-acceptance-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--manual-ppt-action-packet",
      actionPacket,
      "--vercel-env-deploy-preflight",
      vercelPreflight,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "manual-ppt-playback-acceptance-production-evidence-preflight",
        status:
          "manual-ppt-playback-acceptance-production-evidence-preflight-waiting-for-production-deployment-binding",
        releaseReady: false,
        ownerDecisionId: "manual-ppt-playback-acceptance",
      }),
    );
    expect(body.summary).toEqual({
      ownerResponseAccepted: true,
      manualStageAcceptedAwaitingEvidence: true,
      ownerConfirmedHumanPlaybackEvidence: true,
      vercelProductionDeploymentEvidenceCleared: false,
      releaseRunBindingStillForbidden: true,
      requiredEvidenceCount: 9,
      provedOwnerConfirmedEvidenceCount: 7,
      missingEvidenceCount: 2,
      commandTemplateCount: 2,
      releaseReady: false,
    });
    expect(body.provedOwnerConfirmedEvidence).toEqual([
      "human-powerpoint-playback-accepted",
      "human-wps-playback-accepted",
      "explicit-accepted-after-human-playback-status",
      "valid-tested-at-timestamp",
      "all-19-slide-audio-checks-true",
      "target-cloned-voice-label-present",
      "target-cloned-voice-heard-per-slide",
    ]);
    expect(body.missingEvidence).toEqual([
      "same-release-run-id-bound-to-manual-record",
      "same-vercel-production-deployment-bound-to-manual-playback-record",
    ]);
    expect(body.blockedReasons).toContain("vercel-production-deployment-evidence-not-cleared");
    expect(body.blockedReasons).toContain("release-run-binding-still-forbidden");
    expect(body.safety).toEqual(
      expect.objectContaining({
        envFileRead: false,
        deploymentUrlsOmitted: true,
        packagePathsOmitted: true,
        audioUrlsOmitted: true,
        manualAcceptancePerformed: false,
        noLiveMutationPerformed: true,
        noDeploymentMutationPerformed: true,
        noReleaseRunBindingPerformed: true,
      }),
    );

    const markdown = execFileSync("node", [
      "scripts/manual-ppt-playback-acceptance-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--manual-ppt-action-packet",
      actionPacket,
      "--vercel-env-deploy-preflight",
      vercelPreflight,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain(
      "# UAIS Manual PPT Playback Acceptance Production Evidence Preflight",
    );
    expect(markdown).toContain(
      "Status: `manual-ppt-playback-acceptance-production-evidence-preflight-waiting-for-production-deployment-binding`",
    );
    expect(markdown).toContain("## Safe Command Templates");
    expect(markdown).not.toContain("UAIS-enterprise-run-2026-07-XX");
    expect(markdown).not.toContain("https://");
    expect(markdown).not.toContain("/Users/");
    expect(markdown).not.toContain(".pptx");
    expect(markdown).not.toContain(".wav");
  });

  it("stays blocked when the owner response is incomplete", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-evidence-blocked-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      status: "owner-response-incomplete",
      summary: {
        humanQaMayProceedToFinalEvidence: false,
        enterpriseAuditCollectionMayProceed: false,
      },
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", { stages: [] });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {});

    const output = execFileSync("node", [
      "scripts/manual-ppt-playback-acceptance-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--manual-ppt-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe(
      "manual-ppt-playback-acceptance-production-evidence-preflight-blocked",
    );
    expect(body.blockedReasons).toContain("manual-ppt-owner-response-not-accepted");
    expect(body.blockedReasons).toContain(
      "manual-ppt-stage-not-accepted-awaiting-production-evidence",
    );
    expect(body.summary.releaseReady).toBe(false);
  });
});

function writeJson(dir: string, name: string, value: unknown) {
  const filePath = join(dir, name);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}
