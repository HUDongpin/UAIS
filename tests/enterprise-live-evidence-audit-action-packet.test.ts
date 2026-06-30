import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const missingTargets = [
  "app-auth-provider-readiness",
  "teacher-auth-issuer-route-smoke",
  "teacher-auth-provider-readiness",
  "external-storage-persistence",
  "external-storage-service-readiness",
  "deployment-domain-reachability",
  "teacher-workflow-deployment-smoke",
  "teacher-workflow-browser-smoke",
  "teacher-workflow-live-generation-smoke",
  "learning-ppt-playback-deployment-smoke",
  "ppt-manual-playback-acceptance",
  "deployment-route-smoke",
  "teaching-operations-route-smoke",
  "teaching-operation-detail-browser-smoke",
  "teaching-course-management-route-smoke",
  "external-storage-smoke",
];

const requiredSafetyFlags = [
  "valuesRedacted",
  "cookieValuesOmitted",
  "responseBodiesOmitted",
  "liveRequiresApproval",
  "remoteMutationRequiresApproval",
];

describe("enterprise live evidence audit action packet", () => {
  it("summarizes the blocked audit without exposing private evidence details", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-packet-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "enterprise-live-evidence-audit",
          status: "waiting-for-live-evidence",
          responsibleSessions: ["S22"],
          blockedReasons: ["enterprise-live-evidence-audit-not-ready"],
          safeNextActions: [
            "wait-for-approved-production-live-evidence-files",
            "run-enterprise-live-evidence-audit-after-all-target-evidence-exists",
            "reject-filename-only-or-blocked-evidence-records",
          ],
          forbiddenUntilApproved: [
            "mark-enterprise-audit-ready-with-missing-required-targets",
            "publish-audit-with-local-private-paths-or-raw-urls",
          ],
          proofNeeded: [
            "body-level-production-live-evidence-audit-proof",
            "all-orchestrated-production-live-targets-present",
            "shared-release-run-id-across-production-live-evidence",
          ],
          leakedLocalPath: "/Users/example/private/live-evidence.json",
          leakedUrl: "https://private-production.example.test/evidence",
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "enterprise-live-evidence-audit",
          rank: 7,
          category: "evidence-audit",
          status: "waiting-for-live-evidence",
          blockedReasons: ["enterprise-live-evidence-audit-not-ready"],
          releaseGateRequirementIds: ["enterprise-live-evidence-audit"],
          enterpriseAuditMissingTargets: missingTargets,
          nextOwnerQuestion: "Run the enterprise live evidence audit only after all approved production live evidence files exist.",
        },
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
      requirements: [
        {
          id: "enterprise-live-evidence-audit",
          status: "blocked",
          evidenceStatus: "blocked",
          totalProductionLiveNamed: 16,
          acceptedLiveEvidence: 0,
          filenameOnlyOrBlocked: 16,
          releaseRunIdConsistency: "missing",
          sharedReleaseRunIdStatus: "missing",
          distinctReleaseRunIdCount: 0,
          rowProofStatus: "proved",
          rowCount: 16,
          acceptedRowCount: 0,
          blockedRowCount: 16,
          requiredTargetProofStatus: "missing",
          requiredTargetResultCriteriaStatus: "proved",
          requiredTargetContractCriteriaStatus: "missing",
          missingRequiredTargetCount: 16,
          unexpectedTargetCount: 0,
          unexpectedEvidenceFileCount: 0,
          missingRequiredTargets: missingTargets,
          auditBlockedReasons: [
            "filename-only-or-blocked-production-live-evidence",
            "enterprise-live-required-targets-missing",
          ],
          safety: {
            valuesRedacted: "proved",
            cookieValuesOmitted: "proved",
            localPathsOmitted: "proved",
            fileNamesOnly: "proved",
            responseBodiesOmitted: "proved",
          },
          leakedCookie: "uais_teacher_auth_claims=secret",
        },
      ],
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      target: "enterprise-live-evidence-audit",
      status: "blocked",
      summary: {
        totalProductionLiveNamed: 16,
        acceptedLiveEvidence: 0,
        filenameOnlyOrBlocked: 16,
        releaseRunIdConsistency: "missing",
        sharedReleaseRunIdStatus: "missing",
        distinctReleaseRunIdCount: 0,
        requiredTargetProofStatus: "missing",
        missingRequiredTargetCount: 16,
        unexpectedTargetCount: 0,
        unexpectedEvidenceFileCount: 0,
      },
      requiredTargets: missingTargets,
      missingRequiredTargets: missingTargets,
      acceptedTargets: [],
      blockedReasons: [
        "filename-only-or-blocked-production-live-evidence",
        "enterprise-live-required-targets-missing",
      ],
      criteria: {
        acceptedBodyFields: {
          requiredSafetyFlags,
        },
      },
      safety: {
        valuesRedacted: true,
        cookieValuesOmitted: true,
        localPathsOmitted: true,
        fileNamesOnly: true,
        responseBodiesOmitted: true,
      },
      rows: [
        {
          file: "/Users/example/private/2026-06-30-app-auth-provider-readiness-production-live.json",
          rawUrl: "https://private-production.example.test/app-auth",
          cookie: "uais_teacher_auth_signature=secret",
          responseBody: "{\"token\":\"secret\"}",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "enterprise-live-evidence-audit-action-packet",
        status: "waiting-for-live-evidence",
        releaseGateStatus: "blocked",
        responsibleSession: "S22",
        decisionId: "enterprise-live-evidence-audit",
        queueRank: 7,
        classification: "production-live-evidence-audit-blocked",
        requiredEvidence: [
          "body-level-production-live-evidence-audit-proof",
          "all-orchestrated-production-live-targets-present",
          "shared-release-run-id-across-production-live-evidence",
        ],
        currentEvidenceSummary: {
          evidenceStatus: "blocked",
          totalProductionLiveNamed: 16,
          acceptedLiveEvidence: 0,
          filenameOnlyOrBlocked: 16,
          releaseRunIdConsistency: "missing",
          sharedReleaseRunIdStatus: "missing",
          distinctReleaseRunIdCount: 0,
          rowProofStatus: "proved",
          rowCount: 16,
          acceptedRowCount: 0,
          blockedRowCount: 16,
          requiredTargetProofStatus: "missing",
          requiredTargetResultCriteriaStatus: "proved",
          requiredTargetContractCriteriaStatus: "missing",
          missingRequiredTargetCount: 16,
          unexpectedTargetCount: 0,
          unexpectedEvidenceFileCount: 0,
          auditBlockedReasons: [
            "filename-only-or-blocked-production-live-evidence",
            "enterprise-live-required-targets-missing",
          ],
          safety: {
            valuesRedacted: true,
            cookieValuesOmitted: true,
            localPathsOmitted: true,
            fileNamesOnly: true,
            responseBodiesOmitted: true,
          },
          requiredSafetyFlags,
        },
        requiredTargets: missingTargets,
        missingRequiredTargets: missingTargets,
        releaseGateRequirementIds: ["enterprise-live-evidence-audit"],
        enterpriseAuditMissingTargets: missingTargets,
        commands: expect.objectContaining({
          runEnterpriseAudit: "node scripts/enterprise-live-evidence-audit.mjs --reports-dir coordination/reports --date <production-live-date> --output <enterprise-live-evidence-audit-output>",
          refreshReleaseGateWithAudit: "node -- scripts/production-e2e-release-gate.mjs <release-gate-inputs> --enterprise-live-evidence-audit <enterprise-live-evidence-audit-output> > <production-e2e-release-gate-output>",
        }),
        safety: {
          sourcePathsOmitted: true,
          rawUrlsOmitted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          noLiveAuditRun: true,
          noReleaseRunBindingPerformed: true,
          filenameOnlyEvidenceRejected: true,
          liveEvidenceRequired: true,
          valuesRedacted: true,
        },
      }),
    );
    expect(body.stopConditions).toEqual(
      expect.arrayContaining([
        "Stop if any required production-live evidence target is missing.",
        "Stop if any candidate evidence is filename-only or blocked rather than body-proven live production evidence.",
        "Stop if production live evidence does not share the same non-secret release-run ID.",
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-production.example.test");
    expect(output).not.toContain("uais_teacher_auth_claims=secret");
    expect(output).not.toContain("uais_teacher_auth_signature=secret");
    expect(output).not.toContain("{\"token\":\"secret\"}");
  });

  it("renders a markdown enterprise live evidence audit packet for handoff", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-packet-md-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "enterprise-live-evidence-audit",
          status: "waiting-for-live-evidence",
          blockedReasons: ["enterprise-live-evidence-audit-not-ready"],
          safeNextActions: ["wait-for-approved-production-live-evidence-files"],
          forbiddenUntilApproved: ["mark-enterprise-audit-ready-with-missing-required-targets"],
          proofNeeded: ["body-level-production-live-evidence-audit-proof"],
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "enterprise-live-evidence-audit",
          rank: 7,
          nextOwnerQuestion: "Run the enterprise live evidence audit only after all approved production live evidence files exist.",
          releaseGateRequirementIds: ["enterprise-live-evidence-audit"],
          enterpriseAuditMissingTargets: missingTargets,
        },
      ],
    });
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
      requirements: [
        {
          id: "enterprise-live-evidence-audit",
          status: "blocked",
          evidenceStatus: "blocked",
          totalProductionLiveNamed: 16,
          acceptedLiveEvidence: 0,
          filenameOnlyOrBlocked: 16,
          releaseRunIdConsistency: "missing",
          rowCount: 16,
          blockedRowCount: 16,
          missingRequiredTargetCount: 16,
          missingRequiredTargets: missingTargets,
        },
      ],
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      target: "enterprise-live-evidence-audit",
      status: "blocked",
      summary: {
        totalProductionLiveNamed: 16,
        acceptedLiveEvidence: 0,
        filenameOnlyOrBlocked: 16,
        releaseRunIdConsistency: "missing",
        missingRequiredTargetCount: 16,
      },
      requiredTargets: missingTargets,
      missingRequiredTargets: missingTargets,
      acceptedTargets: [],
      blockedReasons: ["enterprise-live-required-targets-missing"],
      criteria: {
        acceptedBodyFields: {
          requiredSafetyFlags,
        },
      },
      safety: {
        valuesRedacted: true,
        cookieValuesOmitted: true,
        localPathsOmitted: true,
        fileNamesOnly: true,
        responseBodiesOmitted: true,
      },
    });

    const output = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
      "--release-gate",
      releaseGate,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Enterprise Live Evidence Audit Action Packet");
    expect(output).toContain("Status: `waiting-for-live-evidence`");
    expect(output).toContain("Queue rank: 7");
    expect(output).toContain("Accepted live evidence: 0 / 16");
    expect(output).toContain("Filename-only or blocked evidence cannot satisfy the enterprise live audit.");
    expect(output).toContain("`app-auth-provider-readiness`");
    expect(output).toContain("`external-storage-smoke`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(tmpDir: string, filename: string, body: unknown) {
  const filePath = join(tmpDir, filename);
  writeFileSync(filePath, JSON.stringify(body, null, 2));
  return filePath;
}
