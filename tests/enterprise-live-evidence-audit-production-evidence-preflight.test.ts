import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("enterprise live evidence audit production evidence preflight", () => {
  it("keeps the enterprise audit waiting until all production live targets are body-proven", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-preflight-"));
    const requiredTargets = [
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
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      target: "owner-decision-enterprise-live-evidence-audit-response-validation",
      status: "owner-response-incomplete",
      decisionId: "enterprise-live-evidence-audit",
      summary: {
        missingFieldCount: 7,
        unsafeFindingCount: 0,
        auditMayProceedAfterEvidenceVerification: false,
        releaseGateRefreshMayProceedAfterAudit: false,
        releaseRunBindingStillForbidden: true,
        releaseReady: false,
      },
      requiredEvidenceAfterApproval: [
        "body-level-production-live-evidence-audit-proof",
        "all-orchestrated-production-live-targets-present",
        "shared-release-run-id-across-production-live-evidence",
        "required-production-live-safety-redaction-flags",
        "target-specific-result-proof-keys-body-proven",
        "target-specific-contract-proof-keys-body-proven",
        "filename-only-production-live-evidence-rejected",
      ],
      requiredCommandNames: ["runEnterpriseAudit", "refreshReleaseGateWithAudit"],
      stillForbiddenUntilSeparateApproval: [
        "run-enterprise-live-evidence-audit-before-all-target-evidence-exists",
        "refresh-production-release-gate-with-missing-enterprise-audit",
        "bind-production-release-run-id-while-release-gate-blocked",
      ],
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", {
      target: "owner-decision-live-run-approval-gate",
      status: "approval-gate-blocked",
      stages: [
        {
          id: "enterprise-live-evidence-audit",
          queueStatus: "waiting-for-live-evidence",
          currentStatus: "waiting-for-live-evidence",
          ownerResponseAccepted: false,
          requiredEvidence: [
            "enterprise-live-evidence-audit",
            "body-level-production-live-evidence-audit-proof",
            "shared-release-run-id-across-production-live-evidence",
          ],
        },
      ],
    });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {
      target: "enterprise-live-evidence-audit-action-packet",
      decisionId: "enterprise-live-evidence-audit",
      requiredEvidence: [
        "body-level-production-live-evidence-audit-proof",
        "all-orchestrated-production-live-targets-present",
        "shared-release-run-id-across-production-live-evidence",
        "required-production-live-safety-redaction-flags",
        "target-specific-result-proof-keys-body-proven",
        "target-specific-contract-proof-keys-body-proven",
        "filename-only-production-live-evidence-rejected",
      ],
      requiredTargets,
      missingRequiredTargets: requiredTargets,
      currentEvidenceSummary: {
        evidenceStatus: "blocked",
        totalProductionLiveNamed: 16,
        acceptedLiveEvidence: 0,
        filenameOnlyOrBlocked: 16,
        releaseRunIdConsistency: "missing",
        sharedReleaseRunIdStatus: "missing",
        missingRequiredTargetCount: 16,
      },
      commands: {
        runEnterpriseAudit:
          "node scripts/enterprise-live-evidence-audit.mjs --reports-dir coordination/reports --date <production-live-date> --output <enterprise-live-evidence-audit-output>",
        refreshReleaseGateWithAudit:
          "node -- scripts/production-e2e-release-gate.mjs <release-gate-inputs> --enterprise-live-evidence-audit <enterprise-live-evidence-audit-output> > <production-e2e-release-gate-output>",
      },
      safeNextActions: [
        "wait-for-approved-production-live-evidence-files",
        "run-enterprise-live-evidence-audit-after-all-target-evidence-exists",
      ],
      forbiddenUntilApproved: [
        "mark-enterprise-audit-ready-with-missing-required-targets",
        "accept-filename-only-production-live-evidence",
      ],
    });
    const triage = writeJson(tmpDir, "triage.json", {
      target: "enterprise-live-evidence-triage",
      status: "blocked",
      releaseGateStatus: "blocked",
      summary: {
        totalTargets: 16,
        acceptedTargets: 0,
        blockedTargets: 16,
        missingRequiredTargets: 16,
        releaseRunIdConsistency: "missing",
        sharedReleaseRunIdStatus: "missing",
      },
      missingRequiredTargets: requiredTargets,
    });
    const appAuthPreflight = writePreflight(tmpDir, "app-auth.json", {
      status: "app-auth-production-evidence-preflight-ready",
      releaseReady: false,
      missingEvidenceCount: 3,
    });
    const teacherAuthPreflight = writePreflight(tmpDir, "teacher-auth.json", {
      status: "teacher-auth-production-evidence-preflight-waiting-for-upstream-app-auth",
      releaseReady: false,
      missingEvidenceCount: 4,
    });
    const externalStoragePreflight = writePreflight(tmpDir, "external-storage.json", {
      status: "external-storage-production-evidence-preflight-waiting-for-upstream-auth",
      releaseReady: false,
      missingEvidenceCount: 5,
    });
    const vercelPreflight = writePreflight(tmpDir, "vercel.json", {
      status:
        "vercel-env-deploy-production-evidence-preflight-waiting-for-upstream-provider-evidence",
      releaseReady: false,
      missingEvidenceCount: 12,
    });
    const manualPptPreflight = writePreflight(tmpDir, "manual-ppt.json", {
      status:
        "manual-ppt-playback-acceptance-production-evidence-preflight-waiting-for-production-deployment-binding",
      releaseReady: false,
      missingEvidenceCount: 2,
    });
    const ordinaryTeachingPreflight = writePreflight(tmpDir, "ordinary-teaching.json", {
      status:
        "ordinary-teaching-production-evidence-preflight-waiting-for-upstream-production-evidence",
      releaseReady: false,
      missingEvidenceCount: 8,
    });

    const output = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--enterprise-audit-action-packet",
      actionPacket,
      "--enterprise-live-evidence-triage",
      triage,
      "--app-auth-preflight",
      appAuthPreflight,
      "--teacher-auth-preflight",
      teacherAuthPreflight,
      "--external-storage-preflight",
      externalStoragePreflight,
      "--vercel-env-deploy-preflight",
      vercelPreflight,
      "--manual-ppt-preflight",
      manualPptPreflight,
      "--ordinary-teaching-preflight",
      ordinaryTeachingPreflight,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "enterprise-live-evidence-audit-production-evidence-preflight",
        status:
          "enterprise-live-evidence-audit-production-evidence-preflight-waiting-for-required-live-evidence",
        releaseReady: false,
        ownerDecisionId: "enterprise-live-evidence-audit",
      }),
    );
    expect(body.summary).toEqual({
      ownerResponseAccepted: false,
      auditStageWaitingForLiveEvidence: true,
      liveEvidenceTargetsCleared: false,
      upstreamProductionPreflightsCleared: false,
      releaseRunConsistencyCleared: false,
      releaseRunBindingStillForbidden: true,
      requiredTargetCount: 16,
      acceptedLiveEvidenceCount: 0,
      missingRequiredTargetCount: 16,
      requiredEvidenceCount: 8,
      commandTemplateCount: 2,
      releaseReady: false,
    });
    expect(body.upstreamBlockers).toEqual([
      "app-auth-production-evidence-not-cleared",
      "teacher-auth-production-evidence-not-cleared",
      "external-storage-production-evidence-not-cleared",
      "vercel-production-deployment-evidence-not-cleared",
      "manual-ppt-production-binding-not-cleared",
      "ordinary-teaching-production-evidence-not-cleared",
    ]);
    expect(body.missingRequiredTargets).toEqual(requiredTargets);
    expect(body.blockedReasons).toContain("enterprise-live-required-targets-missing");
    expect(body.blockedReasons).toContain("release-run-consistency-not-cleared");
    expect(body.blockedReasons).toContain("enterprise-audit-owner-response-not-accepted");
    expect(body.safety).toEqual(
      expect.objectContaining({
        envFileRead: false,
        rawUrlsOmittedFromMarkdown: true,
        cookieValuesOmitted: true,
        credentialValuesOmitted: true,
        responseBodiesOmitted: true,
        liveAuditRun: false,
        noLiveMutationPerformed: true,
        noDeploymentMutationPerformed: true,
        noReleaseRunBindingPerformed: true,
      }),
    );

    const markdown = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--enterprise-audit-action-packet",
      actionPacket,
      "--enterprise-live-evidence-triage",
      triage,
      "--app-auth-preflight",
      appAuthPreflight,
      "--teacher-auth-preflight",
      teacherAuthPreflight,
      "--external-storage-preflight",
      externalStoragePreflight,
      "--vercel-env-deploy-preflight",
      vercelPreflight,
      "--manual-ppt-preflight",
      manualPptPreflight,
      "--ordinary-teaching-preflight",
      ordinaryTeachingPreflight,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("# UAIS Enterprise Live Evidence Audit Production Evidence Preflight");
    expect(markdown).toContain(
      "Status: `enterprise-live-evidence-audit-production-evidence-preflight-waiting-for-required-live-evidence`",
    );
    expect(markdown).toContain("## Missing Required Targets");
    expect(markdown).toContain("## Safe Command Templates");
    expect(markdown).not.toContain("https://");
    expect(markdown).not.toContain("/Users/");
    expect(markdown).not.toContain("<production-live-date>");
  });

  it("stays blocked when the enterprise audit stage is not present in the approval gate", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-preflight-blocked-"));
    const ownerResponseValidation = writeJson(tmpDir, "owner-response-validation.json", {
      status: "owner-response-incomplete",
      summary: { releaseRunBindingStillForbidden: true },
    });
    const approvalGate = writeJson(tmpDir, "approval-gate.json", { stages: [] });
    const actionPacket = writeJson(tmpDir, "action-packet.json", {});
    const triage = writeJson(tmpDir, "triage.json", { summary: {} });

    const output = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit-production-evidence-preflight.mjs",
      "--owner-response-validation",
      ownerResponseValidation,
      "--approval-gate",
      approvalGate,
      "--enterprise-audit-action-packet",
      actionPacket,
      "--enterprise-live-evidence-triage",
      triage,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe(
      "enterprise-live-evidence-audit-production-evidence-preflight-blocked",
    );
    expect(body.summary.auditStageWaitingForLiveEvidence).toBe(false);
    expect(body.blockedReasons).toContain("enterprise-audit-stage-not-waiting-for-live-evidence");
  });
});

function writePreflight(
  dir: string,
  fileName: string,
  value: { status: string; releaseReady: boolean; missingEvidenceCount: number },
) {
  return writeJson(dir, fileName, {
    status: value.status,
    releaseReady: value.releaseReady,
    summary: {
      missingEvidenceCount: value.missingEvidenceCount,
    },
  });
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
