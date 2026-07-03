import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision manual PPT playback acceptance response validation", () => {
  it("accepts a complete redacted human playback response while keeping release binding gated", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-response-validation-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "manual-ppt-playback-acceptance",
      approvedPowerPointPlaybackEvidenceLabel: "powerpoint-human-playback-redacted",
      approvedWpsPlaybackEvidenceLabel: "wps-human-playback-redacted",
      approvedManualAcceptanceRecordLabel: "manual-record-redacted",
      approvedReleaseRunIdLabel: "release-run-manual-ppt-2026-07-01",
      approvedVercelProductionDeploymentEvidenceLabel: "vercel-production-deployment-redacted",
      approvedTargetClonedVoiceLabel: "target-cloned-voice-redacted-label",
      approvedSlideAudioChecklistLabel: "slide-audio-checklist-redacted",
      approvedTestedAtTimestampLabel: "tested-at-redacted-timestamp",
      confirmsNoPrivatePathsAudioUrlsOrCredentialValuesInResponse: true,
      confirmsHumanPowerPointPlaybackAccepted: true,
      confirmsHumanWpsPlaybackAccepted: true,
      confirmsAcceptedAfterHumanPlayback: true,
      confirmsAll19SlideAudioChecksTrue: true,
      confirmsTargetClonedVoiceHeardPerSlide: true,
      confirmsSameReleaseRunAndVercelDeploymentBinding: true,
      confirmsMachinePreflightNotUsedAsFinalHumanAcceptance: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-manual-ppt-playback-acceptance-response-validation.mjs",
      "--owner-response-template",
      template,
      "--owner-response",
      ownerResponse,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-manual-ppt-playback-acceptance-response-validation",
        status: "owner-response-accepted",
        releaseReady: false,
        decisionId: "manual-ppt-playback-acceptance",
        responsibleSession: "S24/S22/S10",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        missingFieldCount: 0,
        unsafeFindingCount: 0,
        requiredEvidenceAfterApprovalCount: 9,
        requiredCommandNameCount: 2,
        humanQaMayProceedToFinalEvidence: true,
        enterpriseAuditCollectionMayProceed: true,
        releaseRunBindingStillForbidden: true,
        releaseReady: false,
      }),
    );
    expect(body.postValidationAllowedChecks).toEqual([
      "prepare-final-manual-ppt-playback-acceptance-evidence-after-human-record",
      "prepare-enterprise-audit-evidence-collection-after-manual-acceptance",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain(
      "bind-production-release-run-id-while-release-gate-blocked",
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
    expect(output).not.toContain(".pptx");
  });

  it("keeps the template placeholder incomplete until human acceptance is filled", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-response-validation-incomplete-"));
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-manual-ppt-playback-acceptance-response-validation.mjs",
      "--owner-response-template",
      template,
      "--owner-response",
      ownerResponse,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-incomplete");
    expect(body.summary.missingFieldCount).toBeGreaterThanOrEqual(16);
    expect(body.summary.humanQaMayProceedToFinalEvidence).toBe(false);
    expect(body.summary.enterpriseAuditCollectionMayProceed).toBe(false);
    expect(body.postValidationAllowedChecks).toEqual([]);
    expect(body.blockedReasons).toContain("approvedPowerPointPlaybackEvidenceLabel-missing-or-invalid");
    expect(body.blockedReasons).toContain(
      "confirmsMachinePreflightNotUsedAsFinalHumanAcceptance-not-confirmed",
    );
    expect(output).not.toContain(tmpDir);
  });

  it("renders empty post-validation checks explicitly in incomplete markdown", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-response-validation-md-incomplete-"));
    const templateReport = buildTemplateReport();
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-manual-ppt-playback-acceptance-response-validation.mjs",
      "--owner-response-template",
      template,
      "--owner-response",
      ownerResponse,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("Status: `owner-response-incomplete`");
    expect(output).toContain("## Post-Validation Allowed Checks");
    expect(output).toContain("- `none-recorded`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain(".pptx");
  });

  it("uses the copy-safe owner reply stub when validating a generated template report", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-response-validation-stub-"));
    const templateReport = {
      ...buildTemplateReport(),
      copySafeOwnerReplyStub: {
        responseStatus: "owner-response-provided",
        decisionId: "manual-ppt-playback-acceptance",
        approvedPowerPointPlaybackEvidenceLabel:
          "<label only; no private path, package filename, or audio URL>",
        approvedWpsPlaybackEvidenceLabel:
          "<label only; no private path, package filename, or audio URL>",
        approvedManualAcceptanceRecordLabel: "<label only; no private reviewer path>",
        approvedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
        approvedVercelProductionDeploymentEvidenceLabel:
          "<label only; no deployment URL or response body>",
        approvedTargetClonedVoiceLabel: "<label only; no audio URL>",
        approvedSlideAudioChecklistLabel: "<label only; no audio file names or URLs>",
        approvedTestedAtTimestampLabel: "<label only; no local reviewer path>",
        confirmsNoPrivatePathsAudioUrlsOrCredentialValuesInResponse: true,
        confirmsHumanPowerPointPlaybackAccepted: true,
        confirmsHumanWpsPlaybackAccepted: true,
        confirmsAcceptedAfterHumanPlayback: true,
        confirmsAll19SlideAudioChecksTrue: true,
        confirmsTargetClonedVoiceHeardPerSlide: true,
        confirmsSameReleaseRunAndVercelDeploymentBinding: true,
        confirmsMachinePreflightNotUsedAsFinalHumanAcceptance: true,
      },
    };
    const template = writeJson(tmpDir, "template.json", templateReport);
    const ownerResponse = writeJson(tmpDir, "owner-response.json", templateReport);

    const output = execFileSync("node", [
      "scripts/owner-decision-manual-ppt-playback-acceptance-response-validation.mjs",
      "--owner-response-template",
      template,
      "--owner-response",
      ownerResponse,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-incomplete");
    expect(body.summary.humanQaMayProceedToFinalEvidence).toBe(false);
    expect(body.summary.enterpriseAuditCollectionMayProceed).toBe(false);
    expect(body.summary.releaseRunBindingStillForbidden).toBe(true);
    expect(body.redactedOwnerResponse).toEqual(templateReport.copySafeOwnerReplyStub);
    expect(body.blockedReasons).toEqual([
      "approvedPowerPointPlaybackEvidenceLabel-missing-or-invalid",
      "approvedWpsPlaybackEvidenceLabel-missing-or-invalid",
      "approvedManualAcceptanceRecordLabel-missing-or-invalid",
      "approvedReleaseRunIdLabel-missing-or-invalid",
      "approvedVercelProductionDeploymentEvidenceLabel-missing-or-invalid",
      "approvedTargetClonedVoiceLabel-missing-or-invalid",
      "approvedSlideAudioChecklistLabel-missing-or-invalid",
      "approvedTestedAtTimestampLabel-missing-or-invalid",
    ]);
    expect(output).not.toContain(tmpDir);
  });

  it("rejects unsafe owner responses without echoing package paths, audio URLs, or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-response-validation-unsafe-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "manual-ppt-playback-acceptance",
      approvedPowerPointPlaybackEvidenceLabel: "/Users/example/private/package.pptx",
      approvedWpsPlaybackEvidenceLabel: "https://private-audio.example.test/slide-01.wav",
      approvedManualAcceptanceRecordLabel: "manual-record-redacted",
      approvedReleaseRunIdLabel: "release-run-manual-ppt-2026-07-01",
      approvedVercelProductionDeploymentEvidenceLabel: "vercel-production-deployment-redacted",
      approvedTargetClonedVoiceLabel: "target-cloned-voice-redacted-label",
      approvedSlideAudioChecklistLabel: "slide-audio-checklist-redacted",
      approvedTestedAtTimestampLabel: "tested-at-redacted-timestamp",
      confirmsNoPrivatePathsAudioUrlsOrCredentialValuesInResponse: true,
      confirmsHumanPowerPointPlaybackAccepted: true,
      confirmsHumanWpsPlaybackAccepted: true,
      confirmsAcceptedAfterHumanPlayback: true,
      confirmsAll19SlideAudioChecksTrue: true,
      confirmsTargetClonedVoiceHeardPerSlide: true,
      confirmsSameReleaseRunAndVercelDeploymentBinding: true,
      confirmsMachinePreflightNotUsedAsFinalHumanAcceptance: true,
      notes: "UAIS_PPT_ACCEPTANCE_TOKEN=secret-token-value",
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-manual-ppt-playback-acceptance-response-validation.mjs",
      "--owner-response-template",
      template,
      "--owner-response",
      ownerResponse,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("owner-response-rejected");
    expect(body.summary.unsafeFindingCount).toBeGreaterThanOrEqual(6);
    expect(body.redactedOwnerResponse.approvedPowerPointPlaybackEvidenceLabel).toBeNull();
    expect(body.redactedOwnerResponse.approvedWpsPlaybackEvidenceLabel).toBeNull();
    expect(body.unsafeFindings.map((finding: { patternId: string }) => finding.patternId)).toEqual(
      expect.arrayContaining([
        "raw-url",
        "local-user-path",
        "ppt-package-file",
        "audio-file-or-url",
        "env-assignment",
      ]),
    );
    expect(output).not.toContain("/Users/example/private/package.pptx");
    expect(output).not.toContain("https://private-audio.example.test");
    expect(output).not.toContain("secret-token-value");
  });

  it("renders markdown without source paths, audio URLs, package paths, or credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-response-validation-md-"));
    const template = writeJson(tmpDir, "template.json", buildTemplateReport());
    const ownerResponse = writeJson(tmpDir, "owner-response.json", {
      responseStatus: "owner-response-provided",
      decisionId: "manual-ppt-playback-acceptance",
      approvedPowerPointPlaybackEvidenceLabel: "powerpoint-human-playback-redacted",
      approvedWpsPlaybackEvidenceLabel: "wps-human-playback-redacted",
      approvedManualAcceptanceRecordLabel: "manual-record-redacted",
      approvedReleaseRunIdLabel: "release-run-manual-ppt-2026-07-01",
      approvedVercelProductionDeploymentEvidenceLabel: "vercel-production-deployment-redacted",
      approvedTargetClonedVoiceLabel: "target-cloned-voice-redacted-label",
      approvedSlideAudioChecklistLabel: "slide-audio-checklist-redacted",
      approvedTestedAtTimestampLabel: "tested-at-redacted-timestamp",
      confirmsNoPrivatePathsAudioUrlsOrCredentialValuesInResponse: true,
      confirmsHumanPowerPointPlaybackAccepted: true,
      confirmsHumanWpsPlaybackAccepted: true,
      confirmsAcceptedAfterHumanPlayback: true,
      confirmsAll19SlideAudioChecksTrue: true,
      confirmsTargetClonedVoiceHeardPerSlide: true,
      confirmsSameReleaseRunAndVercelDeploymentBinding: true,
      confirmsMachinePreflightNotUsedAsFinalHumanAcceptance: true,
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-manual-ppt-playback-acceptance-response-validation.mjs",
      "--owner-response-template",
      template,
      "--owner-response",
      ownerResponse,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Manual PPT Playback Acceptance Response Validation");
    expect(output).toContain("Status: `owner-response-accepted`");
    expect(output).toContain("Human QA may proceed to final evidence: `true`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
    expect(output).not.toContain(".pptx");
  });
});

function buildTemplateReport() {
  return {
    target: "owner-decision-manual-ppt-playback-acceptance-response-template",
    status: "queued-awaiting-post-deployment-human-qa",
    decisionId: "manual-ppt-playback-acceptance",
    ownerResponseTemplate: {
      responseStatus: "owner-response-required",
      decisionId: "manual-ppt-playback-acceptance",
      approvedPowerPointPlaybackEvidenceLabel: null,
      approvedWpsPlaybackEvidenceLabel: null,
      approvedManualAcceptanceRecordLabel: null,
      approvedReleaseRunIdLabel: null,
      approvedVercelProductionDeploymentEvidenceLabel: null,
      approvedTargetClonedVoiceLabel: null,
      approvedSlideAudioChecklistLabel: null,
      approvedTestedAtTimestampLabel: null,
      confirmsNoPrivatePathsAudioUrlsOrCredentialValuesInResponse: false,
      confirmsHumanPowerPointPlaybackAccepted: false,
      confirmsHumanWpsPlaybackAccepted: false,
      confirmsAcceptedAfterHumanPlayback: false,
      confirmsAll19SlideAudioChecksTrue: false,
      confirmsTargetClonedVoiceHeardPerSlide: false,
      confirmsSameReleaseRunAndVercelDeploymentBinding: false,
      confirmsMachinePreflightNotUsedAsFinalHumanAcceptance: false,
      requiredApplications: ["Microsoft PowerPoint", "WPS Presentation"],
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
      requiredCommandNames: [
        "createManualRecordTemplate",
        "finalManualAcceptanceEvidence",
      ],
    },
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
