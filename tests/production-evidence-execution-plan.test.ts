import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production evidence execution plan", () => {
  it("identifies app-auth as the first safe evidence step while blocking env reads and remote mutation", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-evidence-plan-"));
    const gapMatrix = writeJson(tmpDir, "gap-matrix.json", {
      target: "owner-decision-response-gap-matrix",
      status: "owner-response-gaps-present",
      summary: {
        actionClassCounts: {
          acceptedAwaitingProductionEvidence: 5,
          awaitingProductionEvidenceLabels: 3,
          needsOwnerInput: 0,
          safetyReview: 0,
          releaseReady: 0,
        },
        releaseReady: false,
      },
      gapRows: [
        {
          rank: 1,
          decisionId: "app-auth-provider-production-selector",
          actionClass: "accepted-awaiting-production-evidence",
          nextSafeAction: "collect-production-evidence",
        },
        {
          rank: 2,
          decisionId: "teacher-auth-provider-production-selector",
          actionClass: "accepted-awaiting-production-evidence",
          nextSafeAction: "collect-production-evidence",
        },
        {
          rank: 5,
          decisionId: "ordinary-teaching-production-evidence",
          actionClass: "awaiting-production-evidence-labels",
          nextSafeAction: "collect-evidence-labels-after-live-proof",
        },
      ],
    });
    const appAuthPreflight = writeJson(tmpDir, "app-auth-preflight.json", {
      target: "app-auth-production-evidence-preflight",
      status: "app-auth-production-evidence-preflight-ready",
      releaseReady: false,
      ownerDecisionId: "app-auth-provider-production-selector",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      summary: {
        ownerResponseAccepted: true,
        s19DryRunMayProceed: true,
        s22ReadinessMayProceedAfterEnvSync: true,
        missingEvidenceCount: 3,
        releaseReady: false,
      },
      missingEvidence: [
        "vercel-env-sync-evidence-with-app-auth-env-present",
        "app-auth-provider-readiness-production-live-ready",
        "same-release-run-id-bound-to-app-auth-readiness",
      ],
      safeCommandTemplates: {
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-dry-run-evidence>",
        appAuthReadiness:
          "node scripts/app-auth-provider-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> > <app-auth-provider-readiness-evidence>",
      },
    });
    const appAuthEnvSourceIntake = writeJson(tmpDir, "app-auth-env-source-intake.json", {
      target: "app-auth-env-source-intake",
      status: "app-auth-env-source-intake-awaiting-approved-source-path",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      summary: {
        ownerInputRequired: false,
        operatorInputRequired: true,
        blockingInputRequired: true,
        readyForVercelEnvSyncDryRun: false,
        releaseReady: false,
      },
      blockingInput: {
        id: "approved-env-source-path",
        label: "UAIS-production-app-auth-env-source",
        reason:
          "S19 can read app-auth env names only after the approved server-only env source is available as a local path or evidence handle without exposing values.",
        valuesForbidden: true,
      },
      operatorInputPacket: {
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
        preferredInputMode: "approved-source-handle",
        safeInputInstruction:
          "Provide an approved source handle or approved env-file presence proof to S19 only; do not paste raw values, URLs, cookies, credentials, or unredacted local paths into reports or chat.",
        approvedSourceLabelIsNotEvidence: true,
        valuesForbidden: true,
      },
      blockedReasons: ["approved-env-source-path-required"],
      missingEvidence: ["approved-env-source-path"],
      deferredMissingEvidence: [
        "vercel-env-sync-evidence-with-app-auth-env-present",
        "app-auth-provider-readiness-production-live-ready",
        "same-release-run-id-bound-to-app-auth-readiness",
      ],
    });
    const teacherAuthPreflight = writeJson(tmpDir, "teacher-auth-preflight.json", {
      target: "teacher-auth-production-evidence-preflight",
      status: "teacher-auth-production-evidence-preflight-waiting-for-upstream-app-auth",
      releaseReady: false,
      ownerDecisionId: "teacher-auth-provider-production-selector",
      summary: {
        ownerResponseAccepted: true,
        upstreamAppAuthEvidenceCleared: false,
        releaseReady: false,
      },
      blockedReasons: ["upstream-app-auth-production-evidence-not-cleared"],
    });
    const externalStoragePreflight = writeJson(tmpDir, "external-storage-preflight.json", {
      target: "external-storage-production-evidence-preflight",
      status: "external-storage-production-evidence-preflight-waiting-for-upstream-auth",
      releaseReady: false,
      ownerDecisionId: "external-storage-production-service",
      summary: { upstreamAuthEvidenceCleared: false, releaseReady: false },
      blockedReasons: ["upstream-auth-production-evidence-not-cleared"],
    });
    const vercelPreflight = writeJson(tmpDir, "vercel-preflight.json", {
      target: "vercel-env-deploy-production-evidence-preflight",
      status:
        "vercel-env-deploy-production-evidence-preflight-waiting-for-upstream-provider-evidence",
      releaseReady: false,
      ownerDecisionId: "vercel-env-deploy-and-smoke-chain",
      summary: { upstreamProviderEvidenceCleared: false, releaseReady: false },
      blockedReasons: ["upstream-provider-production-evidence-not-cleared"],
    });
    const manualPptPreflight = writeJson(tmpDir, "manual-ppt-preflight.json", {
      target: "manual-ppt-playback-acceptance-production-evidence-preflight",
      status:
        "manual-ppt-playback-acceptance-production-evidence-preflight-waiting-for-production-deployment-binding",
      releaseReady: false,
      ownerDecisionId: "manual-ppt-playback-acceptance",
      blockedReasons: ["vercel-production-deployment-evidence-not-cleared"],
    });
    const ordinaryPreflight = writeJson(tmpDir, "ordinary-preflight.json", {
      target: "ordinary-teaching-production-evidence-preflight",
      status: "ordinary-teaching-production-evidence-preflight-waiting-for-upstream-production-evidence",
      releaseReady: false,
      ownerDecisionId: "ordinary-teaching-production-evidence",
      blockedReasons: ["upstream-production-evidence-not-cleared"],
    });
    const enterpriseAuditPreflight = writeJson(tmpDir, "enterprise-audit-preflight.json", {
      target: "enterprise-live-evidence-audit-production-evidence-preflight",
      status:
        "enterprise-live-evidence-audit-production-evidence-preflight-waiting-for-required-live-evidence",
      releaseReady: false,
      ownerDecisionId: "enterprise-live-evidence-audit",
      blockedReasons: ["enterprise-live-required-targets-missing"],
    });
    const productionReleasePreflight = writeJson(tmpDir, "release-run-preflight.json", {
      target: "production-release-run-production-evidence-preflight",
      status: "production-release-run-production-evidence-preflight-waiting-for-final-release-gate",
      releaseReady: false,
      ownerDecisionId: "production-release-run",
      blockedReasons: ["final-release-gate-not-ready"],
    });

    const output = execFileSync("node", [
      "scripts/production-evidence-execution-plan.mjs",
      "--gap-matrix",
      gapMatrix,
      "--app-auth-preflight",
      appAuthPreflight,
      "--app-auth-env-source-intake",
      appAuthEnvSourceIntake,
      "--teacher-auth-preflight",
      teacherAuthPreflight,
      "--external-storage-preflight",
      externalStoragePreflight,
      "--vercel-env-deploy-preflight",
      vercelPreflight,
      "--manual-ppt-preflight",
      manualPptPreflight,
      "--ordinary-teaching-preflight",
      ordinaryPreflight,
      "--enterprise-audit-preflight",
      enterpriseAuditPreflight,
      "--production-release-run-preflight",
      productionReleasePreflight,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "production-evidence-execution-plan",
        status: "production-evidence-execution-plan-awaiting-approved-env-source-path",
        releaseReady: false,
        firstWorkstreamId: "app-auth-provider-production-selector",
        firstSafeAction: "provide-approved-env-source-path-to-s19",
      }),
    );
    expect(body.summary).toEqual({
      ownerInputRequired: false,
      operatorInputRequired: true,
      blockingInputRequired: true,
      acceptedAwaitingProductionEvidence: 5,
      awaitingProductionEvidenceLabels: 3,
      needsOwnerInput: 0,
      phaseCount: 8,
      releaseReady: false,
    });
    expect(body.blockingInput).toEqual({
      id: "approved-env-source-path",
      label: "UAIS-production-app-auth-env-source",
      reason:
        "S19 can read app-auth env names only after the approved server-only env source is available as a local path or evidence handle without exposing values.",
      valuesForbidden: true,
    });
    expect(body.operatorInputPacket).toEqual({
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
      preferredInputMode: "approved-source-handle",
      safeInputInstruction:
        "Provide an approved source handle or approved env-file presence proof to S19 only; do not paste raw values, URLs, cookies, credentials, or unredacted local paths into reports or chat.",
      approvedSourceLabelIsNotEvidence: true,
      valuesForbidden: true,
    });
    expect(body.phases[0]).toEqual(
      expect.objectContaining({
        id: "app-auth-provider-production-selector",
        status: "ready-for-s19-env-sync-dry-run",
        nextSafeAction: "provide-approved-env-source-path-to-s19",
        missingEvidence: ["approved-env-source-path"],
        blockedReasons: ["approved-env-source-path-required"],
        deferredMissingEvidence: [
          "vercel-env-sync-evidence-with-app-auth-env-present",
          "app-auth-provider-readiness-production-live-ready",
          "same-release-run-id-bound-to-app-auth-readiness",
        ],
      }),
    );
    expect(body.phases[0].safeCommandTemplates).toEqual(
      expect.objectContaining({
        vercelEnvSyncDryRun: expect.stringContaining("<approved-env-file>"),
        appAuthReadiness: expect.stringContaining("<vercel-env-sync-evidence>"),
      }),
    );
    expect(body.phases[1]).toEqual(
      expect.objectContaining({
        id: "teacher-auth-provider-production-selector",
        status: "waiting-for-upstream-app-auth",
        nextSafeAction: "provide-approved-env-source-path-to-s19",
      }),
    );
    expect(body.phases.slice(1).every((phase) => phase.nextSafeAction === body.firstSafeAction)).toBe(
      true,
    );
    expect(body.safety).toEqual(
      expect.objectContaining({
        envFileRead: false,
        vercelApiCalled: false,
        noEnvApplyPerformed: true,
        noDeploymentMutationPerformed: true,
        noLiveSmokePerformed: true,
        noReleaseRunBindingPerformed: true,
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
