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

describe("teacher auth env source intake", () => {
  it("keeps teacher-auth env intake waiting for upstream app-auth without reading env files", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-env-source-intake-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const handoffPath = writeJson(reportsDir, "handoff.json", buildHandoff());
    const preflightPath = writeJson(reportsDir, "teacher-auth-preflight.json", {
      target: "teacher-auth-production-evidence-preflight",
      status: "teacher-auth-production-evidence-preflight-waiting-for-upstream-app-auth",
      approvedProviderMode: "trusted-cookie-issuer",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-teacher-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      upstreamBlockers: ["app-auth-production-evidence-missing"],
      summary: {
        upstreamAppAuthEvidenceCleared: false,
        s19DryRunMayProceedAfterAppAuthClears: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: [
        "UAIS_TEACHER_AUTH_PROVIDER",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      ],
    });
    const appAuthGatePath = writeJson(reportsDir, "app-auth-gate.json", {
      target: "app-auth-production-evidence-gate",
      status: "app-auth-production-evidence-gate-waiting-for-env-sync-evidence",
      summary: {
        operatorInputRequired: true,
        blockingInputRequired: true,
        appAuthProductionEvidenceCleared: false,
        releaseReady: false,
      },
      safeNextAction: "provide-approved-env-source-path-to-s19",
      blockedReasons: ["app-auth-vercel-env-sync-evidence-not-accepted"],
      upstreamBlockingEvidence: {
        id: "upstream-app-auth-vercel-env-sync-evidence-gate",
        valuesForbidden: true,
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
      "scripts/teacher-auth-env-source-intake.mjs",
      "--production-env-source-handoff",
      handoffPath,
      "--teacher-auth-preflight",
      preflightPath,
      "--app-auth-production-evidence-gate",
      appAuthGatePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-auth-env-source-intake",
        status: "teacher-auth-env-source-intake-waiting-for-upstream-app-auth",
        releaseReady: false,
        mode: "dry-run",
        responsibleSession: "S19/S22",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-teacher-auth-env-source",
        approvedProviderMode: "trusted-cookie-issuer",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
        summary: {
          ownerInputRequired: false,
          operatorInputRequired: true,
          blockingInputRequired: true,
          upstreamEvidenceRequired: true,
          upstreamAppAuthEvidenceCleared: false,
          requiredEnvNameCount: 3,
          presentEnvNameCount: 0,
          missingEnvNameCount: 3,
          envFileProvided: false,
          envValuesEmitted: false,
          readyForVercelEnvSyncDryRun: false,
          releaseReady: false,
        },
        blockedReasons: ["upstream-app-auth-production-evidence-not-cleared"],
      }),
    );
    expect(body.blockingInput).toBeNull();
    expect(body.upstreamBlockingEvidence).toEqual({
      id: "upstream-app-auth-production-evidence",
      label: "app-auth-production-evidence",
      reason:
        "Teacher-auth env-source intake must wait for app-auth production evidence before S19 reads the approved teacher-auth env source.",
      valuesForbidden: true,
      upstreamStatus: "app-auth-production-evidence-gate-waiting-for-env-sync-evidence",
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamOperatorInputRequired: true,
      upstreamMissingEvidence: ["approved-env-source-path"],
      upstreamOperatorInputPacket,
      upstreamSafeCommandTemplates: {
        approvedSourceHandleIntake:
          "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
      },
    });
    expect(body.missingEvidence).toEqual(["upstream-app-auth-production-evidence"]);
    expect(body.deferredMissingEvidence).toEqual([
      "vercel-env-sync-evidence-with-teacher-auth-env-present",
      "teacher-auth-provider-readiness-production-live-ready",
    ]);
    expect(body.requiredServerOnlyEnvNames).toEqual([
      "UAIS_TEACHER_AUTH_PROVIDER",
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_ISSUER_SECRET",
    ]);
    expect(body.safeNextAction).toBe("provide-approved-env-source-path-to-s19");
    expect(body.safety).toEqual({
      sourcePathOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/teacher-auth-env-source-intake.mjs",
      "--production-env-source-handoff",
      handoffPath,
      "--teacher-auth-preflight",
      preflightPath,
      "--app-auth-production-evidence-gate",
      appAuthGatePath,
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

  it("reads an approved test env file only after upstream app-auth is cleared and reports redacted presence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-auth-env-source-intake-live-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeSecret = "secret-teacher-auth-value";
    const envPath = join(tmpDir, "approved-teacher-auth.env");
    writeFileSync(
      envPath,
      [
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=${fakeSecret}`,
        `UAIS_TEACHER_AUTH_ISSUER_SECRET=${fakeSecret}`,
        "",
      ].join("\n"),
    );
    const handoffPath = writeJson(reportsDir, "handoff.json", buildHandoff());
    const preflightPath = writeJson(reportsDir, "teacher-auth-preflight.json", {
      target: "teacher-auth-production-evidence-preflight",
      status: "teacher-auth-production-evidence-preflight-ready",
      approvedProviderMode: "trusted-cookie-issuer",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-teacher-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      summary: {
        upstreamAppAuthEvidenceCleared: true,
        s19DryRunMayProceedAfterAppAuthClears: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: [
        "UAIS_TEACHER_AUTH_PROVIDER",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      ],
    });

    const output = execFileSync("node", [
      "scripts/teacher-auth-env-source-intake.mjs",
      "--live",
      "--approved",
      "--env-file",
      envPath,
      "--production-env-source-handoff",
      handoffPath,
      "--teacher-auth-preflight",
      preflightPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("teacher-auth-env-source-intake-ready-for-vercel-env-sync-dry-run");
    expect(body.releaseReady).toBe(false);
    expect(body.mode).toBe("live-approved-redacted-intake");
    expect(body.summary).toEqual({
      ownerInputRequired: false,
      operatorInputRequired: false,
      blockingInputRequired: false,
      upstreamEvidenceRequired: false,
      upstreamAppAuthEvidenceCleared: true,
      requiredEnvNameCount: 3,
      presentEnvNameCount: 3,
      missingEnvNameCount: 0,
      envFileProvided: true,
      envValuesEmitted: false,
      readyForVercelEnvSyncDryRun: true,
      releaseReady: false,
    });
    expect(body.envPresence).toEqual([
      { name: "UAIS_TEACHER_AUTH_PROVIDER", present: true },
      { name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET", present: true },
      { name: "UAIS_TEACHER_AUTH_ISSUER_SECRET", present: true },
    ]);
    expect(body.blockingInput).toBeNull();
    expect(body.upstreamBlockingEvidence).toBeNull();
    expect(body.safeNextAction).toBe("run-s19-vercel-env-sync-dry-run-for-teacher-auth");
    expect(body.safety.envFileRead).toBe(true);
    expect(output).not.toContain(fakeSecret);
    expect(output).not.toContain(envPath);
    expect(output).not.toContain("/Users/");
  });
});

function buildHandoff() {
  return {
    target: "production-env-source-handoff",
    status: "production-env-source-handoff-awaiting-approved-env-source-path",
    sourceRequests: [
      {
        id: "teacher-auth-provider-production-selector",
        kind: "teacher-auth",
        requestStatus: "waiting-for-upstream-production-evidence",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-teacher-auth-env-source",
        approvedProviderMode: "trusted-cookie-issuer",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
        requiredServerOnlyEnvNames: [
          "UAIS_TEACHER_AUTH_PROVIDER",
          "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          "UAIS_TEACHER_AUTH_ISSUER_SECRET",
        ],
        missingEvidence: [
          "vercel-env-sync-evidence-with-teacher-auth-env-present",
          "teacher-auth-provider-readiness-production-live-ready",
        ],
      },
    ],
  };
}

function writeJson(dir: string, name: string, value: unknown) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}
