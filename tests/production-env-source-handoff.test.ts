import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production env source handoff", () => {
  it("collects the approved server-only env source requests without exposing paths, URLs, or values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-env-source-handoff-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeLocalPath = ["", "Users", "example", "private", "uais.env"].join("/");
    const fakeUrl = ["https://", "private-production.example.test", "/env"].join("");

    const executionPlan = writeJson(reportsDir, "execution-plan.json", {
      target: "production-evidence-execution-plan",
      status: "production-evidence-execution-plan-awaiting-approved-env-source-path",
      firstWorkstreamId: "app-auth-provider-production-selector",
      firstSafeAction: "provide-approved-env-source-path-to-s19",
      blockingInput: {
        id: "approved-env-source-path",
        label: "UAIS-production-app-auth-env-source",
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
      summary: {
        ownerInputRequired: false,
        needsOwnerInput: 0,
        phaseCount: 8,
        releaseReady: false,
      },
      phases: [
        {
          id: "app-auth-provider-production-selector",
          status: "ready-for-s19-env-sync-dry-run",
          nextSafeAction: "provide-approved-env-source-path-to-s19",
          missingEvidence: ["approved-env-source-path"],
          blockedReasons: ["approved-env-source-path-required"],
          deferredMissingEvidence: [
            "vercel-env-sync-evidence-with-app-auth-env-present",
            "app-auth-provider-readiness-production-live-ready",
          ],
        },
      ],
      sourcePath: fakeLocalPath,
    });
    const appAuthPreflight = writeJson(reportsDir, "app-auth-preflight.json", {
      target: "app-auth-production-evidence-preflight",
      status: "app-auth-production-evidence-preflight-ready",
      ownerDecisionId: "app-auth-provider-production-selector",
      approvedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      summary: {
        s19DryRunMayProceed: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: [
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_APP_AUTH_PROVIDER_URL",
        "UAIS_APP_AUTH_PROVIDER_TOKEN",
      ],
      missingEvidence: [
        "vercel-env-sync-evidence-with-app-auth-env-present",
        "app-auth-provider-readiness-production-live-ready",
      ],
      safeCommandTemplates: {
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope full --env-file <approved-env-file>",
        appAuthReadiness:
          "node scripts/app-auth-provider-readiness.mjs --live --approved --env-file <approved-env-file>",
      },
      rawEndpoint: fakeUrl,
    });
    const teacherAuthPreflight = writeJson(reportsDir, "teacher-auth-preflight.json", {
      target: "teacher-auth-production-evidence-preflight",
      status: "teacher-auth-production-evidence-preflight-waiting-for-upstream-app-auth",
      ownerDecisionId: "teacher-auth-provider-production-selector",
      approvedProviderMode: "trusted-cookie-issuer",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-teacher-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      upstreamBlockers: ["app-auth-production-evidence-missing"],
      summary: {
        s19DryRunMayProceedAfterAppAuthClears: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: [
        "UAIS_TEACHER_AUTH_PROVIDER",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      ],
      missingEvidence: ["vercel-env-sync-evidence-with-teacher-auth-env-present"],
      safeCommandTemplates: {
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope teacher-auth --env-file <approved-env-file>",
      },
    });
    const externalStoragePreflight = writeJson(reportsDir, "external-storage-preflight.json", {
      target: "external-storage-production-evidence-preflight",
      status: "external-storage-production-evidence-preflight-waiting-for-upstream-auth",
      ownerDecisionId: "external-storage-production-service",
      approvedServiceClass: "approved-remote-https-external-storage-service",
      approvedRemoteHttpsExternalStorageServiceLabel:
        "UAIS-approved-remote-HTTPS-external-storage-service",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-external-storage-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      approvedSmokeTeacherIdLabel: "UAIS-approved-smoke-teacher-label",
      upstreamBlockers: [
        "app-auth-production-evidence-missing",
        "teacher-auth-production-evidence-missing",
      ],
      summary: {
        s19DryRunMayProceedAfterAuthClears: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: [
        "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
        "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
        "UAIS_TEACHING_OPERATIONS_BACKEND",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
        "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
        "UAIS_EXTERNAL_STORAGE_BASE_URL",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
        "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
        "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
        "UAIS_EXTERNAL_STORAGE_DATA_DIR",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
      ],
      missingEvidence: ["vercel-env-sync-evidence-with-external-storage-env-present"],
      safeCommandTemplates: {
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope external-storage --env-file <approved-env-file>",
      },
    });
    const vercelPreflight = writeJson(reportsDir, "vercel-preflight.json", {
      target: "vercel-env-deploy-production-evidence-preflight",
      status: "vercel-env-deploy-production-evidence-preflight-waiting-for-upstream-provider-evidence",
      ownerDecisionId: "vercel-env-deploy-and-smoke-chain",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-server-only-env-source-set",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      upstreamBlockers: [
        "app-auth-production-evidence-missing",
        "teacher-auth-production-evidence-missing",
        "external-storage-production-evidence-missing",
      ],
      summary: {
        s19EnvApplyPrepMayProceedAfterUpstreamReady: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: ["VERCEL_TOKEN"],
      missingEvidence: ["vercel-env-sync-apply-production-and-preview"],
      safeCommandTemplates: {
        vercelEnvSyncApply:
          "node scripts/vercel-env-sync.mjs --apply --approved --scope full --env-file <approved-env-file>",
      },
    });

    const output = execFileSync("node", [
      "scripts/production-env-source-handoff.mjs",
      "--execution-plan",
      executionPlan,
      "--app-auth-preflight",
      appAuthPreflight,
      "--teacher-auth-preflight",
      teacherAuthPreflight,
      "--external-storage-preflight",
      externalStoragePreflight,
      "--vercel-env-deploy-preflight",
      vercelPreflight,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "production-env-source-handoff",
        status: "production-env-source-handoff-awaiting-approved-env-source-path",
        responsibleSession: "S19/S22",
        releaseReady: false,
        firstRequiredSourceLabel: "UAIS-production-app-auth-env-source",
        firstSafeAction: "provide-approved-env-source-path-to-s19",
        summary: {
          ownerInputRequired: false,
          operatorInputRequired: true,
          blockingInputRequired: true,
          sourceRequestCount: 4,
          uniqueServerOnlyEnvNameCount: 22,
          immediateRequestCount: 1,
          upstreamGatedRequestCount: 3,
          envValuesRequired: false,
          releaseReady: false,
        },
        forbiddenInputs: [
          "raw-env-values",
          "credential-values",
          "cookie-values",
          "endpoint-urls",
          "unapproved-env-source-paths",
        ],
        safety: {
          sourcePathsOmitted: true,
          rawUrlsOmitted: true,
          credentialValuesOmitted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          envFileRead: false,
          vercelApiCalled: false,
          noEnvApplyPerformed: true,
          noDeploymentMutationPerformed: true,
          noLiveSmokePerformed: true,
          noReleaseRunBindingPerformed: true,
        },
      }),
    );
    expect(body.blockingInput).toEqual({
      id: "approved-env-source-path",
      label: "UAIS-production-app-auth-env-source",
      reason:
        "S19 can start the production env-source handoff only after the approved server-only env source is available as a local path or evidence handle without exposing values.",
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
    expect(body.nextOperatorSafeInstruction).toContain("approved local env source path");
    expect(body.sourceRequests).toEqual([
      expect.objectContaining({
        id: "app-auth-provider-production-selector",
        phaseStatus: "ready-for-s19-env-sync-dry-run",
        nextSafeAction: "provide-approved-env-source-path-to-s19",
        requestStatus: "ready-for-approved-env-source-path",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
        approvedProviderMode: "trusted-account-provider",
        upstreamBlockers: [],
        missingEvidence: ["approved-env-source-path"],
        blockedReasons: ["approved-env-source-path-required"],
        deferredMissingEvidence: [
          "vercel-env-sync-evidence-with-app-auth-env-present",
          "app-auth-provider-readiness-production-live-ready",
        ],
        requiredServerOnlyEnvNames: [
          "UAIS_APP_SESSION_SIGNING_SECRET",
          "UAIS_APP_AUTH_PROVIDER",
          "UAIS_APP_AUTH_PROVIDER_URL",
          "UAIS_APP_AUTH_PROVIDER_TOKEN",
        ],
      }),
      expect.objectContaining({
        id: "teacher-auth-provider-production-selector",
        phaseStatus: "none-recorded",
        nextSafeAction: "wait-for-upstream-production-evidence",
        requestStatus: "waiting-for-upstream-production-evidence",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-teacher-auth-env-source",
        approvedProviderMode: "trusted-cookie-issuer",
        upstreamBlockers: ["app-auth-production-evidence-missing"],
      }),
      expect.objectContaining({
        id: "external-storage-production-service",
        requestStatus: "waiting-for-upstream-production-evidence",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-external-storage-env-source",
        approvedServiceClass: "approved-remote-https-external-storage-service",
        approvedRemoteHttpsExternalStorageServiceLabel:
          "UAIS-approved-remote-HTTPS-external-storage-service",
        approvedSmokeTeacherIdLabel: "UAIS-approved-smoke-teacher-label",
      }),
      expect.objectContaining({
        id: "vercel-env-deploy-and-smoke-chain",
        requestStatus: "waiting-for-upstream-production-evidence",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-server-only-env-source-set",
        requiredServerOnlyEnvNames: ["VERCEL_TOKEN"],
      }),
    ]);
    expect(body.uniqueServerOnlyEnvNames).toContain("UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN");
    expect(body.uniqueServerOnlyEnvNames).toContain("VERCEL_TOKEN");
    expect(body.nextOwnerSafeInstruction).toContain("approved local env source path");
    expect(output).not.toContain(fakeLocalPath);
    expect(output).not.toContain(fakeUrl);
    expect(output).not.toContain("secret=");
  });

  it("renders markdown without leaking local paths or raw URLs", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-env-source-handoff-md-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const executionPlan = writeJson(reportsDir, "execution-plan.json", {
      target: "production-evidence-execution-plan",
      status: "production-evidence-execution-plan-awaiting-approved-env-source-path",
      firstSafeAction: "provide-approved-env-source-path-to-s19",
      blockingInput: { label: "UAIS-production-app-auth-env-source" },
      operatorInputPacket: {
        target: "app-auth-env-source-intake-operator-input",
        status: "operator-approved-source-required",
        firstRequiredInputId: "approved-env-source-path",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
        acceptedInputModes: ["approved-source-handle"],
        requiredServerOnlyEnvNames: ["UAIS_APP_AUTH_PROVIDER"],
        nextSafeAction: "provide-approved-env-source-path-to-s19",
        nextSafeCommandTemplateKey: "approvedSourceHandleIntake",
        valuesForbidden: true,
      },
      summary: { releaseReady: false },
    });
    const appAuthPreflight = writeJson(reportsDir, "app-auth-preflight.json", {
      ownerDecisionId: "app-auth-provider-production-selector",
      status: "app-auth-production-evidence-preflight-ready",
      approvedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      requiredServerOnlyEnvNames: ["UAIS_APP_AUTH_PROVIDER"],
      safeCommandTemplates: {
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope full --env-file <approved-env-file>",
      },
    });
    const emptyPreflight = writeJson(reportsDir, "empty.json", {
      ownerDecisionId: "unused",
      approvedServerOnlyEnvSourceLabel: "unused",
      requiredServerOnlyEnvNames: [],
      safeCommandTemplates: {},
    });

    const output = execFileSync("node", [
      "scripts/production-env-source-handoff.mjs",
      "--execution-plan",
      executionPlan,
      "--app-auth-preflight",
      appAuthPreflight,
      "--teacher-auth-preflight",
      emptyPreflight,
      "--external-storage-preflight",
      emptyPreflight,
      "--vercel-env-deploy-preflight",
      emptyPreflight,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Production Env Source Handoff");
    expect(output).toContain("Status: `production-env-source-handoff-awaiting-approved-env-source-path`");
    expect(output).toContain("Owner input required: `false`");
    expect(output).toContain("Operator input required: `true`");
    expect(output).toContain("- `approved-env-source-path`: `UAIS-production-app-auth-env-source`");
    expect(output).toContain("## Operator Input Packet");
    expect(output).toContain("- First required input: `approved-env-source-path`");
    expect(output).toContain("- Next command template: `approvedSourceHandleIntake`");
    expect(output).toContain("`UAIS-production-app-auth-env-source`");
    expect(output).toContain("`UAIS_APP_AUTH_PROVIDER`");
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
  });
});

function writeJson(dir: string, name: string, value: unknown) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}
