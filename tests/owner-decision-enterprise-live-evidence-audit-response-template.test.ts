import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision enterprise live evidence audit response template", () => {
  it("builds a queued redacted response template for enterprise live evidence audit readiness", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-response-template-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "enterprise-audit-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-enterprise-live-evidence-audit-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--enterprise-audit-action-packet",
      actionPacket,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-enterprise-live-evidence-audit-response-template",
        status: "queued-awaiting-all-production-live-evidence",
        decisionId: "enterprise-live-evidence-audit",
        responsibleSession: "S22/S10/S25",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        queueRank: 7,
        queueStatus: "waiting-for-live-evidence",
        actionPacketStatus: "waiting-for-live-evidence",
        upstreamBlockedDecisionCount: 6,
        requiredTargetCount: 16,
        missingRequiredTargetCount: 16,
        acceptedLiveEvidenceCount: 0,
        requiredEvidenceCount: 7,
        requiredCommandNameCount: 2,
        releaseReady: false,
      }),
    );
    expect(body.upstreamBlockedDecisionIds).toEqual([
      "app-auth-provider-production-selector",
      "teacher-auth-provider-production-selector",
      "external-storage-production-service",
      "vercel-env-deploy-and-smoke-chain",
      "ordinary-teaching-production-evidence",
      "manual-ppt-playback-acceptance",
    ]);
    expect(body.ownerResponseTemplate).toEqual(
      expect.objectContaining({
        responseStatus: "owner-response-required",
        decisionId: "enterprise-live-evidence-audit",
        approvedEnterpriseLiveEvidenceAuditProofLabel: null,
        approvedProductionLiveEvidenceSetLabel: null,
        approvedSharedReleaseRunIdLabel: null,
        approvedSafetyRedactionFlagsLabel: null,
        approvedTargetResultProofSetLabel: null,
        approvedTargetContractProofSetLabel: null,
        approvedRejectedFilenameOnlyEvidenceLabel: null,
        confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: false,
        confirmsAll16RequiredTargetsBodyProven: false,
        confirmsFilenameOnlyOrBlockedEvidenceRejected: false,
        confirmsSharedReleaseRunIdAcrossProductionEvidence: false,
        confirmsRequiredSafetyFlagsPresent: false,
        confirmsTargetSpecificResultAndContractProofsPresent: false,
        confirmsLocalOrDryRunEvidenceNotAccepted: false,
        confirmsAuditRunRequiresAllEvidenceBeforeExecution: false,
      }),
    );
    expect(body.ownerResponseTemplate.requiredTargets).toHaveLength(16);
    expect(body.ownerResponseTemplate.missingRequiredTargets).toHaveLength(16);
    expect(body.ownerResponseTemplate.requiredEvidenceAfterApproval).toHaveLength(7);
    expect(body.ownerResponseTemplate.requiredCommandNames).toEqual([
      "runEnterpriseAudit",
      "refreshReleaseGateWithAudit",
    ]);
    expect(body.copySafeOwnerReplyStub).toEqual({
      responseStatus: "owner-response-provided",
      decisionId: "enterprise-live-evidence-audit",
      approvedEnterpriseLiveEvidenceAuditProofLabel:
        "<label only; no URL, local path, cookie, or credential value>",
      approvedProductionLiveEvidenceSetLabel:
        "<label only; no URL, local path, cookie, or credential value>",
      approvedSharedReleaseRunIdLabel: "<label only; no URL, token, or cookie>",
      approvedSafetyRedactionFlagsLabel:
        "<label only; no URL, local path, cookie, or credential value>",
      approvedTargetResultProofSetLabel:
        "<label only; no URL, local path, cookie, or credential value>",
      approvedTargetContractProofSetLabel:
        "<label only; no URL, local path, cookie, or credential value>",
      approvedRejectedFilenameOnlyEvidenceLabel:
        "<label only; no URL, local path, cookie, or credential value>",
      confirmsNoRawUrlsLocalPathsCookiesOrCredentialValuesInResponse: true,
      confirmsAll16RequiredTargetsBodyProven: true,
      confirmsFilenameOnlyOrBlockedEvidenceRejected: true,
      confirmsSharedReleaseRunIdAcrossProductionEvidence: true,
      confirmsRequiredSafetyFlagsPresent: true,
      confirmsTargetSpecificResultAndContractProofsPresent: true,
      confirmsLocalOrDryRunEvidenceNotAccepted: true,
      confirmsAuditRunRequiresAllEvidenceBeforeExecution: true,
    });
    expect(body.ownerResponseValidationCommand).toBe(
      "node scripts/owner-decision-enterprise-live-evidence-audit-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(body.postResponseAllowedChecks).toEqual([
      "validate-owner-response-shape",
      "confirm-no-raw-urls-local-paths-cookies-or-credential-values-in-owner-response",
      "prepare-enterprise-live-evidence-audit-command-after-all-target-evidence-exists",
      "prepare-release-gate-refresh-after-enterprise-audit-passes",
    ]);
    expect(body.stillForbiddenUntilSeparateApproval).toContain(
      "mark-enterprise-audit-ready-with-missing-required-targets",
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-audit.example.test");
    expect(output).not.toContain("<production-live-date>");
  });

  it("reports missing when the enterprise audit item is not present in the owner queue", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-response-template-missing-"));
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
    const actionPacket = writeJson(tmpDir, "enterprise-audit-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-enterprise-live-evidence-audit-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--enterprise-audit-action-packet",
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

  it("renders markdown without source paths, raw URLs, cookies, or command placeholders", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-response-template-md-"));
    const ownerDecisionQueue = writeJson(tmpDir, "queue.json", buildQueue());
    const actionPacket = writeJson(tmpDir, "enterprise-audit-action-packet.json", buildActionPacket());

    const output = execFileSync("node", [
      "scripts/owner-decision-enterprise-live-evidence-audit-response-template.mjs",
      "--owner-decision-queue",
      ownerDecisionQueue,
      "--enterprise-audit-action-packet",
      actionPacket,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Enterprise Live Evidence Audit Response Template");
    expect(output).toContain("Status: `queued-awaiting-all-production-live-evidence`");
    expect(output).toContain("Do not include raw URLs, local paths, cookie values, response bodies, or credential values.");
    expect(output).toContain("## Copy-Safe Owner Reply Stub");
    expect(output).toContain("<label only; no URL, local path, cookie, or credential value>");
    expect(output).toContain("## Validation Command");
    expect(output).toContain(
      "node scripts/owner-decision-enterprise-live-evidence-audit-response-validation.mjs --owner-response-template coordination/reports/<this-template-json> --owner-response path/to/filled-owner-response.json",
    );
    expect(output).toContain("`app-auth-provider-readiness`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-audit.example.test");
    expect(output).not.toContain("<production-live-date>");
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
      { rank: 6, id: "manual-ppt-playback-acceptance", status: "human-qa-needed" },
      {
        rank: 7,
        id: "enterprise-live-evidence-audit",
        status: "waiting-for-live-evidence",
        category: "evidence-audit",
        nextOwnerQuestion:
          "Run the enterprise live evidence audit only after all approved production live evidence files exist.",
      },
    ],
    leakedPath: "/Users/example/private/queue.json",
  };
}

function buildActionPacket() {
  return {
    target: "enterprise-live-evidence-audit-action-packet",
    status: "waiting-for-live-evidence",
    responsibleSession: "S22",
    decisionId: "enterprise-live-evidence-audit",
    queueRank: 7,
    forbiddenUntilApproved: [
      "mark-enterprise-audit-ready-with-missing-required-targets",
      "accept-filename-only-production-live-evidence",
      "accept-mismatched-release-run-id-production-evidence",
      "publish-audit-with-local-private-paths-or-raw-urls",
      "treat-local-or-dry-run-evidence-as-live-production-evidence",
    ],
    requiredEvidence: [
      "body-level-production-live-evidence-audit-proof",
      "all-orchestrated-production-live-targets-present",
      "shared-release-run-id-across-production-live-evidence",
      "required-production-live-safety-redaction-flags",
      "target-specific-result-proof-keys-body-proven",
      "target-specific-contract-proof-keys-body-proven",
      "filename-only-production-live-evidence-rejected",
    ],
    requiredTargets: requiredTargets(),
    missingRequiredTargets: requiredTargets(),
    commands: {
      runEnterpriseAudit:
        "node scripts/enterprise-live-evidence-audit.mjs --date <production-live-date> --output <enterprise-live-evidence-audit-output>",
      refreshReleaseGateWithAudit:
        "node scripts/production-e2e-release-gate.mjs --enterprise-live-evidence-audit <enterprise-live-evidence-audit-output>",
    },
    currentEvidenceSummary: {
      evidenceStatus: "blocked",
      totalProductionLiveNamed: 16,
      acceptedLiveEvidence: 0,
      filenameOnlyOrBlocked: 16,
      releaseRunIdConsistency: "missing",
      requiredTargetProofStatus: "missing",
      requiredTargetResultCriteriaStatus: "proved",
      requiredTargetContractCriteriaStatus: "missing",
      missingRequiredTargetCount: 16,
    },
    leakedUrl: "https://private-audit.example.test/evidence",
    leakedCookie: "uais_teacher_auth_claims=secret-cookie-value",
  };
}

function requiredTargets() {
  return [
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
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
