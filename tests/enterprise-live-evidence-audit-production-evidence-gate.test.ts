import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const releaseRunId = "UAIS-enterprise-run-2026-07-XX";
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
const provedEvidence = [
  "body-level-production-live-evidence-audit-proof",
  "all-orchestrated-production-live-targets-present",
  "shared-release-run-id-across-production-live-evidence",
  "required-production-live-safety-redaction-flags",
  "target-specific-result-proof-keys-body-proven",
  "target-specific-contract-proof-keys-body-proven",
  "filename-only-production-live-evidence-rejected",
];

describe("enterprise live evidence audit production evidence gate", () => {
  it("keeps the enterprise audit gate waiting until required live evidence exists", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-gate-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "enterprise-live-evidence-audit-production-evidence-preflight",
      status: "enterprise-live-evidence-audit-production-evidence-preflight-waiting-for-required-live-evidence",
      summary: {
        ownerResponseAccepted: false,
        auditStageWaitingForLiveEvidence: true,
        liveEvidenceTargetsCleared: false,
        upstreamProductionPreflightsCleared: false,
        releaseRunConsistencyCleared: false,
        releaseRunBindingStillForbidden: true,
        requiredTargetCount: 16,
        acceptedLiveEvidenceCount: 0,
        missingRequiredTargetCount: 16,
        releaseReady: false,
      },
      missingRequiredTargets: requiredTargets,
      requiredEvidence: provedEvidence,
    });
    const ordinaryTeachingGatePath = writeJson(reportsDir, "ordinary-teaching-gate.json", {
      target: "ordinary-teaching-production-evidence-gate",
      status: "ordinary-teaching-production-evidence-gate-waiting-for-upstream-production-evidence",
      summary: {
        operatorInputRequired: true,
        blockingInputRequired: true,
        ordinaryTeachingProductionEvidenceCleared: false,
        releaseReady: false,
      },
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamBlockingEvidence: {
        id: "upstream-vercel-env-deploy-production-evidence-gate",
        valuesForbidden: true,
        upstreamMissingEvidence: ["approved-env-source-path"],
        upstreamOperatorInputPacket: {
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
        },
        upstreamSafeCommandTemplates: {
          approvedSourceHandleIntake:
            "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
        },
      },
      sourceEvidenceHandle: "/Users/private/approved-app-auth.env",
    });

    const output = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit-production-evidence-gate.mjs",
      "--enterprise-audit-preflight",
      preflightPath,
      "--ordinary-teaching-production-evidence-gate",
      ordinaryTeachingGatePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "enterprise-live-evidence-audit-production-evidence-gate",
        status:
          "enterprise-live-evidence-audit-production-evidence-gate-waiting-for-required-live-evidence",
        releaseReady: false,
        responsibleSession: "S22/S10/S25",
        summary: {
          operatorInputRequired: true,
          blockingInputRequired: true,
          ownerResponseAccepted: false,
          liveEvidenceTargetsCleared: false,
          upstreamProductionPreflightsCleared: false,
          releaseRunConsistencyCleared: false,
          preflightReady: false,
          auditReportProvided: false,
          auditReportAccepted: false,
          requiredTargetCount: 16,
          acceptedLiveEvidenceCount: 0,
          missingRequiredTargetCount: 16,
          filenameOnlyOrBlocked: 16,
          releaseRunBound: false,
          enterpriseLiveEvidenceAuditCleared: false,
          releaseReady: false,
        },
        auditReportStatus: {
          target: "enterprise-live-evidence-audit",
          status: "missing",
          releaseRunIdConsistency: "missing",
          sharedReleaseRunIdStatus: "missing",
          valueRedacted: true,
        },
        blockedReasons: [
          "enterprise-live-required-targets-missing",
          "upstream-production-preflights-not-cleared",
          "release-run-consistency-not-cleared",
          "enterprise-audit-owner-response-not-accepted",
          "enterprise-live-evidence-audit-report-missing",
        ],
      }),
    );
    expect(body.upstreamBlockingEvidence).toEqual({
      id: "upstream-ordinary-teaching-production-evidence-gate",
      label: "ordinary-teaching-production-evidence-gate",
      reason:
        "Enterprise live evidence audit must wait for all upstream production evidence gates before the final live-evidence audit can be requested.",
      valuesForbidden: true,
      upstreamStatus:
        "ordinary-teaching-production-evidence-gate-waiting-for-upstream-production-evidence",
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamOperatorInputRequired: true,
      upstreamMissingEvidence: ["approved-env-source-path"],
      upstreamOperatorInputPacket: {
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
      },
      upstreamSafeCommandTemplates: {
        approvedSourceHandleIntake:
          "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
      },
    });
    expect(body.safeNextAction).toBe("provide-approved-env-source-path-to-s19");
    expect(body.provedEvidence).toEqual([]);
    expect(body.safety).toEqual({
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      fileNamesOmitted: true,
      cookieValuesOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      liveAuditRun: false,
      releaseGateRefreshPerformed: false,
      noRemoteWritePerformed: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
      filenameOnlyEvidenceRejected: true,
      liveEvidenceRequired: true,
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit-production-evidence-gate.mjs",
      "--enterprise-audit-preflight",
      preflightPath,
      "--ordinary-teaching-production-evidence-gate",
      ordinaryTeachingGatePath,
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

  it("clears only with a ready audit report proving every target under one release run", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-enterprise-audit-gate-ready-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeFileName = "2026-07-02-private-production-live.json";
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "enterprise-live-evidence-audit-production-evidence-preflight",
      status: "enterprise-live-evidence-audit-production-evidence-preflight-ready",
      summary: {
        ownerResponseAccepted: true,
        auditStageWaitingForLiveEvidence: true,
        liveEvidenceTargetsCleared: true,
        upstreamProductionPreflightsCleared: true,
        releaseRunConsistencyCleared: true,
        releaseRunBindingStillForbidden: true,
        requiredTargetCount: 16,
        acceptedLiveEvidenceCount: 16,
        missingRequiredTargetCount: 0,
        releaseReady: false,
      },
      requiredTargets,
      requiredEvidence: provedEvidence,
    });
    const auditReportPath = writeJson(reportsDir, "audit.json", {
      target: "enterprise-live-evidence-audit",
      date: "2026-07-02",
      status: "ready",
      summary: {
        totalProductionLiveNamed: 16,
        acceptedLiveEvidence: 16,
        filenameOnlyOrBlocked: 0,
        releaseRunIdConsistency: "matched",
        sharedReleaseRunIdStatus: "present",
        distinctReleaseRunIdCount: 1,
        requiredTargetProofStatus: "proved",
        missingRequiredTargetCount: 0,
        unexpectedTargetCount: 0,
        unexpectedEvidenceFileCount: 0,
      },
      requiredTargets,
      acceptedTargets: requiredTargets,
      missingRequiredTargets: [],
      unexpectedTargets: [],
      unexpectedEvidenceFiles: [fakeFileName],
      rows: requiredTargets.map((target) => ({
        file: `${target}-production-live.json`,
        target,
        acceptanceStatus: "accepted-live-evidence",
        releaseRunIdStatus: "present",
        safetyStatus: "proved",
        targetResultStatus: "proved",
        targetEnvStatus: "not-required",
        targetContractStatus: "not-required",
      })),
      blockedReasons: [],
      safety: {
        valuesRedacted: true,
        cookieValuesOmitted: true,
        localPathsOmitted: true,
        fileNamesOnly: true,
        responseBodiesOmitted: true,
      },
      releaseRunId,
    });

    const output = execFileSync("node", [
      "scripts/enterprise-live-evidence-audit-production-evidence-gate.mjs",
      "--enterprise-audit-preflight",
      preflightPath,
      "--enterprise-audit-report",
      auditReportPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("enterprise-live-evidence-audit-production-evidence-gate-cleared");
    expect(body.releaseReady).toBe(false);
    expect(body.summary).toEqual({
      operatorInputRequired: false,
      blockingInputRequired: false,
      ownerResponseAccepted: true,
      liveEvidenceTargetsCleared: true,
      upstreamProductionPreflightsCleared: true,
      releaseRunConsistencyCleared: true,
      preflightReady: true,
      auditReportProvided: true,
      auditReportAccepted: true,
      requiredTargetCount: 16,
      acceptedLiveEvidenceCount: 16,
      missingRequiredTargetCount: 0,
      filenameOnlyOrBlocked: 0,
      releaseRunBound: true,
      enterpriseLiveEvidenceAuditCleared: true,
      releaseReady: false,
    });
    expect(body.auditReportStatus).toEqual({
      target: "enterprise-live-evidence-audit",
      status: "ready",
      releaseRunIdConsistency: "matched",
      sharedReleaseRunIdStatus: "present",
      valueRedacted: true,
    });
    expect(body.provedEvidence).toEqual(provedEvidence);
    expect(body.safeNextAction).toBe("advance-production-release-run-preflight");
    expect(output).not.toContain(fakeFileName);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}
