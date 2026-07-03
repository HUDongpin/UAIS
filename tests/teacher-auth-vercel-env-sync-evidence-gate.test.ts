import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const upstreamOperatorInputPacket = {
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
};

describe("teacher auth vercel env sync evidence gate", () => {
  it("waits for upstream app-auth evidence before teacher-auth env sync can be accepted", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-vercel-env-gate-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const preflightPath = writeJson(reportsDir, "teacher-preflight.json", {
      target: "teacher-auth-production-evidence-preflight",
      status: "teacher-auth-production-evidence-preflight-waiting-for-upstream-app-auth",
      approvedProviderMode: "trusted-cookie-issuer",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-teacher-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      summary: {
        upstreamAppAuthEvidenceCleared: false,
        s19DryRunMayProceedAfterAppAuthClears: true,
        s22ReadinessMayProceedAfterEnvSync: true,
        liveCookieIssuanceStillForbidden: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: [
        "UAIS_TEACHER_AUTH_PROVIDER",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      ],
    });
    const envSourceIntakePath = writeJson(reportsDir, "teacher-env-source-intake.json", {
      target: "teacher-auth-env-source-intake",
      status: "teacher-auth-env-source-intake-waiting-for-upstream-app-auth",
      summary: {
        operatorInputRequired: true,
        blockingInputRequired: true,
        upstreamEvidenceRequired: true,
        releaseReady: false,
      },
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamBlockingEvidence: {
        id: "upstream-app-auth-production-evidence",
        safeNextAction: "provide-approved-env-source-path-to-s19",
        upstreamMissingEvidence: ["approved-env-source-path"],
        upstreamOperatorInputPacket,
        upstreamSafeCommandTemplates: {
          approvedSourceHandleIntake:
            "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
        },
      },
      sourceEvidenceHandle: "/Users/private/approved-app-auth.env",
    });

    const output = execFileSync("node", [
      "scripts/teacher-auth-vercel-env-sync-evidence-gate.mjs",
      "--teacher-auth-preflight",
      preflightPath,
      "--teacher-auth-env-source-intake",
      envSourceIntakePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-vercel-env-sync-evidence-gate",
        status: "teacher-auth-vercel-env-sync-evidence-gate-waiting-for-upstream-app-auth",
        releaseReady: false,
        responsibleSession: "S19/S22",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-teacher-auth-env-source",
        approvedProviderMode: "trusted-cookie-issuer",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
        summary: {
          ownerInputRequired: false,
          operatorInputRequired: true,
          blockingInputRequired: true,
          upstreamProductionEvidenceRequired: true,
          upstreamAppAuthEvidenceCleared: false,
          teacherPreflightReady: false,
          vercelEnvSyncEvidenceProvided: false,
          applyEvidenceAccepted: false,
          teacherAuthEnvPresent: false,
          teacherAuthReadinessMayProceed: false,
          releaseReady: false,
        },
        vercelEnvSyncEvidenceStatus: {
          target: "missing",
          status: "missing",
          applyPreflight: "missing",
          releaseRunIdStatus: "missing",
          requiredTeacherAuthEnvStatus: "missing",
          valueRedacted: true,
        },
        blockedReasons: [
          "upstream-app-auth-production-evidence-not-cleared",
        ],
      }),
    );
    expect(body.upstreamBlockingEvidence).toEqual({
      id: "upstream-app-auth-production-evidence",
      label: "app-auth-production-evidence",
      reason:
        "Teacher-auth Vercel env-sync evidence must wait for app-auth production evidence before S19 runs or accepts teacher-auth env-sync evidence.",
      valuesForbidden: true,
      upstreamStatus: "teacher-auth-production-evidence-preflight-waiting-for-upstream-app-auth",
      upstreamBlockedReasons: ["upstream-app-auth-production-evidence-not-cleared"],
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamOperatorInputRequired: true,
      upstreamMissingEvidence: ["approved-env-source-path"],
      upstreamOperatorInputPacket,
      upstreamSafeCommandTemplates: {
        approvedSourceHandleIntake:
          "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
      },
    });
    expect(body.safeNextAction).toBe("provide-approved-env-source-path-to-s19");
    expect(body.safety).toEqual({
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      noCookieIssued: true,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/teacher-auth-vercel-env-sync-evidence-gate.mjs",
      "--teacher-auth-preflight",
      preflightPath,
      "--teacher-auth-env-source-intake",
      envSourceIntakePath,
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

  it("accepts only redacted apply evidence with teacher-auth env present and release-run binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-vercel-env-gate-apply-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeUrl = "https://teacher-auth.example.test/issuer";
    const fakeSecret = "teacher-secret-value-that-must-not-appear";
    const preflightPath = writeJson(reportsDir, "teacher-preflight.json", {
      target: "teacher-auth-production-evidence-preflight",
      status: "teacher-auth-production-evidence-preflight-ready",
      approvedProviderMode: "trusted-cookie-issuer",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-teacher-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      summary: {
        upstreamAppAuthEvidenceCleared: true,
        s19DryRunMayProceedAfterAppAuthClears: true,
        s22ReadinessMayProceedAfterEnvSync: true,
        liveCookieIssuanceStillForbidden: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: [
        "UAIS_TEACHER_AUTH_PROVIDER",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      ],
    });
    const vercelEnvSyncPath = writeJson(reportsDir, "teacher-vercel-env-sync.json", {
      target: "vercel-env-sync",
      mode: "apply",
      projectReadinessEvidenceStatus: "ready",
      releaseRunId: "UAIS-enterprise-run-2026-07-XX",
      teacherAuthProviderMode: "trusted-cookie-issuer",
      rawIssuerEndpoint: fakeUrl,
      rawIssuerSecret: fakeSecret,
      targets: ["production", "preview"],
      entries: [
        { name: "UAIS_TEACHER_AUTH_PROVIDER", status: "present", valueRedacted: true },
        {
          name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          status: "present",
          valueRedacted: true,
        },
        { name: "UAIS_TEACHER_AUTH_ISSUER_SECRET", status: "present", valueRedacted: true },
      ],
      applyPreflight: {
        status: "passed",
        blockedReasons: [],
        valuesRedacted: true,
        cliSafeToInvoke: true,
      },
      applySummary: {
        status: "applied",
        appliedActions: 6,
        appliedByTarget: { production: 3, preview: 3 },
        localOnlyEntriesSkipped: 0,
        valuesRedacted: true,
        apiOutputOmitted: true,
      },
    });

    const output = execFileSync("node", [
      "scripts/teacher-auth-vercel-env-sync-evidence-gate.mjs",
      "--teacher-auth-preflight",
      preflightPath,
      "--vercel-env-sync",
      vercelEnvSyncPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("teacher-auth-vercel-env-sync-evidence-gate-apply-evidence-accepted");
    expect(body.releaseReady).toBe(false);
    expect(body.summary).toEqual({
      ownerInputRequired: false,
      operatorInputRequired: false,
      blockingInputRequired: false,
      upstreamProductionEvidenceRequired: false,
      upstreamAppAuthEvidenceCleared: true,
      teacherPreflightReady: true,
      vercelEnvSyncEvidenceProvided: true,
      applyEvidenceAccepted: true,
      teacherAuthEnvPresent: true,
      teacherAuthReadinessMayProceed: true,
      releaseReady: false,
    });
    expect(body.upstreamBlockingEvidence).toBeNull();
    expect(body.vercelEnvSyncEvidenceStatus).toEqual({
      target: "vercel-env-sync",
      status: "matched",
      applyPreflight: "proved",
      releaseRunIdStatus: "matched",
      requiredTeacherAuthEnvStatus: "present",
      valueRedacted: true,
    });
    expect(body.safeNextAction).toBe("run-s22-teacher-auth-provider-readiness-with-accepted-env-sync-evidence");
    expect(output).not.toContain(fakeUrl);
    expect(output).not.toContain(fakeSecret);
    expect(output).not.toContain(vercelEnvSyncPath);
  });
});

function writeJson(dir: string, name: string, value: unknown) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}
