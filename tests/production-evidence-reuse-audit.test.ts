import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function writeJson(dir: string, name: string, body: unknown) {
  const file = join(dir, name);
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return file;
}

describe("production evidence reuse audit", () => {
  it("rejects stale or blocked historical evidence without leaking private details", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-evidence-reuse-"));
    const approvedReleaseRunIdLabel = "UAIS-enterprise-run-2026-07-XX";
    const fakePrivatePath = [
      "",
      "Users",
      "owner",
      "private",
      "2026-06-21-vercel-env-sync-full-ui-apply.json",
    ].join("/");
    const fakeUrl = ["https://", "private-provider.example.test", "/auth"].join("");
    const fakeCookie = ["cookie:", " secret"].join("");

    const intake = writeJson(tmpDir, "app-auth-intake.json", {
      target: "app-auth-env-source-intake",
      status: "app-auth-env-source-intake-awaiting-approved-source-path",
      approvedReleaseRunIdLabel,
      approvedProviderMode: "trusted-account-provider",
      summary: {
        readyForVercelEnvSyncDryRun: false,
        envFileProvided: false,
        missingEnvNameCount: 4,
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
      safety: {
        envFileRead: false,
      },
    });
    const preflight = writeJson(tmpDir, "app-auth-preflight.json", {
      target: "app-auth-production-evidence-preflight",
      approvedReleaseRunIdLabel,
      approvedProviderMode: "trusted-account-provider",
      requiredServerOnlyEnvNames: [
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_APP_AUTH_PROVIDER_URL",
        "UAIS_APP_AUTH_PROVIDER_TOKEN",
      ],
    });
    const envSyncGate = writeJson(tmpDir, "app-auth-env-sync-gate.json", {
      target: "app-auth-vercel-env-sync-evidence-gate",
      status: "app-auth-vercel-env-sync-evidence-gate-awaiting-vercel-env-sync-evidence",
      summary: {
        applyEvidenceAccepted: false,
        appAuthReadinessMayProceed: false,
      },
    });
    const productionGate = writeJson(tmpDir, "app-auth-production-gate.json", {
      target: "app-auth-production-evidence-gate",
      status: "app-auth-production-evidence-gate-awaiting-readiness-evidence",
      summary: {
        appAuthProductionEvidenceCleared: false,
      },
    });
    const staleEnvSync = writeJson(tmpDir, "stale-env-sync.json", {
      target: "vercel-env-sync",
      mode: "apply",
      status: "applied",
      releaseRunId: "old-release-run",
      appAuthProviderMode: "trusted-account-provider",
      projectReadinessEvidenceStatus: "ready",
      targets: ["production", "preview"],
      applySummary: {
        status: "applied",
        appliedActions: 8,
        valuesRedacted: true,
        cliOutputOmitted: true,
      },
      entries: [
        { name: "UAIS_TEACHER_AUTH_PROVIDER", status: "present" },
        { name: "UAIS_EXTERNAL_STORAGE_BASE_URL", status: "present" },
      ],
      rawUrl: fakeUrl,
      cookie: fakeCookie,
    });
    const blockedReadiness = writeJson(tmpDir, "blocked-readiness.json", {
      target: "app-auth-provider-readiness",
      mode: "live",
      environment: "production",
      status: "blocked",
      releaseRunId: "old-release-run",
      appAuthProviderMode: "trusted-account-provider",
      providerUrl: fakeUrl,
      localSourcePath: fakePrivatePath,
      safety: {
        valuesRedacted: true,
      },
    });

    const output = execFileSync("node", [
      "scripts/production-evidence-reuse-audit.mjs",
      "--app-auth-env-source-intake",
      intake,
      "--app-auth-preflight",
      preflight,
      "--app-auth-vercel-env-sync-evidence-gate",
      envSyncGate,
      "--app-auth-production-evidence-gate",
      productionGate,
      "--candidate",
      staleEnvSync,
      "--candidate",
      blockedReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "production-evidence-reuse-audit",
        status: "production-evidence-reuse-audit-blocked",
        releaseReady: false,
        responsibleSession: "S22/S19",
        summary: {
          candidateCount: 2,
          reusableCandidateCount: 0,
          rejectedCandidateCount: 2,
          currentFirstBlocker: "app-auth-approved-source-path-missing",
          releaseReady: false,
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
          evidenceFilesReadOnly: true,
        },
      }),
    );
    expect(body.currentGateStatus).toEqual({
      appAuthEnvSourceIntake: "app-auth-env-source-intake-awaiting-approved-source-path",
      appAuthVercelEnvSyncEvidenceGate:
        "app-auth-vercel-env-sync-evidence-gate-awaiting-vercel-env-sync-evidence",
      appAuthProductionEvidenceGate:
        "app-auth-production-evidence-gate-awaiting-readiness-evidence",
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
    expect(body.candidates).toEqual([
      expect.objectContaining({
        fileName: "stale-env-sync.json",
        target: "vercel-env-sync",
        reusable: false,
        rejectionReasons: [
          "release-run-id-mismatch",
          "required-app-auth-env-missing",
        ],
        missingRequiredEnvNames: [
          "UAIS_APP_SESSION_SIGNING_SECRET",
          "UAIS_APP_AUTH_PROVIDER",
          "UAIS_APP_AUTH_PROVIDER_URL",
          "UAIS_APP_AUTH_PROVIDER_TOKEN",
        ],
      }),
      expect.objectContaining({
        fileName: "blocked-readiness.json",
        target: "app-auth-provider-readiness",
        reusable: false,
        rejectionReasons: [
          "status-not-ready",
          "release-run-id-mismatch",
          "readiness-result-proof-missing",
          "readiness-redaction-safety-incomplete",
        ],
      }),
    ]);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(fakePrivatePath);
    expect(serialized).not.toContain(fakeUrl);
    expect(serialized).not.toContain(fakeCookie);

    const markdown = execFileSync("node", [
      "scripts/production-evidence-reuse-audit.mjs",
      "--app-auth-env-source-intake",
      intake,
      "--app-auth-preflight",
      preflight,
      "--app-auth-vercel-env-sync-evidence-gate",
      envSyncGate,
      "--app-auth-production-evidence-gate",
      productionGate,
      "--candidate",
      staleEnvSync,
      "--candidate",
      blockedReadiness,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("## Operator Input Packet");
    expect(markdown).toContain("- First required input: `approved-env-source-path`");
    expect(markdown).toContain("- Next command template: `approvedSourceHandleIntake`");
    expect(markdown).not.toContain(fakePrivatePath);
    expect(markdown).not.toContain(fakeUrl);
    expect(markdown).not.toContain(fakeCookie);
  });
});
