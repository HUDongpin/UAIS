import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("app auth vercel env sync evidence gate", () => {
  it("waits for app-auth env source intake before requesting Vercel env-sync evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-vercel-env-gate-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const intakePath = writeJson(reportsDir, "intake.json", {
      target: "app-auth-env-source-intake",
      status: "app-auth-env-source-intake-awaiting-approved-source-path",
      mode: "dry-run",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      approvedProviderMode: "trusted-account-provider",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      summary: {
        operatorInputRequired: true,
        blockingInputRequired: true,
        requiredEnvNameCount: 4,
        presentEnvNameCount: 0,
        missingEnvNameCount: 4,
        readyForVercelEnvSyncDryRun: false,
        releaseReady: false,
      },
      safeNextAction: "provide-approved-env-source-path-to-s19",
      missingEvidence: ["approved-env-source-path"],
      blockedReasons: ["approved-env-source-path-required"],
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
      safeCommandTemplates: {
        approvedSourceHandleIntake:
          "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
        approvedEnvFilePresenceIntake:
          "node scripts/app-auth-env-source-intake.mjs --live --approved --env-file <approved-env-file> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
      },
      sourceEvidenceHandle: "/Users/private/approved-app-auth.env",
      requiredServerOnlyEnvNames: [
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_APP_AUTH_PROVIDER_URL",
        "UAIS_APP_AUTH_PROVIDER_TOKEN",
      ],
    });
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      target: "app-auth-production-evidence-preflight",
      approvedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      requiredServerOnlyEnvNames: [
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_APP_AUTH_PROVIDER_URL",
        "UAIS_APP_AUTH_PROVIDER_TOKEN",
      ],
      missingEvidence: ["vercel-env-sync-evidence-with-app-auth-env-present"],
    });

    const output = execFileSync("node", [
      "scripts/app-auth-vercel-env-sync-evidence-gate.mjs",
      "--app-auth-env-source-intake",
      intakePath,
      "--app-auth-preflight",
      preflightPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "app-auth-vercel-env-sync-evidence-gate",
        status: "app-auth-vercel-env-sync-evidence-gate-waiting-for-env-source-intake",
        releaseReady: false,
        responsibleSession: "S19/S22",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
        approvedProviderMode: "trusted-account-provider",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
        summary: {
          ownerInputRequired: false,
          operatorInputRequired: true,
          blockingInputRequired: true,
          upstreamEnvSourceIntakeRequired: true,
          intakeReadyForVercelEnvSyncDryRun: false,
          vercelEnvSyncEvidenceProvided: false,
          applyEvidenceAccepted: false,
          appAuthEnvPresent: false,
          appAuthReadinessMayProceed: false,
          releaseReady: false,
        },
        vercelEnvSyncEvidenceStatus: {
          target: "missing",
          status: "missing",
          applyPreflight: "missing",
          releaseRunIdStatus: "missing",
          requiredAppAuthEnvStatus: "missing",
          valueRedacted: true,
        },
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
    expect(body.blockedReasons).toEqual(["app-auth-env-source-intake-not-ready"]);
    expect(body.upstreamBlockingEvidence).toEqual({
      id: "upstream-app-auth-env-source-intake",
      label: "app-auth-env-source-intake",
      reason:
        "App-auth Vercel env-sync evidence must wait for app-auth env-source intake to prove required env-name presence without exposing values.",
      valuesForbidden: true,
      upstreamStatus: "app-auth-env-source-intake-awaiting-approved-source-path",
      safeNextAction: "provide-approved-env-source-path-to-s19",
      missingEvidence: ["approved-env-source-path"],
      blockedReasons: ["approved-env-source-path-required"],
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
      safeCommandTemplates: {
        approvedSourceHandleIntake:
          "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
        approvedEnvFilePresenceIntake:
          "node scripts/app-auth-env-source-intake.mjs --live --approved --env-file <approved-env-file> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
      },
    });
    expect(body.safeNextAction).toBe("provide-approved-env-source-path-to-s19");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/app-auth-vercel-env-sync-evidence-gate.mjs",
      "--app-auth-env-source-intake",
      intakePath,
      "--app-auth-preflight",
      preflightPath,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("Operator input required: `true`");
    expect(markdown).toContain("Safe next action: `provide-approved-env-source-path-to-s19`");
    expect(markdown).toContain("## Safe Operator Command Templates");
    expect(markdown).toContain(
      "`approvedSourceHandleIntake`: `node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle>",
    );
    expect(markdown).not.toContain(tmpDir);
    expect(markdown).not.toContain("/Users/");
  });

  it("accepts only redacted apply evidence with app-auth env present and release-run binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-vercel-env-gate-apply-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeUrl = "https://private-provider.example.test";
    const fakeSecret = "secret-value-that-must-not-appear";
    const intakePath = writeJson(reportsDir, "intake.json", {
      target: "app-auth-env-source-intake",
      status: "app-auth-env-source-intake-ready-for-vercel-env-sync-dry-run",
      mode: "live-approved-redacted-intake",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      approvedProviderMode: "trusted-account-provider",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      summary: {
        readyForVercelEnvSyncDryRun: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: [
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_APP_AUTH_PROVIDER_URL",
        "UAIS_APP_AUTH_PROVIDER_TOKEN",
      ],
    });
    const preflightPath = writeJson(reportsDir, "preflight.json", {
      approvedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      requiredServerOnlyEnvNames: [
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_APP_AUTH_PROVIDER_URL",
        "UAIS_APP_AUTH_PROVIDER_TOKEN",
      ],
    });
    const vercelEnvSyncPath = writeJson(reportsDir, "vercel-env-sync.json", {
      target: "vercel-env-sync",
      mode: "apply",
      projectReadinessEvidenceStatus: "ready",
      releaseRunId: "UAIS-enterprise-run-2026-07-XX",
      appAuthProviderMode: "trusted-account-provider",
      rawEndpoint: fakeUrl,
      rawSecret: fakeSecret,
      targets: ["production", "preview"],
      entries: [
        { name: "UAIS_APP_SESSION_SIGNING_SECRET", status: "present", valueRedacted: true },
        { name: "UAIS_APP_AUTH_PROVIDER", status: "present", valueRedacted: true },
        { name: "UAIS_APP_AUTH_PROVIDER_URL", status: "present", valueRedacted: true },
        { name: "UAIS_APP_AUTH_PROVIDER_TOKEN", status: "present", valueRedacted: true },
      ],
      applyPreflight: {
        status: "passed",
        blockedReasons: [],
        valuesRedacted: true,
        cliSafeToInvoke: true,
      },
      applySummary: {
        status: "applied",
        appliedActions: 8,
        appliedByTarget: { production: 4, preview: 4 },
        localOnlyEntriesSkipped: 0,
        valuesRedacted: true,
        apiOutputOmitted: true,
      },
    });

    const output = execFileSync("node", [
      "scripts/app-auth-vercel-env-sync-evidence-gate.mjs",
      "--app-auth-env-source-intake",
      intakePath,
      "--app-auth-preflight",
      preflightPath,
      "--vercel-env-sync",
      vercelEnvSyncPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("app-auth-vercel-env-sync-evidence-gate-apply-evidence-accepted");
    expect(body.releaseReady).toBe(false);
    expect(body.summary).toEqual({
      ownerInputRequired: false,
      operatorInputRequired: false,
      blockingInputRequired: false,
      upstreamEnvSourceIntakeRequired: false,
      intakeReadyForVercelEnvSyncDryRun: true,
      vercelEnvSyncEvidenceProvided: true,
      applyEvidenceAccepted: true,
      appAuthEnvPresent: true,
      appAuthReadinessMayProceed: true,
      releaseReady: false,
    });
    expect(body.upstreamBlockingEvidence).toBeNull();
    expect(body.vercelEnvSyncEvidenceStatus).toEqual({
      target: "vercel-env-sync",
      status: "matched",
      applyPreflight: "proved",
      releaseRunIdStatus: "matched",
      requiredAppAuthEnvStatus: "present",
      valueRedacted: true,
    });
    expect(body.safeNextAction).toBe("run-s22-app-auth-provider-readiness-with-accepted-env-sync-evidence");
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
