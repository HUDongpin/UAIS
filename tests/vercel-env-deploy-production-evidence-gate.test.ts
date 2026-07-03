import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const releaseRunId = "UAIS-enterprise-run-2026-07-XX";
const deploymentFingerprint = "sha256:vercel-production-deployment-fingerprint";
const smokeTargets = [
  "deployment-route-smoke",
  "teacher-workflow-deployment-smoke",
  "teacher-workflow-browser-smoke",
  "teacher-workflow-live-generation-smoke",
  "learning-ppt-playback-deployment-smoke",
  "teaching-operations-route-smoke",
  "teaching-operation-detail-browser-smoke",
  "teaching-course-management-route-smoke",
];

describe("vercel env deploy production evidence gate", () => {
  it("waits for upstream provider evidence and does not leak source paths", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-deploy-gate-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "vercel-env-deploy-production-evidence-preflight",
      status:
        "vercel-env-deploy-production-evidence-preflight-waiting-for-upstream-provider-evidence",
      approvedVercelProjectReadinessLabel: "UAIS-Vercel-project-readiness-approved",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-server-only-env-source-set",
      approvedVercelEnvSyncApplyEvidenceLabel:
        "UAIS-S19-Vercel-env-sync-apply-evidence-label",
      approvedProductionDeploymentEvidenceLabel:
        "UAIS-S22-production-deployment-evidence-label",
      approvedDeploymentBaseUrlLabel: "UAIS-production-deployment-base-url-label",
      approvedReleaseRunIdLabel: releaseRunId,
      summary: {
        upstreamProviderEvidenceCleared: false,
        liveChainStillForbidden: true,
        releaseReady: false,
      },
    });
    const externalStorageGatePath = writeJson(reportsDir, "external-storage-gate.json", {
      target: "external-storage-production-evidence-gate",
      status: "external-storage-production-evidence-gate-waiting-for-upstream-auth",
      summary: {
        operatorInputRequired: true,
        blockingInputRequired: true,
        externalStorageProductionEvidenceCleared: false,
        releaseReady: false,
      },
      safeNextAction: "provide-approved-env-source-path-to-s19",
      blockedReasons: ["upstream-auth-production-evidence-not-cleared"],
      upstreamBlockingEvidence: {
        id: "upstream-external-storage-vercel-env-sync-evidence-gate",
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
      "scripts/vercel-env-deploy-production-evidence-gate.mjs",
      "--vercel-env-deploy-preflight",
      preflightPath,
      "--external-storage-production-evidence-gate",
      externalStorageGatePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-env-deploy-production-evidence-gate",
        status:
          "vercel-env-deploy-production-evidence-gate-waiting-for-upstream-provider-evidence",
        releaseReady: false,
        responsibleSession: "S19/S22",
        approvedVercelProjectReadinessLabel: "UAIS-Vercel-project-readiness-approved",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-server-only-env-source-set",
        approvedVercelEnvSyncApplyEvidenceLabel:
          "UAIS-S19-Vercel-env-sync-apply-evidence-label",
        approvedProductionDeploymentEvidenceLabel:
          "UAIS-S22-production-deployment-evidence-label",
        approvedDeploymentBaseUrlLabel: "UAIS-production-deployment-base-url-label",
        approvedReleaseRunIdLabel: releaseRunId,
        summary: {
          ownerInputRequired: false,
          operatorInputRequired: true,
          blockingInputRequired: true,
          upstreamProviderEvidenceRequired: true,
          upstreamProviderEvidenceCleared: false,
          preflightReady: false,
          envSyncEvidenceProvided: false,
          envSyncEvidenceAccepted: false,
          productionDeploymentEvidenceProvided: false,
          productionDeploymentEvidenceAccepted: false,
          deploymentReachabilityEvidenceProvided: false,
          deploymentReachabilityEvidenceAccepted: false,
          deployedSmokeEvidenceProvidedCount: 0,
          deployedSmokeEvidenceAcceptedCount: 0,
          releaseRunBound: false,
          vercelEnvDeployProductionEvidenceCleared: false,
          liveChainStillForbidden: true,
          releaseReady: false,
        },
        envSyncEvidenceStatus: {
          target: "missing",
          status: "missing",
          releaseRunIdStatus: "missing",
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
        deploymentReachabilityEvidenceStatus: {
          target: "missing",
          status: "missing",
          environment: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
      }),
    );
    expect(body.deployedSmokeEvidenceStatuses).toHaveLength(smokeTargets.length);
    expect(body.deployedSmokeEvidenceStatuses.every((status: { status: string }) => status.status === "missing")).toBe(true);
    expect(body.blockedReasons).toEqual([
      "upstream-provider-production-evidence-not-cleared",
    ]);
    expect(body.upstreamBlockingEvidence).toEqual({
      id: "upstream-provider-production-evidence",
      label: "app-auth-teacher-auth-external-storage-production-evidence",
      reason:
        "Vercel env/deploy production evidence must wait for app-auth, teacher-auth, and external-storage production evidence before S19/S22 run or accept Vercel env apply, deploy, or deployed smoke evidence.",
      valuesForbidden: true,
      upstreamStatus:
        "vercel-env-deploy-production-evidence-preflight-waiting-for-upstream-provider-evidence",
      upstreamBlockedReasons: [
        "upstream-provider-production-evidence-not-cleared",
      ],
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
    expect(body.safety).toEqual({
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      deploymentUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      providerNetworkCallPerformed: false,
      noRemoteWritePerformed: true,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/vercel-env-deploy-production-evidence-gate.mjs",
      "--vercel-env-deploy-preflight",
      preflightPath,
      "--external-storage-production-evidence-gate",
      externalStorageGatePath,
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

  it("clears only with env sync, production deployment, reachability, deployed smokes, and one release-run binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-deploy-gate-ready-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeUrl = "https://uais-production.example.test";
    const fakeSecret = "vercel-env-deploy-secret-must-not-appear";
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "vercel-env-deploy-production-evidence-preflight",
      status: "vercel-env-deploy-production-evidence-preflight-ready",
      approvedVercelProjectReadinessLabel: "UAIS-Vercel-project-readiness-approved",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-server-only-env-source-set",
      approvedVercelEnvSyncApplyEvidenceLabel:
        "UAIS-S19-Vercel-env-sync-apply-evidence-label",
      approvedProductionDeploymentEvidenceLabel:
        "UAIS-S22-production-deployment-evidence-label",
      approvedDeploymentBaseUrlLabel: "UAIS-production-deployment-base-url-label",
      approvedReleaseRunIdLabel: releaseRunId,
      summary: {
        upstreamProviderEvidenceCleared: true,
        liveChainStillForbidden: true,
        releaseReady: false,
      },
    });
    const envSyncPath = writeJson(reportsDir, "env-sync.json", {
      target: "vercel-env-sync",
      mode: "apply",
      status: "matched",
      releaseRunId,
      projectReadinessEvidenceStatus: "ready",
      applyPreflight: "proved",
      targets: ["production", "preview"],
      rawVercelToken: fakeSecret,
      valueRedacted: true,
      envValuesEmitted: false,
      requiredEnvStatus: "present",
    });
    const deploymentPath = writeJson(reportsDir, "deployment.json", {
      target: "vercel-production-deployment",
      mode: "live",
      environment: "production",
      status: "deployed",
      releaseRunId,
      rawDeploymentUrl: fakeUrl,
      rawVercelToken: fakeSecret,
      deploymentObservationStatus: "observed",
      deploymentUrlClass: "remote-https",
      deploymentFingerprint: {
        status: "present",
        value: deploymentFingerprint,
        valueRedacted: true,
      },
      valueRedacted: true,
      deploymentUrlOmitted: true,
      responseBodiesOmitted: true,
    });
    const reachabilityPath = writeJson(reportsDir, "reachability.json", {
      target: "deployment-domain-reachability",
      mode: "live",
      environment: "production",
      status: "reachable",
      releaseRunId,
      rawDeploymentUrl: fakeUrl,
      deploymentUrlClass: "remote-https",
      vercelProductionDeploymentEvidence: {
        target: "vercel-production-deployment",
        status: "matched",
        releaseRunIdStatus: "matched",
        deploymentFingerprintStatus: "matched",
        valueRedacted: true,
      },
      safety: {
        deploymentUrlOmitted: true,
        responseBodiesOmitted: true,
        secretsRedacted: true,
      },
    });
    const smokePaths = smokeTargets.map((target) =>
      writeJson(reportsDir, `${target}.json`, smokeEvidence(target, fakeUrl, fakeSecret)),
    );

    const output = execFileSync("node", [
      "scripts/vercel-env-deploy-production-evidence-gate.mjs",
      "--vercel-env-deploy-preflight",
      preflightPath,
      "--vercel-env-sync",
      envSyncPath,
      "--vercel-production-deployment",
      deploymentPath,
      "--deployment-reachability",
      reachabilityPath,
      "--deployment-route-smoke",
      smokePaths[0],
      "--teacher-workflow-deployment-smoke",
      smokePaths[1],
      "--teacher-workflow-browser-smoke",
      smokePaths[2],
      "--teacher-workflow-live-generation-smoke",
      smokePaths[3],
      "--learning-ppt-playback-deployment-smoke",
      smokePaths[4],
      "--teaching-operations-route-smoke",
      smokePaths[5],
      "--teaching-operation-detail-browser-smoke",
      smokePaths[6],
      "--teaching-course-management-route-smoke",
      smokePaths[7],
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("vercel-env-deploy-production-evidence-gate-cleared");
    expect(body.releaseReady).toBe(false);
    expect(body.summary).toEqual({
      ownerInputRequired: false,
      operatorInputRequired: false,
      blockingInputRequired: false,
      upstreamProviderEvidenceRequired: false,
      upstreamProviderEvidenceCleared: true,
      preflightReady: true,
      envSyncEvidenceProvided: true,
      envSyncEvidenceAccepted: true,
      productionDeploymentEvidenceProvided: true,
      productionDeploymentEvidenceAccepted: true,
      deploymentReachabilityEvidenceProvided: true,
      deploymentReachabilityEvidenceAccepted: true,
      deployedSmokeEvidenceProvidedCount: 8,
      deployedSmokeEvidenceAcceptedCount: 8,
      releaseRunBound: true,
      vercelEnvDeployProductionEvidenceCleared: true,
      liveChainStillForbidden: true,
      releaseReady: false,
    });
    expect(body.upstreamBlockingEvidence).toBeNull();
    expect(body.envSyncEvidenceStatus).toEqual({
      target: "vercel-env-sync",
      status: "matched",
      releaseRunIdStatus: "matched",
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
    expect(body.deploymentReachabilityEvidenceStatus).toEqual({
      target: "deployment-domain-reachability",
      status: "reachable",
      environment: "production",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    });
    expect(body.deployedSmokeEvidenceStatuses).toEqual(
      smokeTargets.map((target) => ({
        target,
        status: "live-passed",
        environment: "production",
        releaseRunIdStatus: "matched",
        valueRedacted: true,
      })),
    );
    expect(body.provedEvidence).toEqual([
      "vercel-project-readiness-current",
      "vercel-env-sync-apply-production-and-preview",
      "vercel-production-deployment-evidence",
      "deployment-domain-reachability",
      "deployment-route-smoke-live-passed",
      "teacher-workflow-deployment-smoke-live-passed",
      "teacher-workflow-browser-smoke-live-passed",
      "teacher-workflow-live-generation-smoke-live-passed",
      "learning-ppt-playback-deployment-smoke-live-passed",
      "teaching-operations-route-smoke-live-passed",
      "teaching-operation-detail-browser-smoke-live-passed",
      "teaching-course-management-route-smoke-live-passed",
      "same-release-run-id-bound-to-env-deploy-and-smokes",
    ]);
    expect(body.safeNextAction).toBe(
      "advance-ordinary-teaching-and-manual-ppt-production-evidence-preflight",
    );
    expect(output).not.toContain(fakeUrl);
    expect(output).not.toContain(fakeSecret);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function smokeEvidence(target: string, fakeUrl: string, fakeSecret: string) {
  return {
    target,
    mode: "live",
    environment: "production",
    status: "passed",
    releaseRunId,
    rawDeploymentUrl: fakeUrl,
    rawCookie: fakeSecret,
    vercelProductionDeploymentEvidence: {
      target: "vercel-production-deployment",
      status: "matched",
      releaseRunIdStatus: "matched",
      deploymentFingerprintStatus: "matched",
      deploymentFingerprint,
      valueRedacted: true,
    },
    deploymentReachabilityEvidence: {
      target: "deployment-domain-reachability",
      status: "matched",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    },
    results: [{ id: `${target}-live-check`, status: "ok" }],
    safety: {
      secretsRedacted: true,
      deploymentUrlOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      localPrivatePathsOmitted: true,
    },
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}
