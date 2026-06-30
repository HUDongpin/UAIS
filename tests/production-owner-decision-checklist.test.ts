import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production owner decision checklist", () => {
  it("turns blocked release evidence into redacted owner decisions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "deployed-teacher-workflow-page-not-live-passed",
        "vercel-project-candidate-missing",
        "vercel-env-not-applied",
        "app-auth-provider-readiness-not-live-ready",
        "vercel-env-apply-summary-not-proven",
        "teacher-auth-provider-readiness-not-live-ready",
        "teacher-auth-provider-readiness-not-production",
        "external-storage-service-readiness-not-live-ready",
        "vercel-production-deployment-not-proven",
        "deployed-learning-ppt-playback-not-live-passed",
        "deployment-route-smoke-not-live-passed",
        "external-storage-smoke-not-live-passed",
        "manual-ppt-playback-not-accepted",
      ],
    });
    const vercelProjectReadiness = writeJson(tmpDir, "vercel-project-readiness.json", {
      target: "vercel-project-readiness",
      mode: "local",
      status: "blocked",
      checks: [
        { id: "s22-vercel-cli", status: "present" },
        { id: "s22-vercel-auth", status: "present" },
        { id: "s22-vercel-team-scope", status: "present", teamCount: 1 },
        {
          id: "s22-vercel-project-candidate",
          status: "missing",
          filteredProjectCount: 2,
          exactProjectNameCount: 0,
        },
        { id: "s22-vercel-project-link", status: "missing" },
        { id: "s22-vercelignore-upload-hygiene", status: "present" },
      ],
      blockedReasons: ["vercel-project-candidate-missing", "vercel-project-not-linked"],
      leakedUrl: "https://private-production.example.test",
      leakedToken: "secret-production-token",
    });
    const alternateVercelProjectReadiness = writeJson(
      tmpDir,
      "vercel-project-readiness-alt.json",
      {
        target: "vercel-project-readiness",
        mode: "local",
        status: "blocked",
        checks: [
          {
            id: "s22-vercel-project-candidate",
            status: "missing",
            filteredProjectCount: 0,
            exactProjectNameCount: 0,
          },
        ],
      },
    );
    const localDryRunContract = readLocalProductionDryRunContract();
    const localProduction = writeJson(tmpDir, "local-production.json", {
      target: "local-production-e2e-smoke",
      mode: "live",
      environment: "local-production",
      status: "passed",
      checks: [
        { id: "s22-local-external-storage-reference-service", status: "passed" },
        { id: "s22-next-production-build", status: "passed" },
        { id: "s22-next-start-local-production-server", status: "passed" },
        { id: "s22-local-learning-ppt-playback-smoke", status: "passed" },
        { id: "s22-local-teacher-workflow-page-smoke", status: "passed" },
        {
          id: "s22-local-teacher-workflow-browser-smoke",
          status: "passed",
          results: {
            openTeachingPage: "passed",
            browserHydration: "passed",
            voiceSampleDurationGate: "passed",
            voiceSampleFileSelection: "passed",
            serverWorkflowRefresh: "passed",
            signedSessionBootstrap: "passed",
            voiceSampleSubmit: "passed",
            voiceClonePreflight: "passed",
            voiceCloneStatus: "passed",
            pptNarrationSubmit: "passed",
            pptNarrationSlidePayload: "passed",
            perSlideWavDownloadLinks: "passed",
            perSlideWavDownloadHrefContract: "passed",
          },
        },
        { id: "s22-local-protected-route-smoke", status: "passed" },
        { id: "s22-local-app-auth-provider-readiness", status: "passed" },
        { id: "s22-local-teaching-course-management-route-smoke", status: "passed" },
        { id: "s22-local-teaching-operations-route-smoke", status: "passed" },
        {
          id: "s22-local-teaching-operation-detail-browser-smoke",
          status: "passed",
          results: Object.fromEntries(
            localDryRunContract.browserProofSummaries[
              "s22-local-teaching-operation-detail-browser-smoke"
            ].map((resultKey) => [resultKey, "passed"]),
          ),
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
      "--vercel-project-readiness",
      vercelProjectReadiness,
      "--alternate-vercel-project-readiness",
      alternateVercelProjectReadiness,
      "--local-production-e2e",
      localProduction,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "production-owner-decision-checklist",
        status: "owner-decisions-required",
        responsibleSession: "S22",
        releaseGateStatus: "blocked",
        localProductionDiagnostic: {
          status: "passed",
          evidenceFreshness: "current",
          releaseEligible: false,
          requirementSource: "local-production-e2e-smoke-dry-run",
          requiredChecks: localDryRunContract.requiredChecks,
          missingRequiredChecks: [],
          browserProofStatus: "passed",
          requiredBrowserResults: localDryRunContract.requiredBrowserResults,
          missingBrowserResults: [],
          passedChecks: [
            "s22-local-external-storage-reference-service",
            "s22-next-production-build",
            "s22-next-start-local-production-server",
            "s22-local-learning-ppt-playback-smoke",
            "s22-local-teacher-workflow-page-smoke",
            "s22-local-teacher-workflow-browser-smoke",
            "s22-local-protected-route-smoke",
            "s22-local-app-auth-provider-readiness",
            "s22-local-teaching-course-management-route-smoke",
            "s22-local-teaching-operations-route-smoke",
            "s22-local-teaching-operation-detail-browser-smoke",
          ],
        },
        safety: {
          valuesRedacted: true,
          evidencePathsOmitted: true,
          projectNamesOmitted: true,
          projectIdsOmitted: true,
          deploymentUrlsOmitted: true,
          localPrivatePathsOmitted: true,
          tokensOmitted: true,
        },
      }),
    );
    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vercel-project-selection",
          status: "owner-decision-needed",
          responsibleSessions: ["Owner", "S22"],
          blockedReasons: ["vercel-project-candidate-missing", "vercel-project-not-linked"],
          readinessSummary: {
            cli: "present",
            auth: "present",
            teamScope: "present",
            projectCandidate: "missing",
            projectLink: "missing",
            uploadHygiene: "present",
            filteredProjectCount: 2,
            exactProjectNameCount: 0,
            alternateExactProjectNameCount: 0,
          },
        }),
        expect.objectContaining({
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
          blockedReasons: expect.arrayContaining([
            "app-auth-provider-readiness-not-live-ready",
          ]),
          acceptedOptions: ["trusted-account-provider"],
          proofNeeded: expect.arrayContaining([
            "trusted-account-provider-remote-https-endpoint",
            "app-session-cookie-pair-contract",
            "ordinary-teaching-app-auth-readiness-binding",
          ]),
        }),
        expect.objectContaining({
          id: "teacher-auth-provider-production-selector",
          status: "owner-decision-needed",
          blockedReasons: expect.arrayContaining([
            "teacher-auth-provider-readiness-not-production",
          ]),
          acceptedOptions: ["trusted-cookie-issuer", "oidc-jwks"],
          proofNeeded: expect.arrayContaining([
            "production-session-cookie-pair-contract",
            "trusted-cookie-session-issuer-separation-if-selected",
            "trusted-cookie-session-round-trip-proof-if-selected",
            "oidc-jwks-signing-key-readiness-if-oidc-selected",
          ]),
        }),
        expect.objectContaining({
          id: "external-storage-production-service",
          status: "owner-decision-needed",
          proofNeeded: expect.arrayContaining([
            "production-launcher-env-contract",
            "container-runtime-artifact",
            "container-build-readiness-evidence",
            "production-service-mode-health-target",
            "service-api-contract-version-proof",
          ]),
        }),
        expect.objectContaining({
          id: "vercel-env-deploy-and-smoke-chain",
          status: "waiting-for-upstream-owner-decisions",
          blockedReasons: expect.arrayContaining([
            "vercel-env-apply-summary-not-proven",
          ]),
          proofNeeded: expect.arrayContaining([
            "vercel-env-apply-summary-redacted-counts",
            "deployed-browser-live-workflow-status-read",
            "deployed-learning-ppt-playback-smoke",
            "protected-route-teacher-workflow-download-contract",
          ]),
        }),
        expect.objectContaining({
          id: "manual-ppt-playback-acceptance",
          status: "human-qa-needed",
          proofNeeded: expect.arrayContaining([
            "same-release-run-id-bound-to-manual-record",
          ]),
        }),
        expect.objectContaining({
          id: "production-release-run",
          status: "waiting-for-upstream-evidence",
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("private-production.example.test");
    expect(output).not.toContain("secret-production-token");
    expect(output).not.toContain("https://");
  });

  it("routes app-auth readiness and ordinary-teaching binding blockers to an owner decision", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-app-auth-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "app-auth-provider-readiness-not-live-ready",
        "teaching-operations-route-smoke-app-auth-readiness-binding-not-proven",
      ],
      requirements: [
        {
          id: "app-auth-provider-readiness",
          status: "blocked",
          evidenceStatus: "dry-run-blocked",
          blockedReason: "app-auth-provider-readiness-not-live-ready",
          evidenceEnvironment: "production",
          appAuthProviderMode: "trusted-account-provider",
          endpointSecurity: "remote-https",
          appSessionCookieContract: {
            signingSecretStrength: "sufficient",
            cookiePair: "proved",
            valueRedacted: true,
          },
          trustedAccountProviderContract: {
            providerKind: "trusted-account-provider",
            endpoint: "configured",
            bearerCredential: "configured",
            accessTokenStrength: "sufficient",
            responseUserShape: "proved",
            valueRedacted: true,
          },
          vercelEnvSyncEvidence: {
            status: "not-applied",
            applyPreflight: "missing",
            releaseRunIdStatus: "missing",
            requiredAppAuthEnvStatus: "missing",
            valueRedacted: true,
          },
          redactionSafety: {
            valuesRedacted: "proved",
            secretsOmitted: "proved",
            providerUrlsOmitted: "proved",
            responseBodiesOmitted: "proved",
            localPrivatePathsOmitted: "proved",
            liveRequiresApproval: "proved",
            cookieValuesOmitted: "proved",
            providerNetworkCallPerformed: "missing",
          },
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
          blockedReasons: expect.arrayContaining([
            "app-auth-provider-readiness-not-live-ready",
            "teaching-operations-route-smoke-app-auth-readiness-binding-not-proven",
          ]),
          appAuthProviderReadinessSummary: expect.objectContaining({
            evidenceStatus: "dry-run-blocked",
            blockedReason: "app-auth-provider-readiness-not-live-ready",
            evidenceEnvironment: "production",
            appAuthProviderMode: "trusted-account-provider",
            endpointSecurity: "remote-https",
            appSessionCookieContract: expect.objectContaining({
              signingSecretStrength: "sufficient",
              cookiePair: "proved",
              valueRedacted: true,
            }),
            trustedAccountProviderContract: expect.objectContaining({
              providerKind: "trusted-account-provider",
              endpoint: "configured",
              bearerCredential: "configured",
              accessTokenStrength: "sufficient",
              responseUserShape: "proved",
              valueRedacted: true,
            }),
          }),
          proofNeeded: expect.arrayContaining([
            "vercel-env-sync-app-auth-selector-and-env-binding",
            "ordinary-teaching-app-auth-readiness-binding",
          ]),
          safeNextActions: expect.arrayContaining([
            "confirm-production-app-auth-provider-mode",
            "bind-server-only-app-auth-env-through-s19-vercel-env-sync",
            "run-approved-app-auth-provider-readiness-after-env-sync",
            "run-ordinary-teaching-smokes-only-after-app-auth-readiness-is-live-ready",
          ]),
          forbiddenUntilApproved: expect.arrayContaining([
            "inspect-or-print-app-auth-credential-values",
            "run-live-app-auth-provider-network-call",
            "run-production-smokes-dependent-on-app-auth",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("derives local production diagnostic requirements from the local dry-run smoke plan", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-local-contract-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [],
    });
    const localProduction = writeJson(tmpDir, "local-production-empty.json", {
      target: "local-production-e2e-smoke",
      mode: "live",
      environment: "local-production",
      status: "passed",
      checks: [],
    });
    const localDryRunContract = readLocalProductionDryRunContract();

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
      "--local-production-e2e",
      localProduction,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.localProductionDiagnostic).toEqual(
      expect.objectContaining({
        requirementSource: "local-production-e2e-smoke-dry-run",
        requiredChecks: localDryRunContract.requiredChecks,
        missingRequiredChecks: localDryRunContract.requiredChecks,
        requiredBrowserResults: localDryRunContract.requiredBrowserResults,
        missingBrowserResults: localDryRunContract.requiredBrowserResults,
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("summarizes release gate waiting requirements without leaking evidence details", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-waiting-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "deployed-teacher-workflow-page-not-live-passed",
        "vercel-production-deployment-not-proven",
      ],
      requirements: [
        {
          id: "teacher-workflow-browser-smoke",
          status: "blocked",
          evidenceStatus: "waiting-for-deployed-page",
          blockedReason: "deployed-teacher-workflow-page-not-live-passed",
          upstreamRequirement: "deployed-teacher-workflow-page",
          leakedEvidencePath: "/Users/private/deployed-browser-smoke.json",
          leakedUrl: "https://private-production.example.test",
        },
        {
          id: "teaching-operations-route-smoke",
          status: "blocked",
          evidenceStatus: "dry-run-blocked",
          blockedReason: "teaching-operations-route-smoke-not-live-passed",
          leakedEvidencePath: "/Users/private/teaching-operations-smoke.json",
        },
        {
          id: "ppt-manual-playback-acceptance",
          status: "blocked",
          evidenceStatus: "plan-blocked",
          blockedReason: "manual-ppt-playback-not-accepted",
          manualRecordPath: "/Users/private/manual-ppt-record.json",
        },
        {
          id: "production-release-run-consistency",
          status: "blocked",
          evidenceStatus: "waiting-for-production-evidence",
          blockedReason: "vercel-production-deployment-not-proven",
          releaseRunIds: {
            vercelProductionDeployment: "waiting",
            routeSmoke: "waiting",
          },
        },
        {
          id: "website-teacher-workflow-ui",
          status: "satisfied",
          evidenceStatus: "feature-evidence-passed",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.releaseGateBlockedRequirements).toEqual([
      {
        id: "teacher-workflow-browser-smoke",
        evidenceStatus: "waiting-for-deployed-page",
        blockedReason: "deployed-teacher-workflow-page-not-live-passed",
        upstreamRequirement: "deployed-teacher-workflow-page",
      },
      {
        id: "teaching-operations-route-smoke",
        evidenceStatus: "dry-run-blocked",
        blockedReason: "teaching-operations-route-smoke-not-live-passed",
      },
      {
        id: "ppt-manual-playback-acceptance",
        evidenceStatus: "plan-blocked",
        blockedReason: "manual-ppt-playback-not-accepted",
      },
      {
        id: "production-release-run-consistency",
        evidenceStatus: "waiting-for-production-evidence",
        blockedReason: "vercel-production-deployment-not-proven",
      },
    ]);
    expect(body.releaseGateWaitingRequirements).toEqual([
      {
        id: "teacher-workflow-browser-smoke",
        evidenceStatus: "waiting-for-deployed-page",
        blockedReason: "deployed-teacher-workflow-page-not-live-passed",
        upstreamRequirement: "deployed-teacher-workflow-page",
      },
      {
        id: "production-release-run-consistency",
        evidenceStatus: "waiting-for-production-evidence",
        blockedReason: "vercel-production-deployment-not-proven",
      },
    ]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://");
    expect(output).not.toContain("private-production.example.test");
    expect(output).not.toContain("teaching-operations-smoke.json");
    expect(output).not.toContain("manual-ppt-record.json");
    expect(output).not.toContain("releaseRunIds");
  });

  it("uses complete release gate blocked requirement reasons when legacy blocked reasons omit waiting blockers", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-complete-blockers-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: ["teacher-workflow-browser-smoke-api-interception-not-proven"],
      blockedRequirementCount: 4,
      blockedRequirementReasons: [
        "teacher-workflow-browser-smoke-api-interception-not-proven",
        "teaching-operations-route-smoke-evidence-missing",
        "external-storage-service-readiness-not-live-ready",
        "vercel-production-deployment-not-proven",
      ],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "external-storage-production-service",
          blockedReasons: expect.arrayContaining([
            "external-storage-service-readiness-not-live-ready",
          ]),
        }),
        expect.objectContaining({
          id: "vercel-env-deploy-and-smoke-chain",
          blockedReasons: expect.arrayContaining([
            "teacher-workflow-browser-smoke-api-interception-not-proven",
            "teaching-operations-route-smoke-evidence-missing",
            "vercel-production-deployment-not-proven",
          ]),
        }),
        expect.objectContaining({
          id: "production-release-run",
          status: "waiting-for-upstream-evidence",
          blockedReasons: expect.arrayContaining([
            "teacher-workflow-browser-smoke-api-interception-not-proven",
            "teaching-operations-route-smoke-evidence-missing",
            "external-storage-service-readiness-not-live-ready",
            "vercel-production-deployment-not-proven",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("surfaces enterprise live evidence audit blockers as an owner-facing evidence decision", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-enterprise-live-audit-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: ["enterprise-live-evidence-audit-not-ready"],
      blockedRequirementReasons: [
        "enterprise-live-evidence-audit-not-ready",
        "enterprise-live-required-targets-missing",
        "production-live-release-run-id-mismatch",
      ],
      requirements: [
        {
          id: "enterprise-live-evidence-audit",
          status: "blocked",
          evidenceStatus: "blocked",
          blockedReason: "enterprise-live-evidence-audit-not-ready",
          acceptedLiveEvidence: 0,
          filenameOnlyOrBlocked: 15,
          releaseRunIdConsistency: "mismatched",
          requiredTargetProofStatus: "missing",
          requiredTargetResultCriteriaStatus: "proved",
          requiredTargetContractCriteriaStatus: "missing",
          acceptedTargetStatusCriteriaStatus: "proved",
          acceptedTargetModeCriteriaStatus: "proved",
          acceptedBodyFieldCriteriaStatus: "proved",
          missingRequiredTargets: [
            "teacher-auth-issuer-route-smoke",
            "teaching-course-management-route-smoke",
          ],
          leakedEvidencePath: "/Users/private/enterprise-live-evidence-audit.json",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "enterprise-live-evidence-audit",
          status: "waiting-for-live-evidence",
          responsibleSessions: ["S22"],
          blockedReasons: expect.arrayContaining([
            "enterprise-live-evidence-audit-not-ready",
            "enterprise-live-required-targets-missing",
            "production-live-release-run-id-mismatch",
          ]),
          proofNeeded: expect.arrayContaining([
            "body-level-production-live-evidence-audit-proof",
            "all-orchestrated-production-live-targets-present",
            "shared-release-run-id-across-production-live-evidence",
            "required-production-live-safety-redaction-flags",
            "target-specific-result-proof-keys-body-proven",
            "target-specific-contract-proof-keys-body-proven",
          ]),
          safeNextActions: expect.arrayContaining([
            "wait-for-approved-production-live-evidence-files",
            "run-enterprise-live-evidence-audit-after-all-target-evidence-exists",
            "reject-filename-only-or-blocked-evidence-records",
            "verify-shared-release-run-id-across-production-live-evidence",
            "attach-audit-summary-before-final-release-run",
          ]),
          forbiddenUntilApproved: expect.arrayContaining([
            "mark-enterprise-audit-ready-with-missing-required-targets",
            "accept-filename-only-production-live-evidence",
            "accept-mismatched-release-run-id-production-evidence",
            "publish-audit-with-local-private-paths-or-raw-urls",
            "treat-local-or-dry-run-evidence-as-live-production-evidence",
          ]),
          enterpriseAuditSummary: {
            evidenceStatus: "blocked",
            acceptedLiveEvidence: 0,
            filenameOnlyOrBlocked: 15,
            releaseRunIdConsistency: "mismatched",
            requiredTargetProofStatus: "missing",
            requiredTargetResultCriteriaStatus: "proved",
            requiredTargetContractCriteriaStatus: "missing",
            missingRequiredTargetCount: 2,
            missingRequiredTargets: [
              "teacher-auth-issuer-route-smoke",
              "teaching-course-management-route-smoke",
            ],
            acceptedTargetStatusCriteriaStatus: "proved",
            acceptedTargetModeCriteriaStatus: "proved",
            acceptedBodyFieldCriteriaStatus: "proved",
          },
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("enterprise-live-evidence-audit.json");
  });

  it("keeps manual PPT acceptance actionable when only release-run binding is missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-ppt-release-run-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: ["manual-ppt-release-run-binding-not-proven"],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "manual-ppt-playback-acceptance",
          status: "human-qa-needed",
          blockedReasons: ["manual-ppt-release-run-binding-not-proven"],
          proofNeeded: expect.arrayContaining([
            "same-release-run-id-bound-to-manual-record",
          ]),
          safeNextActions: expect.arrayContaining([
            "package-manual-ppt-playback-evidence-for-human-review",
            "verify-powerpoint-and-wps-playback-after-production-deployment",
            "bind-manual-ppt-record-to-release-run-and-vercel-deployment",
            "confirm-target-cloned-voice-label-and-per-slide-audio",
            "submit-human-accepted-playback-record-for-release-gate",
          ]),
          forbiddenUntilApproved: expect.arrayContaining([
            "mark-manual-ppt-accepted-before-human-playback",
            "reuse-manual-ppt-record-from-different-release-run",
            "reuse-manual-ppt-record-from-different-vercel-deployment",
            "accept-missing-target-voice-label-or-slide-audio",
            "log-private-ppt-package-paths-or-audio-urls",
          ]),
        }),
        expect.objectContaining({
          id: "production-release-run",
          status: "waiting-for-upstream-evidence",
          safeNextActions: expect.arrayContaining([
            "wait-for-final-release-gate-ready",
            "bind-one-public-release-run-id-after-all-production-evidence-is-ready",
            "verify-owner-checklist-has-no-waiting-or-blocked-decisions",
            "publish-release-run-summary-with-redacted-evidence-only",
          ]),
          forbiddenUntilApproved: expect.arrayContaining([
            "bind-release-run-id-while-release-gate-blocked",
            "mix-production-evidence-from-multiple-release-run-ids",
            "include-local-private-paths-or-secret-values-in-release-run-summary",
            "treat-owner-decisions-required-as-release-ready",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("keeps manual PPT target-voice label blockers attached to human QA", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-ppt-target-voice-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: ["manual-ppt-target-voice-label-not-proven"],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "manual-ppt-playback-acceptance",
          status: "human-qa-needed",
          blockedReasons: ["manual-ppt-target-voice-label-not-proven"],
          proofNeeded: expect.arrayContaining([
            "target-cloned-voice-label-present",
            "target-cloned-voice-heard-per-slide",
          ]),
        }),
        expect.objectContaining({
          id: "production-release-run",
          status: "waiting-for-upstream-evidence",
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("keeps missing or mismatched manual PPT acceptance evidence attached to human QA", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-ppt-evidence-shape-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "ppt-manual-acceptance-evidence-missing",
        "ppt-manual-acceptance-target-mismatch",
      ],
      leakedUrl: "https://private-ppt.example.test",
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "manual-ppt-playback-acceptance",
          status: "human-qa-needed",
          blockedReasons: [
            "ppt-manual-acceptance-evidence-missing",
            "ppt-manual-acceptance-target-mismatch",
          ],
          proofNeeded: expect.arrayContaining([
            "human-powerpoint-playback-accepted",
            "human-wps-playback-accepted",
            "explicit-accepted-after-human-playback-status",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("private-ppt.example.test");
    expect(output).not.toContain("https://");
  });

  it("keeps production deployment binding blockers attached to owner decisions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-deployment-binding-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "teacher-workflow-browser-smoke-vercel-deployment-binding-not-proven",
        "deployed-learning-ppt-playback-vercel-deployment-binding-not-proven",
        "teaching-operations-route-smoke-vercel-deployment-binding-not-proven",
        "deployment-route-smoke-teacher-auth-readiness-binding-not-proven",
        "manual-ppt-deployment-fingerprint-binding-not-proven",
      ],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vercel-env-deploy-and-smoke-chain",
          blockedReasons: expect.arrayContaining([
            "teacher-workflow-browser-smoke-vercel-deployment-binding-not-proven",
            "deployed-learning-ppt-playback-vercel-deployment-binding-not-proven",
            "teaching-operations-route-smoke-vercel-deployment-binding-not-proven",
            "deployment-route-smoke-teacher-auth-readiness-binding-not-proven",
          ]),
          proofNeeded: expect.arrayContaining([
            "same-vercel-production-deployment-bound-to-browser-learning-and-route-smokes",
          ]),
        }),
        expect.objectContaining({
          id: "manual-ppt-playback-acceptance",
          status: "human-qa-needed",
          blockedReasons: ["manual-ppt-deployment-fingerprint-binding-not-proven"],
          proofNeeded: expect.arrayContaining([
            "same-vercel-production-deployment-bound-to-manual-playback-record",
          ]),
        }),
        expect.objectContaining({
          id: "production-release-run",
          status: "waiting-for-upstream-evidence",
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("keeps detailed deployed smoke blockers attached to the Vercel chain decision", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-deployed-smoke-detail-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "deployed-teacher-workflow-page-not-production",
        "deployed-teacher-workflow-page-fingerprint-missing",
        "deployed-teacher-workflow-page-rendered-fingerprint-missing",
        "deployed-teacher-workflow-page-origin-not-remote-https",
        "deployed-teacher-workflow-page-vercel-deployment-release-run-not-proven",
        "deployed-teacher-workflow-page-vercel-deployment-binding-not-proven",
        "teacher-workflow-browser-smoke-not-production",
        "teacher-workflow-browser-smoke-origin-not-remote-https",
        "teacher-workflow-browser-smoke-api-interception-not-proven",
        "teacher-workflow-browser-smoke-vercel-deployment-release-run-not-proven",
        "teacher-workflow-browser-smoke-fingerprint-mismatch",
        "deployed-learning-ppt-playback-not-production",
        "deployed-learning-ppt-playback-origin-not-remote-https",
        "deployed-learning-ppt-playback-http-status-not-proven",
        "deployed-learning-ppt-playback-contract-not-proven",
        "deployed-learning-ppt-playback-vercel-deployment-release-run-not-proven",
        "deployment-route-smoke-not-production",
        "deployment-route-smoke-vercel-deployment-release-run-not-proven",
        "deployment-route-smoke-vercel-deployment-binding-not-proven",
        "teaching-operations-route-smoke-vercel-deployment-release-run-not-proven",
        "teaching-operations-route-smoke-vercel-deployment-binding-not-proven",
        "deployment-route-smoke-auth-chain-not-issued",
        "deployment-route-smoke-auth-provider-mode-not-proven",
        "deployment-route-smoke-trusted-issuer-auth-not-proven",
        "deployment-route-smoke-oidc-issuer-auth-not-proven",
        "deployment-route-smoke-issuer-cookie-hardening-not-proven",
        "deployment-route-smoke-response-shape-not-proven",
        "deployment-route-smoke-origin-not-remote-https",
        "deployment-route-smoke-teacher-auth-readiness-release-run-not-proven",
      ],
      leakedUrl: "https://private-production.example.test",
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vercel-env-deploy-and-smoke-chain",
          blockedReasons: expect.arrayContaining([
            "deployed-teacher-workflow-page-not-production",
            "deployed-teacher-workflow-page-fingerprint-missing",
            "deployed-teacher-workflow-page-rendered-fingerprint-missing",
            "deployed-teacher-workflow-page-origin-not-remote-https",
            "deployed-teacher-workflow-page-vercel-deployment-release-run-not-proven",
            "deployed-teacher-workflow-page-vercel-deployment-binding-not-proven",
            "teacher-workflow-browser-smoke-not-production",
            "teacher-workflow-browser-smoke-origin-not-remote-https",
            "teacher-workflow-browser-smoke-api-interception-not-proven",
            "teacher-workflow-browser-smoke-vercel-deployment-release-run-not-proven",
            "teacher-workflow-browser-smoke-fingerprint-mismatch",
            "deployed-learning-ppt-playback-not-production",
            "deployed-learning-ppt-playback-origin-not-remote-https",
            "deployed-learning-ppt-playback-http-status-not-proven",
            "deployed-learning-ppt-playback-contract-not-proven",
            "deployed-learning-ppt-playback-vercel-deployment-release-run-not-proven",
            "deployment-route-smoke-not-production",
            "deployment-route-smoke-vercel-deployment-release-run-not-proven",
            "deployment-route-smoke-vercel-deployment-binding-not-proven",
            "teaching-operations-route-smoke-vercel-deployment-release-run-not-proven",
            "teaching-operations-route-smoke-vercel-deployment-binding-not-proven",
            "deployment-route-smoke-auth-chain-not-issued",
            "deployment-route-smoke-auth-provider-mode-not-proven",
            "deployment-route-smoke-trusted-issuer-auth-not-proven",
            "deployment-route-smoke-oidc-issuer-auth-not-proven",
            "deployment-route-smoke-issuer-cookie-hardening-not-proven",
            "deployment-route-smoke-response-shape-not-proven",
            "deployment-route-smoke-origin-not-remote-https",
            "deployment-route-smoke-teacher-auth-readiness-release-run-not-proven",
          ]),
          proofNeeded: expect.arrayContaining([
            "same-vercel-production-deployment-bound-to-browser-learning-and-route-smokes",
            "protected-route-teacher-workflow-download-contract",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("private-production.example.test");
    expect(output).not.toContain("https://");
  });

  it("keeps AI direct-call boundary blockers attached to the deployed smoke owner decision", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-ai-direct-call-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "deployment-route-smoke-direct-call-boundary-not-proven",
      ],
      leakedUrl: "https://private-ai-route.example.test",
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vercel-env-deploy-and-smoke-chain",
          status: "waiting-for-upstream-owner-decisions",
          blockedReasons: expect.arrayContaining([
            "deployment-route-smoke-direct-call-boundary-not-proven",
          ]),
          proofNeeded: expect.arrayContaining([
            "protected-route-signed-session-direct-call-denial",
            "protected-route-legacy-scoped-header-direct-call-denial",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("private-ai-route.example.test");
    expect(output).not.toContain("https://");
  });

  it("routes live provider mutation blockers to explicit owner-approved generation proof", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-live-provider-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "teacher-workflow-live-generation-provider-mutation-not-proven",
        "teacher-workflow-live-generation-auth-not-issued-teacher-cookie",
      ],
      leakedUrl: "https://private-live-provider.example.test",
      leakedProviderToken: "secret-live-provider-token",
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vercel-env-deploy-and-smoke-chain",
          status: "waiting-for-upstream-owner-decisions",
          blockedReasons: expect.arrayContaining([
            "teacher-workflow-live-generation-provider-mutation-not-proven",
            "teacher-workflow-live-generation-auth-not-issued-teacher-cookie",
          ]),
          proofNeeded: expect.arrayContaining([
            "owner-approved-teacher-workflow-live-provider-mutation",
            "teacher-workflow-live-generation-provider-mutation-proof",
            "teacher-workflow-live-generation-cookie-redaction-and-remote-approval-safety-proof",
            "teacher-workflow-live-generation-issued-teacher-auth-cookie",
            "same-release-run-id-bound-to-live-provider-generation",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("private-live-provider.example.test");
    expect(output).not.toContain("secret-live-provider-token");
    expect(output).not.toContain("https://");
  });

  it("marks local production diagnostics stale without ordinary teaching route smokes and full browser proof", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-local-ordinary-stale-"));
    const passedCheckIds = [
      "s22-local-external-storage-reference-service",
      "s22-next-production-build",
      "s22-next-start-local-production-server",
      "s22-local-learning-ppt-playback-smoke",
      "s22-local-teacher-workflow-page-smoke",
      "s22-local-teacher-workflow-browser-smoke",
      "s22-local-protected-route-smoke",
    ];
    const passedBrowserResults = [
      "voiceSampleDurationGate",
      "signedSessionBootstrap",
      "voiceClonePreflight",
      "voiceCloneStatus",
      "pptNarrationSubmit",
      "pptNarrationSlidePayload",
      "perSlideWavDownloadLinks",
      "perSlideWavDownloadHrefContract",
    ];
    const localDryRunContract = readLocalProductionDryRunContract();
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [],
    });
    const localProduction = writeJson(tmpDir, "local-production-old-ai-only.json", {
      target: "local-production-e2e-smoke",
      mode: "live",
      environment: "local-production",
      status: "passed",
      checks: [
        ...passedCheckIds
          .filter((checkId) => checkId !== "s22-local-teacher-workflow-browser-smoke")
          .map((checkId) => ({ id: checkId, status: "passed" })),
        {
          id: "s22-local-teacher-workflow-browser-smoke",
          status: "passed",
          results: Object.fromEntries(
            passedBrowserResults.map((resultKey) => [resultKey, "passed"]),
          ),
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
      "--local-production-e2e",
      localProduction,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.localProductionDiagnostic).toEqual(
      expect.objectContaining({
        status: "passed",
        evidenceFreshness: "stale",
        missingRequiredChecks: missingContractItems(
          localDryRunContract.requiredChecks,
          passedCheckIds,
        ),
        browserProofStatus: "missing",
        missingBrowserResults: missingContractItems(
          localDryRunContract.requiredBrowserResults,
          passedBrowserResults,
        ),
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("keeps ordinary teaching browser and course-management blockers attached to the Vercel chain decision", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-ordinary-teaching-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "teaching-operation-detail-browser-smoke-results-not-proven",
        "teaching-operation-detail-browser-smoke-live-api-not-proven",
        "teaching-operation-detail-browser-smoke-teacher-auth-readiness-binding-not-proven",
        "teaching-operation-detail-browser-smoke-auth-not-issued-teacher-cookie",
        "teaching-operation-detail-browser-smoke-vercel-deployment-binding-not-proven",
        "teaching-operations-route-smoke-origin-not-remote-https",
        "teaching-operations-route-smoke-course-management-backend-not-proven",
        "teaching-operations-route-smoke-teacher-auth-readiness-binding-not-proven",
        "teaching-operations-route-smoke-auth-not-issued-teacher-cookie",
        "external-storage-service-teaching-course-management-schema-not-proven",
        "teaching-course-management-route-smoke-results-not-proven",
        "teaching-course-management-route-smoke-external-backends-not-proven",
        "teaching-course-management-route-smoke-auth-not-issued-teacher-cookie",
        "teaching-course-management-route-smoke-origin-not-remote-https",
        "teaching-course-management-route-smoke-vercel-deployment-binding-not-proven",
      ],
      leakedUrl: "https://ordinary-teaching.example.test",
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vercel-env-deploy-and-smoke-chain",
          status: "waiting-for-upstream-owner-decisions",
          blockedReasons: expect.arrayContaining([
            "teaching-operation-detail-browser-smoke-results-not-proven",
            "teaching-operation-detail-browser-smoke-live-api-not-proven",
            "teaching-operation-detail-browser-smoke-teacher-auth-readiness-binding-not-proven",
            "teaching-operation-detail-browser-smoke-auth-not-issued-teacher-cookie",
            "teaching-operation-detail-browser-smoke-vercel-deployment-binding-not-proven",
            "teaching-operations-route-smoke-origin-not-remote-https",
            "teaching-operations-route-smoke-course-management-backend-not-proven",
            "teaching-operations-route-smoke-teacher-auth-readiness-binding-not-proven",
            "teaching-operations-route-smoke-auth-not-issued-teacher-cookie",
            "teaching-course-management-route-smoke-results-not-proven",
            "teaching-course-management-route-smoke-external-backends-not-proven",
            "teaching-course-management-route-smoke-auth-not-issued-teacher-cookie",
            "teaching-course-management-route-smoke-origin-not-remote-https",
            "teaching-course-management-route-smoke-vercel-deployment-binding-not-proven",
          ]),
          proofNeeded: expect.arrayContaining([
            "deployed-ordinary-teaching-operation-detail-browser-smoke",
            "deployed-course-management-route-smoke",
            "ordinary-teaching-operation-clicks-use-live-operations-api",
            "course-cover-and-course-management-external-backend-readback",
            "teacher-ai-ownership-external-backend-proof",
          ]),
        }),
        expect.objectContaining({
          id: "ordinary-teaching-production-evidence",
          status: "waiting-for-live-evidence",
          responsibleSessions: ["S05", "S12", "S13", "S19", "S22"],
          blockedReasons: expect.arrayContaining([
            "teaching-operation-detail-browser-smoke-results-not-proven",
            "teaching-operation-detail-browser-smoke-live-api-not-proven",
            "teaching-operation-detail-browser-smoke-teacher-auth-readiness-binding-not-proven",
            "teaching-operation-detail-browser-smoke-auth-not-issued-teacher-cookie",
            "teaching-operation-detail-browser-smoke-vercel-deployment-binding-not-proven",
            "teaching-operations-route-smoke-origin-not-remote-https",
            "teaching-operations-route-smoke-course-management-backend-not-proven",
            "teaching-operations-route-smoke-teacher-auth-readiness-binding-not-proven",
            "teaching-operations-route-smoke-auth-not-issued-teacher-cookie",
            "teaching-course-management-route-smoke-results-not-proven",
            "teaching-course-management-route-smoke-external-backends-not-proven",
            "teaching-course-management-route-smoke-auth-not-issued-teacher-cookie",
            "teaching-course-management-route-smoke-origin-not-remote-https",
            "teaching-course-management-route-smoke-vercel-deployment-binding-not-proven",
          ]),
          proofNeeded: expect.arrayContaining([
            "live-teaching-operations-route-smoke",
            "live-teaching-operation-detail-browser-smoke",
            "live-teaching-course-management-route-smoke",
            "issued-teacher-auth-cookie-bound-to-ordinary-teaching-smokes",
            "ordinary-teaching-operation-clicks-use-live-operations-api",
            "ordinary-teaching-route-smoke-provider-backed-side-effects",
            "ordinary-teaching-audit-readback-rollback-alerts",
            "ordinary-teaching-external-backup-restore-drills",
            "course-cover-and-course-management-external-backend-readback",
            "teacher-ai-ownership-external-backend-proof",
            "same-release-run-id-bound-to-ordinary-teaching-evidence",
            "same-vercel-production-deployment-bound-to-ordinary-teaching-smokes",
            "teacher-auth-provider-readiness-bound-to-ordinary-teaching-smokes",
            "external-storage-readiness-bound-to-ordinary-teaching-smokes",
          ]),
          safeNextActions: expect.arrayContaining([
            "confirm-ordinary-teaching-live-smoke-prerequisites",
            "wait-for-auth-storage-and-vercel-deployment-evidence",
            "run-live-teaching-operations-route-smoke-after-auth-storage-deployment-readiness",
            "run-live-operation-detail-and-course-management-smokes-with-issued-teacher-auth-cookie",
            "collect-release-run-bound-ordinary-teaching-evidence-for-enterprise-audit",
          ]),
          forbiddenUntilApproved: expect.arrayContaining([
            "run-live-ordinary-teaching-smokes-before-auth-storage-and-deployment-readiness",
            "call-live-teaching-operations-api-without-issued-teacher-auth-cookie",
            "run-provider-backed-side-effect-smokes-without-owner-approval",
            "accept-local-production-smoke-as-production-live-evidence",
            "print-or-log-teacher-auth-cookie-or-backend-secret-values",
          ]),
          sequencing:
            "external-storage-and-auth-readiness-before-live-ordinary-teaching-smokes",
        }),
        expect.objectContaining({
          id: "external-storage-production-service",
          status: "owner-decision-needed",
          blockedReasons: expect.arrayContaining([
            "external-storage-service-teaching-course-management-schema-not-proven",
            "teaching-operations-route-smoke-course-management-backend-not-proven",
            "teaching-course-management-route-smoke-external-backends-not-proven",
          ]),
          proofNeeded: expect.arrayContaining([
            "teaching-course-management-schema-migration-health-proof",
            "teaching-course-management-backup-restore-drill-proof",
            "ordinary-course-management-external-backend-proof",
            "teacher-ai-ownership-external-backend-proof",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("ordinary-teaching.example.test");
    expect(output).not.toContain("https://");
  });

  it("summarizes external storage readiness health schema states for owner decisions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-storage-health-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "external-storage-service-readiness-not-live-ready",
        "external-storage-service-teaching-operations-schema-not-proven",
      ],
      requirements: [
        {
          id: "external-storage-service-readiness",
          status: "blocked",
          evidenceStatus: "live-ready",
          blockedReason: "external-storage-service-teaching-operations-schema-not-proven",
          evidenceEnvironment: "production",
          health: {
            httpStatus: 200,
            status: "ok",
            target: "uais-external-storage-production-service",
            productionServiceIdentity: "proved",
            apiContractVersion: "matched",
            cacheControl: "no-store",
            durableBackingStore: "ready",
            teachingOperationsStorageSchema: {
              status: "missing",
              schemaVersion: "missing",
              migrationStatus: "missing",
              productionDatabaseAdapter: {
                status: "missing",
                providerClass: "missing",
                migrationStatus: "missing",
                backupPolicy: "missing",
                concurrencyControl: "missing",
                valueRedacted: false,
              },
              valueRedacted: false,
            },
            teachingCourseManagementStorageSchema: {
              status: "missing",
              schemaVersion: "missing",
              migrationStatus: "missing",
              productionDatabaseAdapter: {
                status: "missing",
                providerClass: "missing",
                migrationStatus: "missing",
                backupPolicy: "missing",
                concurrencyControl: "missing",
                valueRedacted: false,
              },
              valueRedacted: false,
            },
            teachingCourseAssetsStorageSchema: {
              status: "missing",
              schemaVersion: "missing",
              migrationStatus: "missing",
              productionDatabaseAdapter: {
                status: "missing",
                providerClass: "missing",
                migrationStatus: "missing",
                backupPolicy: "missing",
                concurrencyControl: "missing",
                valueRedacted: false,
              },
              valueRedacted: false,
            },
            redaction: "present",
          },
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "external-storage-production-service",
          externalStorageServiceReadinessSummary: {
            evidenceStatus: "live-ready",
            blockedReason: "external-storage-service-teaching-operations-schema-not-proven",
            evidenceEnvironment: "production",
            health: {
              httpStatus: 200,
              status: "ok",
              target: "uais-external-storage-production-service",
              productionServiceIdentity: "proved",
              apiContractVersion: "matched",
              cacheControl: "no-store",
              durableBackingStore: "ready",
              teachingOperationsStorageSchema: {
                status: "missing",
                schemaVersion: "missing",
                migrationStatus: "missing",
                backupStore: "missing",
                restoreDrillLog: "missing",
                productionDatabaseAdapterStatus: "missing",
                productionDatabaseAdapterBackupPolicy: "missing",
                valueRedacted: false,
              },
              teachingCourseManagementStorageSchema: {
                status: "missing",
                schemaVersion: "missing",
                migrationStatus: "missing",
                backupStore: "missing",
                restoreDrillLog: "missing",
                productionDatabaseAdapterStatus: "missing",
                productionDatabaseAdapterBackupPolicy: "missing",
                valueRedacted: false,
              },
              teachingCourseAssetsStorageSchema: {
                status: "missing",
                schemaVersion: "missing",
                migrationStatus: "missing",
                backupStore: "missing",
                restoreDrillLog: "missing",
                productionDatabaseAdapterStatus: "missing",
                productionDatabaseAdapterBackupPolicy: "missing",
                valueRedacted: false,
              },
              redaction: "present",
            },
          },
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("preserves dry-run external storage service readiness state in owner summaries", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-storage-dry-run-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: ["external-storage-service-readiness-not-live-ready"],
      requirements: [
        {
          id: "external-storage-service-readiness",
          status: "blocked",
          evidenceStatus: "dry-run-blocked",
          blockedReason: "external-storage-service-readiness-not-live-ready",
          evidenceEnvironment: "production",
          health: {
            status: "missing",
            target: "missing",
            productionServiceIdentity: "missing",
            apiContractVersion: "missing",
            cacheControl: "missing",
            durableBackingStore: "missing",
            teachingOperationsStorageSchema: {
              status: "missing",
              schemaVersion: "missing",
              migrationStatus: "missing",
              productionDatabaseAdapter: {
                status: "missing",
                backupPolicy: "missing",
              },
              valueRedacted: false,
            },
            teachingCourseManagementStorageSchema: {
              status: "missing",
              schemaVersion: "missing",
              migrationStatus: "missing",
              productionDatabaseAdapter: {
                status: "missing",
                backupPolicy: "missing",
              },
              valueRedacted: false,
            },
            teachingCourseAssetsStorageSchema: {
              status: "missing",
              schemaVersion: "missing",
              migrationStatus: "missing",
              productionDatabaseAdapter: {
                status: "missing",
                backupPolicy: "missing",
              },
              valueRedacted: false,
            },
            redaction: "missing",
          },
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "external-storage-production-service",
          externalStorageServiceReadinessSummary: expect.objectContaining({
            evidenceStatus: "dry-run-blocked",
            blockedReason: "external-storage-service-readiness-not-live-ready",
            evidenceEnvironment: "production",
          }),
          safeNextActions: expect.arrayContaining([
            "confirm-approved-remote-https-external-storage-service",
            "bind-server-only-external-storage-env-through-s19-vercel-env-sync",
            "run-external-storage-service-readiness-after-env-sync-launch-and-persistence-evidence",
            "run-external-storage-smoke-only-after-service-readiness-is-live-ready",
          ]),
          forbiddenUntilApproved: expect.arrayContaining([
            "inspect-or-print-external-storage-secret-values",
            "run-live-external-storage-service-readiness",
            "run-live-external-storage-smoke",
            "run-production-smokes-dependent-on-external-storage",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("keeps detailed Vercel project env and deployment blockers attached to owner decisions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-vercel-detail-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "vercel-cli-missing",
        "vercel-auth-missing",
        "vercel-project-readiness-evidence-missing",
        "vercel-project-readiness-evidence-target-mismatch",
        "vercel-project-readiness-not-ready",
        "vercel-project-readiness-redaction-not-proven",
        "vercelignore-upload-hygiene-incomplete",
        "vercel-env-evidence-missing",
        "vercel-env-evidence-target-mismatch",
        "vercel-env-target-coverage-not-proven",
        "vercel-env-local-only-smoke-exclusion-not-proven",
        "vercel-env-auth-provider-mode-not-proven",
        "vercel-env-oidc-endpoint-security-not-proven",
        "vercel-env-external-storage-endpoint-not-proven",
        "vercel-env-external-storage-fingerprint-not-proven",
        "vercel-env-secret-strength-not-proven",
        "vercel-env-project-readiness-not-proven",
        "vercel-env-apply-preflight-not-proven",
        "vercel-production-deployment-evidence-target-mismatch",
        "vercel-production-deployment-not-production",
        "vercel-production-deployment-origin-not-remote-https",
        "vercel-production-deployment-redaction-not-proven",
      ],
      leakedUrl: "https://private-vercel.example.test",
      leakedProjectId: "prj_secret_fixture",
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vercel-project-selection",
          status: "owner-decision-needed",
          blockedReasons: expect.arrayContaining([
            "vercel-cli-missing",
            "vercel-auth-missing",
            "vercel-project-readiness-evidence-missing",
            "vercel-project-readiness-evidence-target-mismatch",
            "vercel-project-readiness-not-ready",
            "vercel-project-readiness-redaction-not-proven",
            "vercelignore-upload-hygiene-incomplete",
          ]),
          safeNextActions: expect.arrayContaining([
            "rerun-redacted-project-readiness-with-approved-project-name-or-project-id",
          ]),
        }),
        expect.objectContaining({
          id: "vercel-env-deploy-and-smoke-chain",
          status: "waiting-for-upstream-owner-decisions",
          blockedReasons: expect.arrayContaining([
            "vercel-env-evidence-missing",
            "vercel-env-evidence-target-mismatch",
            "vercel-env-target-coverage-not-proven",
            "vercel-env-local-only-smoke-exclusion-not-proven",
            "vercel-env-auth-provider-mode-not-proven",
            "vercel-env-oidc-endpoint-security-not-proven",
            "vercel-env-external-storage-endpoint-not-proven",
            "vercel-env-external-storage-fingerprint-not-proven",
            "vercel-env-secret-strength-not-proven",
            "vercel-env-project-readiness-not-proven",
            "vercel-env-apply-preflight-not-proven",
            "vercel-production-deployment-evidence-target-mismatch",
            "vercel-production-deployment-not-production",
            "vercel-production-deployment-origin-not-remote-https",
            "vercel-production-deployment-redaction-not-proven",
          ]),
          proofNeeded: expect.arrayContaining([
            "vercel-env-sync-apply-production-and-preview",
            "vercel-production-deployment-evidence",
          ]),
          safeNextActions: expect.arrayContaining([
            "confirm-s19-vercel-env-apply-approval",
            "run-redacted-vercel-env-sync-apply-with-approved-project-and-release-run-id",
            "run-production-deployment-only-after-env-sync-evidence-is-applied",
            "run-deployed-route-smokes-only-after-production-deployment-is-proven",
            "run-ordinary-teaching-smokes-only-after-auth-storage-and-deployment-evidence-are-live-ready",
          ]),
          forbiddenUntilApproved: expect.arrayContaining([
            "run-vercel-env-apply-without-owner-approval",
            "run-vercel-production-deploy-without-owner-approval",
            "run-live-provider-generation-smoke-before-browser-smoke-and-owner-approval",
            "run-deployed-route-smokes-before-production-deployment-evidence",
            "print-or-log-vercel-env-secret-values",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("private-vercel.example.test");
    expect(output).not.toContain("prj_secret_fixture");
    expect(output).not.toContain("https://");
  });

  it("does not keep Vercel link forbidden after project selection is satisfied", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-vercel-ready-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "vercel-env-not-applied",
        "vercel-production-deployment-not-proven",
      ],
    });
    const vercelProjectReadiness = writeJson(tmpDir, "vercel-project-readiness.json", {
      target: "vercel-project-readiness",
      mode: "local",
      status: "ready",
      checks: [
        { id: "s22-vercel-cli", status: "present" },
        { id: "s22-vercel-auth", status: "present" },
        { id: "s22-vercel-team-scope", status: "present", teamCount: 0 },
        { id: "s22-vercel-project-candidate", status: "present" },
        { id: "s22-vercel-project-link", status: "present" },
        { id: "s22-vercelignore-upload-hygiene", status: "present" },
      ],
      blockedReasons: [],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
      "--vercel-project-readiness",
      vercelProjectReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);
    const decision = body.decisions.find(
      (candidate: { id?: string }) => candidate.id === "vercel-project-selection",
    );

    expect(decision).toEqual(
      expect.objectContaining({
        status: "satisfied",
        ownerDecisionNeeded: "none",
        safeNextActions: ["continue-to-vercel-env-apply-readiness"],
        forbiddenUntilApproved: ["vercel-env-apply", "vercel-production-deploy"],
      }),
    );
    expect(JSON.stringify(decision)).not.toContain("vercel-link");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("keeps missing Vercel team scope attached to the project owner decision", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-team-scope-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: ["vercel-team-scope-missing"],
    });
    const vercelProjectReadiness = writeJson(tmpDir, "vercel-project-readiness.json", {
      target: "vercel-project-readiness",
      mode: "local",
      status: "blocked",
      checks: [
        { id: "s22-vercel-cli", status: "present" },
        { id: "s22-vercel-auth", status: "present" },
        { id: "s22-vercel-team-scope", status: "missing", teamCount: 0 },
        { id: "s22-vercel-project-candidate", status: "present" },
        { id: "s22-vercel-project-link", status: "present" },
        { id: "s22-vercelignore-upload-hygiene", status: "present" },
      ],
      blockedReasons: ["vercel-team-scope-missing"],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
      "--vercel-project-readiness",
      vercelProjectReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vercel-project-selection",
          status: "owner-decision-needed",
          blockedReasons: ["vercel-team-scope-missing"],
          readinessSummary: expect.objectContaining({
            teamScope: "missing",
            projectCandidate: "present",
            projectLink: "present",
          }),
          safeNextActions: expect.arrayContaining([
            "select-or-confirm-current-vercel-team-scope",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("does not keep stale alternate Vercel team-scope blockers when primary readiness proves scope", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-stale-team-scope-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "vercel-project-candidate-missing",
        "vercel-project-not-linked",
      ],
    });
    const vercelProjectReadiness = writeJson(tmpDir, "vercel-project-readiness.json", {
      target: "vercel-project-readiness",
      mode: "local",
      status: "blocked",
      checks: [
        { id: "s22-vercel-cli", status: "present" },
        { id: "s22-vercel-auth", status: "present" },
        {
          id: "s22-vercel-team-scope",
          status: "present",
          evidence: "personal-account-scope-empty-output",
          teamCount: 0,
        },
        {
          id: "s22-vercel-project-candidate",
          status: "missing",
          filteredProjectCount: 0,
          exactProjectNameCount: 0,
        },
        { id: "s22-vercel-project-link", status: "missing" },
        { id: "s22-vercelignore-upload-hygiene", status: "present" },
      ],
      blockedReasons: ["vercel-project-candidate-missing", "vercel-project-not-linked"],
    });
    const alternateVercelProjectReadiness = writeJson(
      tmpDir,
      "alternate-vercel-project-readiness.json",
      {
        target: "vercel-project-readiness",
        mode: "local",
        status: "blocked",
        checks: [
          { id: "s22-vercel-team-scope", status: "missing", teamCount: 0 },
          {
            id: "s22-vercel-project-candidate",
            status: "missing",
            filteredProjectCount: 0,
            exactProjectNameCount: 0,
          },
        ],
        blockedReasons: ["vercel-team-scope-missing", "vercel-project-candidate-missing"],
      },
    );

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
      "--vercel-project-readiness",
      vercelProjectReadiness,
      "--alternate-vercel-project-readiness",
      alternateVercelProjectReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vercel-project-selection",
          status: "owner-decision-needed",
          blockedReasons: [
            "vercel-project-candidate-missing",
            "vercel-project-not-linked",
          ],
          readinessSummary: expect.objectContaining({
            teamScope: "present",
            projectCandidate: "missing",
            projectLink: "missing",
          }),
        }),
      ]),
    );
    expect(output).not.toContain("vercel-team-scope-missing");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("keeps detailed teacher-auth and storage blockers attached to owner decisions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-auth-storage-detail-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "teacher-auth-provider-selector-not-proven",
        "teacher-auth-session-cookie-contract-not-proven",
        "teacher-auth-session-cookie-pair-contract-not-proven",
        "teacher-auth-session-issuer-secret-separation-not-proven",
        "teacher-auth-session-cookie-round-trip-not-proven",
        "teacher-auth-oidc-jwks-signing-key-not-proven",
        "teacher-auth-provider-vercel-env-sync-not-proven",
        "teacher-auth-provider-specific-readiness-not-proven",
        "teacher-auth-provider-trusted-route-chain-not-proven",
        "teacher-auth-provider-readiness-redaction-not-proven",
        "external-storage-service-production-identity-not-proven",
        "external-storage-service-api-contract-not-proven",
        "external-storage-service-teaching-operations-schema-not-proven",
        "external-storage-service-teaching-operations-database-adapter-not-proven",
        "external-storage-service-teaching-course-management-database-adapter-not-proven",
        "external-storage-service-teaching-course-assets-schema-not-proven",
        "external-storage-service-teaching-course-assets-database-adapter-not-proven",
        "external-storage-service-redaction-not-proven",
        "external-storage-service-readiness-fingerprint-not-proven",
        "external-storage-service-vercel-env-sync-not-proven",
        "external-storage-service-persistence-not-proven",
        "external-storage-service-readiness-redaction-not-proven",
        "external-storage-smoke-response-shape-not-proven",
        "external-storage-smoke-service-readiness-not-proven",
        "external-storage-service-fingerprint-mismatch",
      ],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "teacher-auth-provider-production-selector",
          status: "owner-decision-needed",
          blockedReasons: expect.arrayContaining([
            "teacher-auth-provider-selector-not-proven",
            "teacher-auth-session-cookie-contract-not-proven",
            "teacher-auth-session-cookie-pair-contract-not-proven",
            "teacher-auth-session-issuer-secret-separation-not-proven",
            "teacher-auth-session-cookie-round-trip-not-proven",
            "teacher-auth-oidc-jwks-signing-key-not-proven",
            "teacher-auth-provider-vercel-env-sync-not-proven",
            "teacher-auth-provider-specific-readiness-not-proven",
            "teacher-auth-provider-trusted-route-chain-not-proven",
            "teacher-auth-provider-readiness-redaction-not-proven",
          ]),
          proofNeeded: expect.arrayContaining([
            "teacher-auth-provider-redaction-safety",
            "teacher-auth-provider-specific-readiness-proof",
            "trusted-cookie-route-chain-binding-proof-if-selected",
            "trusted-cookie-session-round-trip-proof-if-selected",
          ]),
        }),
        expect.objectContaining({
          id: "external-storage-production-service",
          status: "owner-decision-needed",
          blockedReasons: expect.arrayContaining([
            "external-storage-service-production-identity-not-proven",
            "external-storage-service-api-contract-not-proven",
            "external-storage-service-teaching-operations-schema-not-proven",
            "external-storage-service-teaching-operations-database-adapter-not-proven",
            "external-storage-service-teaching-course-management-database-adapter-not-proven",
            "external-storage-service-teaching-course-assets-schema-not-proven",
            "external-storage-service-teaching-course-assets-database-adapter-not-proven",
            "external-storage-service-redaction-not-proven",
            "external-storage-service-readiness-fingerprint-not-proven",
            "external-storage-service-vercel-env-sync-not-proven",
            "external-storage-service-persistence-not-proven",
            "external-storage-service-readiness-redaction-not-proven",
            "external-storage-smoke-response-shape-not-proven",
            "external-storage-smoke-service-readiness-not-proven",
            "external-storage-service-fingerprint-mismatch",
          ]),
          proofNeeded: expect.arrayContaining([
            "storage-readiness-vercel-env-sync-binding",
            "external-storage-persistence-read-after-restart-proof",
            "teaching-operations-production-database-adapter-proof",
            "teaching-operations-backup-restore-drill-proof",
            "teaching-course-management-production-database-adapter-proof",
            "teaching-course-management-backup-restore-drill-proof",
            "teaching-course-assets-schema-migration-health-proof",
            "teaching-course-assets-production-database-adapter-proof",
            "teaching-course-assets-backup-restore-drill-proof",
            "external-storage-service-fingerprint-consistency",
            "external-storage-smoke-readiness-binding",
            "external-storage-response-shape-contract",
          ]),
        }),
        expect.objectContaining({
          id: "production-release-run",
          status: "waiting-for-upstream-evidence",
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("keeps detailed trusted teacher auth route-chain blockers attached to owner decisions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-auth-detail-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "teacher-auth-provider-readiness-target-mismatch",
        "teacher-auth-provider-vercel-env-sync-release-run-not-proven",
        "teacher-auth-provider-issuer-route-smoke-not-proven",
        "trusted-teacher-auth-route-chain-contract-not-proven",
        "trusted-teacher-auth-route-chain-missing",
        "trusted-teacher-auth-route-chain-not-proved",
        "trusted-teacher-auth-route-chain-redaction-not-proven",
        "trusted-teacher-auth-route-chain-target-mismatch",
      ],
      leakedCookieValue: "secret-cookie-value",
      leakedUrl: "https://private-auth.example.test",
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "teacher-auth-provider-production-selector",
          status: "owner-decision-needed",
          blockedReasons: expect.arrayContaining([
            "teacher-auth-provider-readiness-target-mismatch",
            "teacher-auth-provider-vercel-env-sync-release-run-not-proven",
            "teacher-auth-provider-issuer-route-smoke-not-proven",
            "trusted-teacher-auth-route-chain-contract-not-proven",
            "trusted-teacher-auth-route-chain-missing",
            "trusted-teacher-auth-route-chain-not-proved",
            "trusted-teacher-auth-route-chain-redaction-not-proven",
            "trusted-teacher-auth-route-chain-target-mismatch",
          ]),
          proofNeeded: expect.arrayContaining([
            "trusted-cookie-route-chain-binding-proof-if-selected",
            "deployed-teacher-auth-issuer-route-smoke-proof",
            "vercel-env-sync-selector-matches-readiness",
            "teacher-auth-provider-redaction-safety",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("secret-cookie-value");
    expect(output).not.toContain("private-auth.example.test");
    expect(output).not.toContain("https://");
  });

  it("keeps detailed external storage launch and smoke blockers attached to owner decisions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-storage-detail-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "build-failed",
        "build-not-approved",
        "build-not-run",
        "dockerfile-contract-failed",
        "dockerfile-missing",
        "dockerignore-generated-output-exclusion-missing",
        "dockerignore-missing",
        "dockerignore-secret-exclusion-missing",
        "external-storage-port-invalid",
        "external-storage-production-launch-container-artifact-not-proven",
        "external-storage-production-launch-contract-missing",
        "external-storage-production-launch-contract-not-ready",
        "external-storage-production-launch-contract-target-mismatch",
        "external-storage-production-launch-env-contract-not-proven",
        "external-storage-production-launch-redaction-not-proven",
        "external-storage-production-launch-runtime-not-proven",
        "external-storage-service-production-launch-contract-not-proven",
        "external-storage-service-cache-control-not-proven",
        "external-storage-service-readiness-target-mismatch",
        "external-storage-service-vercel-env-sync-release-run-not-proven",
        "external-storage-smoke-evidence-missing",
        "external-storage-smoke-evidence-target-mismatch",
        "external-storage-smoke-service-readiness-release-run-not-proven",
      ],
      leakedUrl: "https://private-storage.example.test",
      leakedToken: "secret-storage-token",
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "external-storage-production-service",
          status: "owner-decision-needed",
          blockedReasons: expect.arrayContaining([
            "build-failed",
            "build-not-approved",
            "build-not-run",
            "dockerfile-contract-failed",
            "dockerfile-missing",
            "dockerignore-generated-output-exclusion-missing",
            "dockerignore-missing",
            "dockerignore-secret-exclusion-missing",
            "external-storage-port-invalid",
            "external-storage-production-launch-container-artifact-not-proven",
            "external-storage-production-launch-contract-missing",
            "external-storage-production-launch-contract-not-ready",
            "external-storage-production-launch-contract-target-mismatch",
            "external-storage-production-launch-env-contract-not-proven",
            "external-storage-production-launch-redaction-not-proven",
            "external-storage-production-launch-runtime-not-proven",
            "external-storage-service-production-launch-contract-not-proven",
            "external-storage-service-cache-control-not-proven",
            "external-storage-service-readiness-target-mismatch",
            "external-storage-service-vercel-env-sync-release-run-not-proven",
            "external-storage-smoke-evidence-missing",
            "external-storage-smoke-evidence-target-mismatch",
            "external-storage-smoke-service-readiness-release-run-not-proven",
          ]),
          proofNeeded: expect.arrayContaining([
            "production-launcher-env-contract",
            "container-build-readiness-evidence",
            "service-health-cache-control-no-store-proof",
            "storage-readiness-vercel-env-sync-binding",
            "external-storage-smoke-readiness-binding",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("private-storage.example.test");
    expect(output).not.toContain("secret-storage-token");
    expect(output).not.toContain("https://");
  });

  it("summarizes external storage container build readiness without treating it as production proof", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-storage-container-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "external-storage-service-readiness-not-live-ready",
        "external-storage-smoke-not-live-passed",
      ],
    });
    const containerBuildReadiness = writeJson(
      tmpDir,
      "external-storage-container-build-readiness.json",
      {
        target: "external-storage-container-build-mode-harness",
        status: "harness-hardened",
        currentHostEvidence: {
          report: join(tmpDir, "leaky-current-readiness.json"),
          mode: "dry-run",
          status: "blocked",
          dockerClient: "present",
          dockerDaemon: "unavailable",
          dockerfileContract: "passed",
          dockerignoreSecretExclusion: "passed",
          dockerignoreGeneratedOutputExclusion: "passed",
          buildInvoked: false,
          blockedReasons: ["docker-daemon-unavailable"],
          imageTag: "registry.example.test/uais/external-storage:secret-build-tag",
        },
        releaseImpact: {
          containerBuildHarness: "ready-for-approved-build-attempt",
          localImageBuild: "not-proven-docker-daemon-unavailable",
          remoteProductionStorageService: "not-proven",
          releaseGateEligible: false,
        },
        safety: {
          secretsRedacted: true,
          imageTagsOmitted: true,
          dockerOutputOmitted: true,
          localPrivatePathsOmitted: true,
          productionMutationPerformed: false,
          vercelMutationPerformed: false,
        },
        leakedUrl: "https://private-storage.example.test",
      },
    );

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
      "--external-storage-container-build-readiness",
      containerBuildReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "external-storage-production-service",
          status: "owner-decision-needed",
          containerBuildReadinessSummary: {
            evidenceStatus: "harness-hardened",
            harness: "ready-for-approved-build-attempt",
            currentMode: "dry-run",
            currentStatus: "blocked",
            dockerClient: "present",
            dockerDaemon: "unavailable",
            dockerfileContract: "passed",
            dockerignoreSecretExclusion: "passed",
            dockerignoreGeneratedOutputExclusion: "passed",
            buildInvoked: false,
            localImageBuild: "not-proven-docker-daemon-unavailable",
            releaseGateEligible: false,
            blockedReasons: ["docker-daemon-unavailable"],
            safety: {
              secretsRedacted: true,
              imageTagsOmitted: true,
              dockerOutputOmitted: true,
              localPrivatePathsOmitted: true,
              productionMutationPerformed: false,
              vercelMutationPerformed: false,
            },
          },
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("registry.example.test");
    expect(output).not.toContain("secret-build-tag");
    expect(output).not.toContain("private-storage.example.test");
    expect(output).not.toContain("https://");
    expect(output).not.toContain("/Users/");
  });

  it("summarizes raw external storage container build readiness evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-raw-container-build-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "external-storage-container-build-readiness-not-ready",
        "external-storage-service-readiness-not-live-ready",
      ],
    });
    const containerBuildReadiness = writeJson(
      tmpDir,
      "external-storage-container-build-readiness.json",
      {
        target: "external-storage-container-build-readiness",
        mode: "build",
        status: "blocked",
        dockerfile: {
          path: "Dockerfile.external-storage",
          status: "present",
          contract: "passed",
        },
        dockerignore: {
          path: ".dockerignore",
          status: "present",
          secretExclusion: "passed",
          generatedOutputExclusion: "passed",
        },
        image: {
          tagStatus: "present",
          valueRedacted: true,
          leakedTag: "registry.example.test/uais/external-storage:secret-build-tag",
        },
        docker: {
          client: "present",
          daemon: "unavailable",
          outputRedacted: true,
        },
        build: {
          status: "not-run",
          invoked: false,
          outputRedacted: true,
        },
        blockedReasons: ["docker-daemon-unavailable"],
        safety: {
          imageTagOmitted: true,
          dockerOutputOmitted: true,
          localPrivatePathsOmitted: true,
          secretsExcludedFromContext: true,
          buildNotRunInDryRun: false,
          buildRunInApprovedMode: false,
        },
      },
    );

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
      "--external-storage-container-build-readiness",
      containerBuildReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "external-storage-production-service",
          status: "owner-decision-needed",
          blockedReasons: expect.arrayContaining([
            "external-storage-container-build-readiness-not-ready",
            "external-storage-service-readiness-not-live-ready",
          ]),
          containerBuildReadinessSummary: expect.objectContaining({
            evidenceStatus: "blocked",
            currentMode: "build",
            currentStatus: "blocked",
            dockerClient: "present",
            dockerDaemon: "unavailable",
            dockerfileContract: "passed",
            dockerignoreSecretExclusion: "passed",
            dockerignoreGeneratedOutputExclusion: "passed",
            buildInvoked: false,
            localImageBuild: "not-proven-docker-daemon-unavailable",
            releaseGateEligible: false,
            blockedReasons: ["docker-daemon-unavailable"],
          }),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("registry.example.test");
    expect(output).not.toContain("secret-build-tag");
    expect(output).not.toContain("/Users/");
  });

  it("summarizes local trusted teacher auth route-chain proof without treating it as production auth readiness", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-auth-route-chain-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [
        "teacher-auth-provider-readiness-not-live-ready",
        "deployment-route-smoke-teacher-auth-readiness-binding-not-proven",
      ],
      requirements: [
        {
          id: "teacher-auth-provider-readiness",
          status: "blocked",
          evidenceStatus: "dry-run-blocked",
          blockedReason: "teacher-auth-provider-readiness-not-live-ready",
          evidenceEnvironment: "production",
          authProviderMode: "trusted-cookie-issuer",
          sessionCookieContract: {
            signingSecretStrength: "sufficient",
            cookiePair: "proved",
            valueRedacted: true,
          },
          vercelEnvSyncEvidence: {
            status: "missing",
            applyPreflight: "missing",
            releaseRunIdStatus: "missing",
            valueRedacted: true,
          },
          trustedIssuerContract: {
            issuerSecretStrength: "sufficient",
            sessionIssuerSecretSeparation: "proved",
            issuerProofRequired: true,
            issuerProofBoundsCookieMaxAge: true,
            valueRedacted: true,
          },
          trustedCookieSessionRoundTrip: {
            status: "proved",
            signatureVerification: "passed",
            expiryCheck: "passed",
            tamperCheck: "passed",
            sessionIdRedacted: true,
            cookieValuesEmitted: false,
            valuesRedacted: true,
          },
          trustedTeacherAuthRouteChainEvidence: {
            status: "proved",
            routeChain: "proved",
            issuerProofValidation: "proved",
            redactionSafety: "proved",
            valueRedacted: true,
          },
          trustedTeacherAuthRouteSmokeEvidence: {
            status: "missing",
            releaseRunIdStatus: "missing",
            deploymentBinding: "missing",
            teacherAuthIssuerRoute: "missing",
            responseHeaders: "missing",
            responseShape: "missing",
            valueRedacted: true,
          },
          redactionSafety: {
            valuesRedacted: "proved",
            secretsOmitted: "proved",
            providerUrlsOmitted: "proved",
            responseBodiesOmitted: "proved",
            localPrivatePathsOmitted: "proved",
            liveRequiresApproval: "proved",
            noCookieIssued: "proved",
          },
        },
      ],
    });
    const trustedRouteChain = writeJson(tmpDir, "trusted-route-chain.json", {
      target: "trusted-teacher-auth-route-chain-contract",
      status: "proved-locally",
      evidence: {
        routeChain: ["/api/ai/teacher-auth/issue", "/api/ai/session"],
        authProvider: "trusted-cookie-issuer",
        providerContract: "production-ready-with-fixture-secrets",
        issuerProof: "signed-admin-ai-access-plus-trusted-issuer-proof",
        issuerCookieHardening: {
          httpOnly: "required",
          sameSite: "lax",
          secureInProduction: true,
          path: "/",
          maxAge: "bounded-by-session-ttl",
          priority: "High",
          valuesRedacted: true,
        },
        sessionCookiePair: [
          "uais_teacher_auth_claims",
          "uais_teacher_auth_signature",
        ],
        downstreamAiSession: "scoped-teacher-ai-session-issued",
        workflowAction: "ppt-narration-submit",
        leakedCookieValue: "secret-cookie-value",
      },
      releaseImpact: {
        localTrustedCookieRouteWiring: "proved",
        productionTeacherAuthReadiness:
          "still-blocked-without-owner-approved-vercel-env-and-live-route-smoke",
        releaseGateEligible: false,
      },
      safety: {
        secretsRedacted: true,
        cookieValuesOmitted: true,
        sessionIdsOmitted: true,
        localPrivatePathsOmitted: true,
        productionMutationPerformed: false,
      },
      leakedPath: join(tmpDir, "private-auth-proof.json"),
      leakedUrl: "https://private-auth.example.test",
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
      "--trusted-teacher-auth-route-chain",
      trustedRouteChain,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "teacher-auth-provider-production-selector",
          status: "owner-decision-needed",
          blockedReasons: expect.arrayContaining([
            "teacher-auth-provider-readiness-not-live-ready",
            "deployment-route-smoke-teacher-auth-readiness-binding-not-proven",
          ]),
          teacherAuthProviderReadinessSummary: expect.objectContaining({
            evidenceStatus: "dry-run-blocked",
            blockedReason: "teacher-auth-provider-readiness-not-live-ready",
            evidenceEnvironment: "production",
            authProviderMode: "trusted-cookie-issuer",
            sessionCookieContract: expect.objectContaining({
              signingSecretStrength: "sufficient",
              cookiePair: "proved",
              valueRedacted: true,
            }),
            trustedCookieSessionRoundTrip: expect.objectContaining({
              status: "proved",
              signatureVerification: "passed",
              expiryCheck: "passed",
              tamperCheck: "passed",
              sessionIdRedacted: true,
              cookieValuesEmitted: false,
              valuesRedacted: true,
            }),
            trustedTeacherAuthRouteChainEvidence: expect.objectContaining({
              status: "proved",
              routeChain: "proved",
              redactionSafety: "proved",
              valueRedacted: true,
            }),
            trustedTeacherAuthRouteSmokeEvidence: expect.objectContaining({
              status: "missing",
              deploymentBinding: "missing",
              teacherAuthIssuerRoute: "missing",
            }),
          }),
          trustedRouteChainSummary: {
            evidenceStatus: "proved-locally",
            authProvider: "trusted-cookie-issuer",
            providerContract: "production-ready-with-fixture-secrets",
            issuerProof: "signed-admin-ai-access-plus-trusted-issuer-proof",
            issuerCookieHardening: "proved",
            routeChain: ["/api/ai/teacher-auth/issue", "/api/ai/session"],
            sessionCookiePair: [
              "uais_teacher_auth_claims",
              "uais_teacher_auth_signature",
            ],
            downstreamAiSession: "scoped-teacher-ai-session-issued",
            workflowAction: "ppt-narration-submit",
            localTrustedCookieRouteWiring: "proved",
            productionTeacherAuthReadiness:
              "still-blocked-without-owner-approved-vercel-env-and-live-route-smoke",
            releaseGateEligible: false,
            safety: {
              secretsRedacted: true,
              cookieValuesOmitted: true,
              sessionIdsOmitted: true,
              localPrivatePathsOmitted: true,
              productionMutationPerformed: false,
            },
          },
          safeNextActions: expect.arrayContaining([
            "confirm-production-teacher-auth-provider-mode",
            "bind-server-only-teacher-auth-env-through-s19-vercel-env-sync",
            "run-approved-teacher-auth-provider-readiness-after-env-sync",
            "run-deployed-teacher-auth-issuer-route-smoke-after-production-deploy",
            "run-production-smokes-only-after-teacher-auth-readiness-is-live-ready",
          ]),
          forbiddenUntilApproved: expect.arrayContaining([
            "inspect-or-print-teacher-auth-credential-values",
            "issue-live-teacher-auth-cookie",
            "run-live-teacher-auth-provider-network-call",
            "run-production-smokes-dependent-on-teacher-auth",
          ]),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("secret-cookie-value");
    expect(output).not.toContain("private-auth.example.test");
    expect(output).not.toContain("https://");
    expect(output).not.toContain("/Users/");
  });

  it("marks local production diagnostics stale when browser workflow proof is missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decisions-stale-local-"));
    const passedCheckIds = [
      "s22-local-external-storage-reference-service",
      "s22-next-production-build",
      "s22-next-start-local-production-server",
      "s22-local-learning-ppt-playback-smoke",
      "s22-local-teacher-workflow-page-smoke",
      "s22-local-protected-route-smoke",
    ];
    const localDryRunContract = readLocalProductionDryRunContract();
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedReasons: [],
    });
    const localProduction = writeJson(tmpDir, "local-production-stale.json", {
      target: "local-production-e2e-smoke",
      mode: "live",
      environment: "local-production",
      status: "passed",
      checks: passedCheckIds.map((checkId) => ({ id: checkId, status: "passed" })),
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-checklist.mjs",
      "--release-gate",
      releaseGate,
      "--local-production-e2e",
      localProduction,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.localProductionDiagnostic).toEqual(
      expect.objectContaining({
        status: "passed",
        evidenceFreshness: "stale",
        releaseEligible: false,
        missingRequiredChecks: missingContractItems(
          localDryRunContract.requiredChecks,
          passedCheckIds,
        ),
        browserProofStatus: "missing",
        missingBrowserResults: localDryRunContract.requiredBrowserResults,
      }),
    );
    expect(output).not.toContain(tmpDir);
  });
});

function writeJson(dir: string, name: string, body: unknown) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
  return path;
}

function readLocalProductionDryRunContract() {
  const output = execFileSync("node", [
    "scripts/local-production-e2e-smoke.mjs",
    "--dry-run",
    "--port",
    "43123",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const body = JSON.parse(output);
  const browserChecks = body.checks.filter(
    (check: { id?: string; browserProofSummary?: string[] }) =>
      typeof check.id === "string" && Array.isArray(check.browserProofSummary),
  );
  const browserProofSummaries = Object.fromEntries(
    browserChecks.map((check: { id: string; browserProofSummary: string[] }) => [
      check.id,
      check.browserProofSummary,
    ]),
  );

  return {
    requiredChecks: body.checks.map((check: { id: string }) => check.id),
    browserProofSummaries,
    requiredBrowserResults: [
      ...new Set(
        browserChecks.flatMap(
          (check: { browserProofSummary: string[] }) => check.browserProofSummary,
        ),
      ),
    ],
  };
}

function missingContractItems(requiredItems: string[], presentItems: string[]) {
  return requiredItems.filter((item) => !presentItems.includes(item));
}
