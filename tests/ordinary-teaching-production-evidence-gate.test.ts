import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const releaseRunId = "UAIS-enterprise-run-2026-07-XX";
const deploymentFingerprint = "sha256:ordinary-teaching-vercel-deployment-fingerprint";

describe("ordinary teaching production evidence gate", () => {
  it("keeps ordinary teaching waiting when upstream production evidence and live smokes are missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-production-gate-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "ordinary-teaching-production-evidence-preflight",
      status:
        "ordinary-teaching-production-evidence-preflight-waiting-for-upstream-production-evidence",
      summary: {
        ownerResponseAccepted: false,
        ordinaryStageWaitingForLiveEvidence: true,
        ownerPrerequisitesAccepted: true,
        upstreamProductionEvidenceCleared: false,
        smokeTargetsCleared: false,
        ordinaryOwnerResponseCanBeAccepted: false,
        releaseReady: false,
      },
      missingSmokeTargets: [
        { id: "teaching-operations-route-smoke" },
        { id: "teaching-operation-detail-browser-smoke" },
        { id: "teaching-course-management-route-smoke" },
      ],
    });
    const vercelEnvDeployGatePath = writeJson(reportsDir, "vercel-env-deploy-gate.json", {
      target: "vercel-env-deploy-production-evidence-gate",
      status: "vercel-env-deploy-production-evidence-gate-waiting-for-upstream-provider-evidence",
      summary: {
        operatorInputRequired: true,
        blockingInputRequired: true,
        vercelEnvDeployProductionEvidenceCleared: false,
        releaseReady: false,
      },
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamBlockingEvidence: {
        id: "upstream-provider-production-evidence",
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
      "scripts/ordinary-teaching-production-evidence-gate.mjs",
      "--ordinary-teaching-preflight",
      preflightPath,
      "--vercel-env-deploy-production-evidence-gate",
      vercelEnvDeployGatePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "ordinary-teaching-production-evidence-gate",
        status: "ordinary-teaching-production-evidence-gate-waiting-for-upstream-production-evidence",
        releaseReady: false,
        responsibleSession: "S22/S11/S24",
        summary: {
          operatorInputRequired: true,
          blockingInputRequired: true,
          ownerResponseAccepted: false,
          ownerPrerequisitesAccepted: true,
          upstreamProductionEvidenceCleared: false,
          preflightReady: false,
          teachingOperationsRouteSmokeProvided: false,
          teachingOperationsRouteSmokeAccepted: false,
          operationDetailBrowserSmokeProvided: false,
          operationDetailBrowserSmokeAccepted: false,
          courseManagementRouteSmokeProvided: false,
          courseManagementRouteSmokeAccepted: false,
          releaseRunBound: false,
          deploymentBound: false,
          ordinaryTeachingProductionEvidenceCleared: false,
          releaseReady: false,
        },
        teachingOperationsRouteSmokeStatus: {
          target: "teaching-operations-route-smoke",
          status: "missing",
          environment: "missing",
          releaseRunIdStatus: "missing",
          deploymentBindingStatus: "missing",
          valueRedacted: true,
        },
        operationDetailBrowserSmokeStatus: {
          target: "teaching-operation-detail-browser-smoke",
          status: "missing",
          environment: "missing",
          releaseRunIdStatus: "missing",
          deploymentBindingStatus: "missing",
          valueRedacted: true,
        },
        courseManagementRouteSmokeStatus: {
          target: "teaching-course-management-route-smoke",
          status: "missing",
          environment: "missing",
          releaseRunIdStatus: "missing",
          deploymentBindingStatus: "missing",
          valueRedacted: true,
        },
        blockedReasons: [
          "upstream-production-evidence-not-cleared",
          "ordinary-owner-response-not-accepted",
          "ordinary-live-smoke-targets-not-cleared",
          "teaching-operations-route-smoke-missing",
          "teaching-operation-detail-browser-smoke-missing",
          "teaching-course-management-route-smoke-missing",
        ],
      }),
    );
    expect(body.upstreamBlockingEvidence).toEqual({
      id: "upstream-vercel-env-deploy-production-evidence-gate",
      label: "vercel-env-deploy-production-evidence-gate",
      reason:
        "Ordinary teaching production evidence must wait for auth, external storage, and Vercel deployment evidence before live teaching smokes can be requested.",
      valuesForbidden: true,
      upstreamStatus:
        "vercel-env-deploy-production-evidence-gate-waiting-for-upstream-provider-evidence",
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
      noLiveSmokePerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/ordinary-teaching-production-evidence-gate.mjs",
      "--ordinary-teaching-preflight",
      preflightPath,
      "--vercel-env-deploy-production-evidence-gate",
      vercelEnvDeployGatePath,
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

  it("clears only with three live production teaching smokes bound to the same release run and deployment", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-teaching-production-gate-ready-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeDeploymentUrl = "https://ordinary-teaching.example.test/private";
    const fakeCookie = "uais_teacher_auth_signature=ordinary-teaching-secret-must-not-appear";
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "ordinary-teaching-production-evidence-preflight",
      status: "ordinary-teaching-production-evidence-preflight-ready",
      approvedReleaseRunIdLabel: releaseRunId,
      summary: {
        ownerResponseAccepted: true,
        ordinaryStageWaitingForLiveEvidence: true,
        ownerPrerequisitesAccepted: true,
        upstreamProductionEvidenceCleared: true,
        smokeTargetsCleared: true,
        ordinaryOwnerResponseCanBeAccepted: true,
        releaseReady: false,
      },
    });
    const operationsSmokePath = writeJson(
      reportsDir,
      "teaching-operations-route-smoke.json",
      buildLiveSmoke("teaching-operations-route-smoke", {
        teachingOperationsBackend: "external",
        teachingCourseManagementBackend: "external",
        rawDeploymentUrl: fakeDeploymentUrl,
        rawCookie: fakeCookie,
      }),
    );
    const operationDetailSmokePath = writeJson(
      reportsDir,
      "teaching-operation-detail-browser-smoke.json",
      buildLiveSmoke("teaching-operation-detail-browser-smoke", {
        apiMode: "live-teaching-operations",
        teachingOperationDetailBackend: "external",
        rawDeploymentUrl: fakeDeploymentUrl,
        rawCookie: fakeCookie,
      }),
    );
    const courseManagementSmokePath = writeJson(
      reportsDir,
      "teaching-course-management-route-smoke.json",
      buildLiveSmoke("teaching-course-management-route-smoke", {
        teacherAiOwnershipBackend: "external",
        courseManagementBackend: "external",
        courseAssetsBackend: "external",
        teachingOperationsBackend: "external",
        rawDeploymentUrl: fakeDeploymentUrl,
        rawCookie: fakeCookie,
      }),
    );

    const output = execFileSync("node", [
      "scripts/ordinary-teaching-production-evidence-gate.mjs",
      "--ordinary-teaching-preflight",
      preflightPath,
      "--teaching-operations-route-smoke",
      operationsSmokePath,
      "--teaching-operation-detail-browser-smoke",
      operationDetailSmokePath,
      "--teaching-course-management-route-smoke",
      courseManagementSmokePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("ordinary-teaching-production-evidence-gate-cleared");
    expect(body.releaseReady).toBe(false);
    expect(body.summary).toEqual({
      operatorInputRequired: false,
      blockingInputRequired: false,
      ownerResponseAccepted: true,
      ownerPrerequisitesAccepted: true,
      upstreamProductionEvidenceCleared: true,
      preflightReady: true,
      teachingOperationsRouteSmokeProvided: true,
      teachingOperationsRouteSmokeAccepted: true,
      operationDetailBrowserSmokeProvided: true,
      operationDetailBrowserSmokeAccepted: true,
      courseManagementRouteSmokeProvided: true,
      courseManagementRouteSmokeAccepted: true,
      releaseRunBound: true,
      deploymentBound: true,
      ordinaryTeachingProductionEvidenceCleared: true,
      releaseReady: false,
    });
    expect(body.teachingOperationsRouteSmokeStatus).toEqual({
      target: "teaching-operations-route-smoke",
      status: "live-passed",
      environment: "production",
      releaseRunIdStatus: "matched",
      deploymentBindingStatus: "matched",
      valueRedacted: true,
    });
    expect(body.operationDetailBrowserSmokeStatus.status).toBe("live-passed");
    expect(body.courseManagementRouteSmokeStatus.status).toBe("live-passed");
    expect(body.provedEvidence).toEqual([
      "live-teaching-operations-route-smoke",
      "live-teaching-operation-detail-browser-smoke",
      "live-teaching-course-management-route-smoke",
      "issued-teacher-auth-cookie-bound-to-ordinary-teaching-smokes",
      "same-vercel-production-deployment-bound-to-ordinary-teaching-smokes",
      "app-auth-provider-readiness-bound-to-ordinary-teaching-smokes",
      "teacher-auth-provider-readiness-bound-to-ordinary-teaching-smokes",
      "external-storage-readiness-bound-to-ordinary-teaching-smokes",
    ]);
    expect(body.safeNextAction).toBe("advance-enterprise-live-evidence-audit-preflight");
    expect(output).not.toContain(fakeDeploymentUrl);
    expect(output).not.toContain(fakeCookie);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function buildLiveSmoke(target: string, extra: Record<string, unknown>) {
  return {
    target,
    mode: "live",
    environment: "production",
    status: "passed",
    releaseRunId,
    deploymentFingerprint,
    vercelProductionDeploymentEvidence: {
      target: "vercel-production-deployment",
      status: "matched",
      releaseRunIdStatus: "matched",
      deploymentFingerprintStatus: "matched",
      deploymentFingerprint,
      valueRedacted: true,
    },
    appAuthProviderReadinessEvidence: {
      target: "app-auth-provider-readiness",
      status: "matched",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    },
    teacherAuthProviderReadinessEvidence: {
      target: "teacher-auth-provider-readiness",
      status: "matched",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    },
    externalStorageServiceReadinessEvidence: {
      target: "external-storage-service-readiness",
      status: "matched",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    },
    teacherAuthCookieStatus: "issued-redacted",
    results: [{ id: `${target}-live-check`, status: "ok" }],
    safety: {
      secretsRedacted: true,
      deploymentUrlOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      localPrivatePathsOmitted: true,
    },
    ...extra,
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}
