import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision manual PPT playback acceptance response template", () => {
  it("builds a queued redacted response template for human PPT playback acceptance", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-response-template-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "manual-ppt-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-manual-ppt-playback-acceptance-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--manual-ppt-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-manual-ppt-playback-acceptance-response-template",
        status: "queued-awaiting-post-deployment-human-qa",
        decisionId: "manual-ppt-playback-acceptance",
        responsibleSession: "S24/S22/S10",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        queueRank: 6,
        queueStatus: "human-qa-needed",
        actionPacketStatus: "human-qa-needed",
        upstreamBlockedDecisionCount: 5,
        requiredApplicationCount: 2,
        requiredEvidenceCount: 9,
        requiredCommandNameCount: 2,
        expectedSlideCount: 19,
        releaseReady: false,
      }),
    );
    expect(body.upstreamBlockedDecisionIds).toEqual([
      "app-auth-provider-production-selector",
      "teacher-auth-provider-production-selector",
      "external-storage-production-service",
      "vercel-env-deploy-and-smoke-chain",
      "ordinary-teaching-production-evidence",
    ]);
    expect(body.ownerResponseTemplate).toEqual(
      expect.objectContaining({
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
      }),
    );
    expect(body.ownerResponseTemplate.requiredApplications).toEqual([
      "Microsoft PowerPoint",
      "WPS Presentation",
    ]);
    expect(body.ownerResponseTemplate.requiredEvidenceAfterApproval).toHaveLength(9);
    expect(body.ownerResponseTemplate.requiredCommandNames).toEqual([
      "createManualRecordTemplate",
      "finalManualAcceptanceEvidence",
    ]);
    expect(body.copySafeOwnerReplyStub).toEqual({
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
    });
    expect(body.ownerResponseValidationCommand).toBe(
      "node scripts/owner-decision-manual-ppt-playback-acceptance-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(body.postResponseAllowedChecks).toEqual([
      "validate-owner-response-shape",
      "confirm-no-private-paths-audio-urls-or-credential-values-in-owner-response",
      "prepare-final-manual-ppt-playback-acceptance-evidence-after-human-record",
      "prepare-enterprise-audit-evidence-collection-after-manual-acceptance",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain(
      "mark-manual-ppt-accepted-before-human-playback",
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-audio.example.test");
    expect(output).not.toContain("<audio-url>");
  });

  it("reports missing when the manual PPT item is not present in the owner queue", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-response-template-missing-"));
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
    const actionPacket = writeJson(tmpDir, "manual-ppt-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-manual-ppt-playback-acceptance-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--manual-ppt-action-packet",
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

  it("renders markdown without source paths, audio URLs, or package paths", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-response-template-md-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "manual-ppt-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-manual-ppt-playback-acceptance-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--manual-ppt-action-packet",
      actionPacket,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Manual PPT Playback Acceptance Response Template");
    expect(output).toContain("Status: `queued-awaiting-post-deployment-human-qa`");
    expect(output).toContain("Do not include private PPT package paths, audio URLs, credential values, or local reviewer paths.");
    expect(output).toContain("`Microsoft PowerPoint`");
    expect(output).toContain("`WPS Presentation`");
    expect(output).toContain("## Copy-Safe Owner Reply Stub");
    expect(output).toContain("<label only; no private reviewer path>");
    expect(output).toContain("## Validation Command");
    expect(output).toContain(
      "node scripts/owner-decision-manual-ppt-playback-acceptance-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-audio.example.test");
    expect(output).not.toContain("<audio-url>");
  });
});

function buildQueue() {
  return {
    status: "owner-decisions-required",
    queue: [
      { rank: 1, id: "app-auth-provider-production-selector", status: "owner-decision-needed" },
      { rank: 2, id: "teacher-auth-provider-production-selector", status: "owner-decision-needed" },
      { rank: 3, id: "external-storage-production-service", status: "owner-decision-needed" },
      { rank: 4, id: "vercel-env-deploy-and-smoke-chain", status: "waiting-for-upstream-owner-decisions" },
      { rank: 5, id: "ordinary-teaching-production-evidence", status: "waiting-for-live-evidence" },
      {
        rank: 6,
        id: "manual-ppt-playback-acceptance",
        status: "human-qa-needed",
        category: "human-qa",
        nextOwnerQuestion:
          "Complete human PPT playback acceptance after production deployment and bind it to the release run.",
      },
    ],
    leakedPath: "/Users/example/private/queue.json",
  };
}

function buildActionPacket() {
  return {
    target: "manual-ppt-playback-acceptance-action-packet",
    status: "human-qa-needed",
    responsibleSession: "S24",
    decisionId: "manual-ppt-playback-acceptance",
    queueRank: 6,
    requiredApplications: ["Microsoft PowerPoint", "WPS Presentation"],
    forbiddenUntilApproved: [
      "mark-manual-ppt-accepted-before-human-playback",
      "reuse-manual-ppt-record-from-different-release-run",
      "reuse-manual-ppt-record-from-different-vercel-deployment",
      "accept-missing-target-voice-label-or-slide-audio",
      "log-private-ppt-package-paths-or-audio-urls",
    ],
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
    commands: {
      createManualRecordTemplate:
        "node scripts/ppt-manual-playback-acceptance.mjs --package-json <ppt-package-path> --record-template-out <manual-record-template>",
      finalManualAcceptanceEvidence:
        "node scripts/ppt-manual-playback-acceptance.mjs --manual-record <completed-human-manual-record> --audio <audio-url>",
    },
    currentEvidenceSummary: {
      evidenceStatus: "plan-blocked",
      acceptedApplications: [],
      manualRecordEvidenceStatus: "missing",
      machinePreflightStatus: "passed",
      expectedSlideCount: 19,
      checklistSlideChecks: 19,
      packageArtifactFingerprintStatus: "present",
      targetVoiceLabelStatus: "present",
      manualRecordTemplateAccepted: false,
    },
    leakedPackagePath: "/Users/example/private/package.pptx",
    leakedAudioUrl: "https://private-audio.example.test/slide-01.wav",
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
