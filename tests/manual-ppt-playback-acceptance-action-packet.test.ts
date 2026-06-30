import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("manual PPT playback acceptance action packet", () => {
  it("summarizes human PowerPoint/WPS acceptance without exposing package paths or audio URLs", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-packet-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "manual-ppt-playback-acceptance",
          status: "human-qa-needed",
          responsibleSessions: ["S24"],
          blockedReasons: ["manual-ppt-playback-not-accepted"],
          safeNextActions: [
            "package-manual-ppt-playback-evidence-for-human-review",
            "verify-powerpoint-and-wps-playback-after-production-deployment",
            "bind-manual-ppt-record-to-release-run-and-vercel-deployment",
          ],
          forbiddenUntilApproved: [
            "mark-manual-ppt-accepted-before-human-playback",
            "log-private-ppt-package-paths-or-audio-urls",
          ],
          proofNeeded: [
            "human-powerpoint-playback-accepted",
            "human-wps-playback-accepted",
            "all-19-slide-audio-checks-true",
          ],
          leakedPptx: "/Users/example/private/kangxia-final.pptx",
          leakedAudioUrl: "https://private-audio.example.test/slide-01.wav",
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "manual-ppt-playback-acceptance",
          rank: 6,
          category: "human-qa",
          status: "human-qa-needed",
          blockedReasons: ["manual-ppt-playback-not-accepted"],
          releaseGateRequirementIds: ["ppt-manual-playback-acceptance"],
          enterpriseAuditMissingTargets: ["ppt-manual-playback-acceptance"],
          nextOwnerQuestion: "Complete human PPT playback acceptance after production deployment and bind it to the release run.",
        },
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
      requirements: [
        {
          id: "ppt-manual-playback-acceptance",
          status: "blocked",
          evidenceStatus: "plan-blocked",
          blockedReason: "manual-ppt-playback-not-accepted",
          acceptedApplications: [],
          manualRecordEvidenceStatus: "missing",
          manualRecordPackageIdentityStatus: "missing",
          machinePreflightStatus: "passed",
          expectedSlideCount: 19,
          checklistSlideChecks: 19,
          packageArtifactFingerprintStatus: "present",
          packageTargetVoiceLabelStatus: "present",
          manualRecordArtifactFingerprintStatus: "missing",
          manualRecordReleaseRunStatus: "not-required",
          manualRecordAfterDeploymentStatus: "not-required",
          manualRecordTimingStatus: "missing",
          manualRecordConfirmationStatus: "missing",
          manualRecordTemplate: {
            fileName: "2026-06-28-ppt-manual-playback-acceptance-record-template-production-live.json",
            status: "created",
            accepted: false,
            applications: ["Microsoft PowerPoint", "WPS Presentation"],
            slideChecksPerApplication: 19,
            valuesRedacted: true,
            leakedPath: "/Users/example/private/template.json",
          },
          leakedPackageJson: "/Users/example/private/package.json",
          leakedAudioUrl: "https://private-audio.example.test/slide-02.wav",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/manual-ppt-playback-acceptance-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "manual-ppt-playback-acceptance-action-packet",
        status: "human-qa-needed",
        releaseGateStatus: "blocked",
        responsibleSession: "S24",
        decisionId: "manual-ppt-playback-acceptance",
        queueRank: 6,
        classification: "human-powerpoint-wps-playback-acceptance-blocked",
        requiredApplications: ["Microsoft PowerPoint", "WPS Presentation"],
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
          acceptedApplications: [],
          manualRecordEvidenceStatus: "missing",
          manualRecordPackageIdentityStatus: "missing",
          machinePreflightStatus: "passed",
          expectedSlideCount: 19,
          checklistSlideChecks: 19,
          packageArtifactFingerprintStatus: "present",
          packageTargetVoiceLabelStatus: "present",
          manualRecordArtifactFingerprintStatus: "missing",
          manualRecordReleaseRunStatus: "not-required",
          manualRecordAfterDeploymentStatus: "not-required",
          manualRecordTimingStatus: "missing",
          manualRecordConfirmationStatus: "missing",
          manualRecordTemplateStatus: "created",
          manualRecordTemplateAccepted: false,
          manualRecordTemplateFileName: "2026-06-28-ppt-manual-playback-acceptance-record-template-production-live.json",
        },
        releaseGateRequirementIds: ["ppt-manual-playback-acceptance"],
        enterpriseAuditMissingTargets: ["ppt-manual-playback-acceptance"],
        commands: expect.objectContaining({
          createManualRecordTemplate: "node scripts/ppt-manual-playback-acceptance.mjs --package-json <kangxia-package-json> --preflight-report <desktop-preflight-report> --openxml-integrity <openxml-integrity-evidence> --desktop-app-evidence <desktop-app-evidence> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --record-template-out <manual-record-template> > <ppt-manual-playback-gate-plan-evidence>",
          finalManualAcceptanceEvidence: "node scripts/ppt-manual-playback-acceptance.mjs --package-json <kangxia-package-json> --preflight-report <desktop-preflight-report> --manual-record <completed-human-manual-record> --openxml-integrity <openxml-integrity-evidence> --desktop-app-evidence <desktop-app-evidence> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <ppt-manual-playback-acceptance-evidence>",
        }),
        safety: {
          sourcePathsOmitted: true,
          packagePathsOmitted: true,
          audioUrlsOmitted: true,
          manualAcceptancePerformed: false,
          machineEvidenceDoesNotCountAsAcceptance: true,
          humanPlaybackRequired: true,
          responseBodiesOmitted: true,
        },
      }),
    );
    expect(body.stopConditions).toEqual(
      expect.arrayContaining([
        "Stop if human PowerPoint and WPS playback have not both been completed.",
        "Stop if any of the 19 slide audio checks is missing for either application.",
        "Stop if machine preflight or desktop-open evidence is being treated as final human acceptance.",
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-audio.example.test");
    expect(output).not.toContain("kangxia-final.pptx");
  });

  it("renders a markdown manual PPT acceptance packet for handoff", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-manual-ppt-packet-md-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "manual-ppt-playback-acceptance",
          status: "human-qa-needed",
          blockedReasons: ["manual-ppt-playback-not-accepted"],
          safeNextActions: ["package-manual-ppt-playback-evidence-for-human-review"],
          forbiddenUntilApproved: ["mark-manual-ppt-accepted-before-human-playback"],
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "manual-ppt-playback-acceptance",
          rank: 6,
          nextOwnerQuestion: "Complete human PPT playback acceptance after production deployment and bind it to the release run.",
          releaseGateRequirementIds: ["ppt-manual-playback-acceptance"],
          enterpriseAuditMissingTargets: ["ppt-manual-playback-acceptance"],
        },
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
      requirements: [
        {
          id: "ppt-manual-playback-acceptance",
          status: "blocked",
          evidenceStatus: "plan-blocked",
          acceptedApplications: [],
          manualRecordEvidenceStatus: "missing",
          machinePreflightStatus: "passed",
          expectedSlideCount: 19,
          checklistSlideChecks: 19,
          packageArtifactFingerprintStatus: "present",
          packageTargetVoiceLabelStatus: "present",
          manualRecordTemplate: {
            fileName: "template.json",
            status: "created",
            accepted: false,
            applications: ["Microsoft PowerPoint", "WPS Presentation"],
            slideChecksPerApplication: 19,
          },
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/manual-ppt-playback-acceptance-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Manual PPT Playback Acceptance Action Packet");
    expect(output).toContain("Status: `human-qa-needed`");
    expect(output).toContain("Queue rank: 6");
    expect(output).toContain("`Microsoft PowerPoint`");
    expect(output).toContain("`WPS Presentation`");
    expect(output).toContain("Machine preflight does not count as final human acceptance.");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(tmpDir: string, filename: string, body: unknown) {
  const filePath = join(tmpDir, filename);
  writeFileSync(filePath, JSON.stringify(body, null, 2));
  return filePath;
}
