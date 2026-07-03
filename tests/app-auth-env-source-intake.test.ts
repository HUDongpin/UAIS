import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("app auth env source intake", () => {
  it("prints a dry-run intake contract without reading an env file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-env-source-intake-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const handoffPath = writeJson(reportsDir, "handoff.json", {
      target: "production-env-source-handoff",
      status: "production-env-source-handoff-awaiting-approved-env-source-path",
      firstRequiredSourceLabel: "UAIS-production-app-auth-env-source",
      firstSafeAction: "provide-approved-env-source-path-to-s19",
      sourceRequests: [
        {
          id: "app-auth-provider-production-selector",
          requestStatus: "ready-for-approved-env-source-path",
          approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
          approvedProviderMode: "trusted-account-provider",
          approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
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
        },
      ],
    });
    const preflightPath = writeJson(reportsDir, "app-auth-preflight.json", {
      target: "app-auth-production-evidence-preflight",
      status: "app-auth-production-evidence-preflight-ready",
      approvedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      requiredServerOnlyEnvNames: [
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_APP_AUTH_PROVIDER_URL",
        "UAIS_APP_AUTH_PROVIDER_TOKEN",
      ],
      safeCommandTemplates: {
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope full --env-file <approved-env-file>",
      },
    });

    const output = execFileSync("node", [
      "scripts/app-auth-env-source-intake.mjs",
      "--production-env-source-handoff",
      handoffPath,
      "--app-auth-preflight",
      preflightPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "app-auth-env-source-intake",
        status: "app-auth-env-source-intake-awaiting-approved-source-path",
        mode: "dry-run",
        releaseReady: false,
        responsibleSession: "S19/S22",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
        approvedProviderMode: "trusted-account-provider",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
        summary: {
          ownerInputRequired: false,
          operatorInputRequired: true,
          blockingInputRequired: true,
          requiredEnvNameCount: 4,
          presentEnvNameCount: 0,
          missingEnvNameCount: 4,
          envFileProvided: false,
          envValuesEmitted: false,
          readyForVercelEnvSyncDryRun: false,
          releaseReady: false,
        },
        safety: {
          sourcePathOmitted: true,
          sourceEvidenceHandleOmitted: true,
          rawUrlsOmitted: true,
          credentialValuesOmitted: true,
          cookieValuesOmitted: true,
          envFileRead: false,
          vercelApiCalled: false,
          noEnvApplyPerformed: true,
          noDeploymentMutationPerformed: true,
          noLiveSmokePerformed: true,
          noReleaseRunBindingPerformed: true,
        },
      }),
    );
    expect(body.blockedReasons).toEqual(["approved-env-source-path-required"]);
    expect(body.blockingInput).toEqual({
      id: "approved-env-source-path",
      label: "UAIS-production-app-auth-env-source",
      reason:
        "S19 can read app-auth env names only after the approved server-only env source is available as a local path or evidence handle without exposing values.",
      valuesForbidden: true,
    });
    expect(body.missingEvidence).toEqual(["approved-env-source-path"]);
    expect(body.deferredMissingEvidence).toEqual([
      "vercel-env-sync-evidence-with-app-auth-env-present",
      "app-auth-provider-readiness-production-live-ready",
    ]);
    expect(body.requiredServerOnlyEnvNames).toEqual([
      "UAIS_APP_SESSION_SIGNING_SECRET",
      "UAIS_APP_AUTH_PROVIDER",
      "UAIS_APP_AUTH_PROVIDER_URL",
      "UAIS_APP_AUTH_PROVIDER_TOKEN",
    ]);
    expect(body.safeNextAction).toBe("provide-approved-env-source-path-to-s19");
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
    expect(body.safeCommandTemplates).toEqual(
      expect.objectContaining({
        approvedSourceHandleIntake:
          "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
        approvedEnvFilePresenceIntake:
          "node scripts/app-auth-env-source-intake.mjs --live --approved --env-file <approved-env-file> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope full --env-file <approved-env-file>",
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/app-auth-env-source-intake.mjs",
      "--production-env-source-handoff",
      handoffPath,
      "--app-auth-preflight",
      preflightPath,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("## Safe Command Templates");
    expect(markdown).toContain(
      "`node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle>",
    );
    expect(markdown).toContain(
      "`node scripts/app-auth-env-source-intake.mjs --live --approved --env-file <approved-env-file>",
    );
    expect(markdown).not.toContain(tmpDir);
    expect(markdown).not.toContain("/Users/");
  });

  it("keeps downstream app-auth evidence deferred when handoff separates current source-path evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-env-source-intake-deferred-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const handoffPath = writeJson(reportsDir, "handoff.json", {
      target: "production-env-source-handoff",
      status: "production-env-source-handoff-awaiting-approved-env-source-path",
      sourceRequests: [
        {
          id: "app-auth-provider-production-selector",
          requestStatus: "ready-for-approved-env-source-path",
          approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
          approvedProviderMode: "trusted-account-provider",
          approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
          requiredServerOnlyEnvNames: [
            "UAIS_APP_SESSION_SIGNING_SECRET",
            "UAIS_APP_AUTH_PROVIDER",
            "UAIS_APP_AUTH_PROVIDER_URL",
            "UAIS_APP_AUTH_PROVIDER_TOKEN",
          ],
          missingEvidence: ["approved-env-source-path"],
          deferredMissingEvidence: [
            "vercel-env-sync-evidence-with-app-auth-env-present",
            "app-auth-provider-readiness-production-live-ready",
            "same-release-run-id-bound-to-app-auth-readiness",
          ],
        },
      ],
    });
    const preflightPath = writeJson(reportsDir, "app-auth-preflight.json", {
      target: "app-auth-production-evidence-preflight",
      status: "app-auth-production-evidence-preflight-ready",
      approvedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      requiredServerOnlyEnvNames: [
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_APP_AUTH_PROVIDER_URL",
        "UAIS_APP_AUTH_PROVIDER_TOKEN",
      ],
      missingEvidence: [
        "vercel-env-sync-evidence-with-app-auth-env-present",
        "app-auth-provider-readiness-production-live-ready",
        "same-release-run-id-bound-to-app-auth-readiness",
      ],
    });

    const output = execFileSync("node", [
      "scripts/app-auth-env-source-intake.mjs",
      "--production-env-source-handoff",
      handoffPath,
      "--app-auth-preflight",
      preflightPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.missingEvidence).toEqual(["approved-env-source-path"]);
    expect(body.blockedReasons).toEqual(["approved-env-source-path-required"]);
    expect(body.deferredMissingEvidence).toEqual([
      "vercel-env-sync-evidence-with-app-auth-env-present",
      "app-auth-provider-readiness-production-live-ready",
      "same-release-run-id-bound-to-app-auth-readiness",
    ]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("records an approved evidence handle without exposing the raw handle or pretending env names were checked", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-env-source-intake-handle-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const rawHandleThatMustNotAppear = "/Users/private/approved-app-auth.env";
    const handoffPath = writeJson(reportsDir, "handoff.json", {
      target: "production-env-source-handoff",
      status: "production-env-source-handoff-awaiting-approved-env-source-path",
      sourceRequests: [
        {
          id: "app-auth-provider-production-selector",
          requestStatus: "ready-for-approved-env-source-path",
          approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
          approvedProviderMode: "trusted-account-provider",
          approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
          requiredServerOnlyEnvNames: [
            "UAIS_APP_SESSION_SIGNING_SECRET",
            "UAIS_APP_AUTH_PROVIDER",
            "UAIS_APP_AUTH_PROVIDER_URL",
            "UAIS_APP_AUTH_PROVIDER_TOKEN",
          ],
          missingEvidence: ["approved-env-source-path"],
          deferredMissingEvidence: [
            "vercel-env-sync-evidence-with-app-auth-env-present",
            "app-auth-provider-readiness-production-live-ready",
            "same-release-run-id-bound-to-app-auth-readiness",
          ],
        },
      ],
    });
    const preflightPath = writeJson(reportsDir, "app-auth-preflight.json", {
      target: "app-auth-production-evidence-preflight",
      status: "app-auth-production-evidence-preflight-ready",
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

    const output = execFileSync("node", [
      "scripts/app-auth-env-source-intake.mjs",
      "--approved",
      "--evidence-handle",
      rawHandleThatMustNotAppear,
      "--production-env-source-handoff",
      handoffPath,
      "--app-auth-preflight",
      preflightPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("app-auth-env-source-intake-approved-source-handle-recorded");
    expect(body.mode).toBe("approved-source-handle");
    expect(body.summary).toEqual({
      ownerInputRequired: false,
      operatorInputRequired: true,
      blockingInputRequired: true,
      requiredEnvNameCount: 4,
      presentEnvNameCount: 0,
      missingEnvNameCount: 4,
      envFileProvided: false,
      sourceEvidenceHandleProvided: true,
      envValuesEmitted: false,
      readyForVercelEnvSyncDryRun: false,
      releaseReady: false,
    });
    expect(body.blockingInput).toEqual({
      id: "app-auth-env-name-presence-evidence",
      label: "UAIS-production-app-auth-env-source",
      reason:
        "S19 has an approved app-auth source handle, but still needs redacted env-name presence evidence before Vercel env-sync dry-run can proceed.",
      valuesForbidden: true,
    });
    expect(body.blockedReasons).toEqual(["app-auth-env-name-presence-evidence-required"]);
    expect(body.missingEvidence).toEqual(["app-auth-env-name-presence-evidence"]);
    expect(body.safeNextAction).toBe(
      "run-s19-app-auth-env-presence-check-from-approved-source-handle",
    );
    expect(body.operatorInputPacket).toEqual({
      target: "app-auth-env-source-intake-operator-input",
      status: "operator-env-name-presence-evidence-required",
      firstRequiredInputId: "app-auth-env-name-presence-evidence",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      acceptedInputModes: ["approved-source-handle", "approved-env-file-presence"],
      requiredServerOnlyEnvNames: [
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_APP_AUTH_PROVIDER_URL",
        "UAIS_APP_AUTH_PROVIDER_TOKEN",
      ],
      nextSafeAction: "run-s19-app-auth-env-presence-check-from-approved-source-handle",
      nextSafeCommandTemplateKey: "approvedEnvFilePresenceIntake",
      preferredInputMode: "approved-env-file-presence",
      safeInputInstruction:
        "Use the approved source handle to produce redacted env-name presence evidence; do not paste raw values, URLs, cookies, credentials, or unredacted local paths into reports or chat.",
      approvedSourceLabelIsNotEvidence: true,
      valuesForbidden: true,
    });
    expect(body.safeCommandTemplates.approvedEnvFilePresenceIntake).toBe(
      "node scripts/app-auth-env-source-intake.mjs --live --approved --env-file <approved-env-file> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
    );
    expect(body.safety).toEqual(
      expect.objectContaining({
        sourcePathOmitted: true,
        sourceEvidenceHandleOmitted: true,
        envFileRead: false,
      }),
    );
    expect(output).not.toContain(rawHandleThatMustNotAppear);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("reads an approved test env file but reports only redacted presence evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-env-source-intake-live-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeSecret = "secret-value-that-must-not-appear";
    const fakeToken = "token-value-that-must-not-appear";
    const fakeUrl = "https://private-provider.example.test";
    const envPath = join(tmpDir, "approved-app-auth.env");
    writeFileSync(
      envPath,
      [
        `UAIS_APP_SESSION_SIGNING_SECRET=${fakeSecret}`,
        "UAIS_APP_AUTH_PROVIDER=trusted-account-provider",
        `UAIS_APP_AUTH_PROVIDER_URL=${fakeUrl}`,
        `UAIS_APP_AUTH_PROVIDER_TOKEN=${fakeToken}`,
        "",
      ].join("\n"),
    );
    const handoffPath = writeJson(reportsDir, "handoff.json", {
      firstRequiredSourceLabel: "UAIS-production-app-auth-env-source",
      firstSafeAction: "provide-approved-env-source-path-to-s19",
      sourceRequests: [
        {
          id: "app-auth-provider-production-selector",
          requestStatus: "ready-for-approved-env-source-path",
          approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
          approvedProviderMode: "trusted-account-provider",
          approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
          requiredServerOnlyEnvNames: [
            "UAIS_APP_SESSION_SIGNING_SECRET",
            "UAIS_APP_AUTH_PROVIDER",
            "UAIS_APP_AUTH_PROVIDER_URL",
            "UAIS_APP_AUTH_PROVIDER_TOKEN",
          ],
        },
      ],
    });
    const preflightPath = writeJson(reportsDir, "app-auth-preflight.json", {
      approvedProviderMode: "trusted-account-provider",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      requiredServerOnlyEnvNames: [
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_APP_AUTH_PROVIDER_URL",
        "UAIS_APP_AUTH_PROVIDER_TOKEN",
      ],
      safeCommandTemplates: {
        vercelEnvSyncDryRun:
          "node scripts/vercel-env-sync.mjs --dry-run --scope full --env-file <approved-env-file>",
      },
    });

    const output = execFileSync("node", [
      "scripts/app-auth-env-source-intake.mjs",
      "--live",
      "--approved",
      "--env-file",
      envPath,
      "--production-env-source-handoff",
      handoffPath,
      "--app-auth-preflight",
      preflightPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("app-auth-env-source-intake-ready-for-vercel-env-sync-dry-run");
    expect(body.mode).toBe("live-approved-redacted-intake");
    expect(body.summary).toEqual({
      ownerInputRequired: false,
      operatorInputRequired: false,
      blockingInputRequired: false,
      requiredEnvNameCount: 4,
      presentEnvNameCount: 4,
      missingEnvNameCount: 0,
      envFileProvided: true,
      envValuesEmitted: false,
      readyForVercelEnvSyncDryRun: true,
      releaseReady: false,
    });
    expect(body.blockingInput).toBeNull();
    expect(body.blockedReasons).toEqual([]);
    expect(body.missingEvidence).toEqual([]);
    expect(body.deferredMissingEvidence).toEqual([]);
    expect(body.envPresence).toEqual([
      { name: "UAIS_APP_SESSION_SIGNING_SECRET", present: true },
      { name: "UAIS_APP_AUTH_PROVIDER", present: true },
      { name: "UAIS_APP_AUTH_PROVIDER_URL", present: true },
      { name: "UAIS_APP_AUTH_PROVIDER_TOKEN", present: true },
    ]);
    expect(body.safeNextAction).toBe("run-s19-vercel-env-sync-dry-run-for-app-auth");
    expect(body.safety.envFileRead).toBe(true);
    expect(output).not.toContain(fakeSecret);
    expect(output).not.toContain(fakeToken);
    expect(output).not.toContain(fakeUrl);
    expect(output).not.toContain(envPath);
  });
});

function writeJson(dir: string, name: string, value: unknown) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}
