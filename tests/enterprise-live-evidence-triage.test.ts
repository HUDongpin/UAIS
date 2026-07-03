import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("enterprise live evidence triage", () => {
  it("classifies blocked enterprise live evidence rows without exposing private details", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-triage-"));
    const fakeLocalPath = [
      "",
      "Users",
      "example",
      "private",
      "2026-06-30-app-auth-provider-readiness-production-live.json",
    ].join("/");
    const fakeUrl = ["https://", "private-production.example.test", "/app-auth"].join("");
    const fakeCookie = ["uais_teacher_auth_claims", "=secret"].join("");
    const auditPath = writeJson(tmpDir, "enterprise-audit.json", {
      target: "enterprise-live-evidence-audit",
      status: "blocked",
      summary: {
        totalProductionLiveNamed: 3,
        acceptedLiveEvidence: 0,
        filenameOnlyOrBlocked: 3,
        releaseRunIdConsistency: "missing",
        sharedReleaseRunIdStatus: "missing",
        missingRequiredTargetCount: 3,
      },
      requiredTargets: [
        "app-auth-provider-readiness",
        "teaching-operations-route-smoke",
        "ppt-manual-playback-acceptance",
      ],
      missingRequiredTargets: [
        "app-auth-provider-readiness",
        "teaching-operations-route-smoke",
        "ppt-manual-playback-acceptance",
      ],
      rows: [
        {
          file: fakeLocalPath,
          target: "app-auth-provider-readiness",
          mode: "dry-run",
          expectedMode: "live",
          environment: "production",
          status: "blocked",
          expectedStatus: "ready",
          releaseRunIdStatus: "present",
          safetyStatus: "proved",
          targetResultStatus: "missing",
          targetContractStatus: "not-required",
          missingResultKeys: [
            "appAuthProviderVercelEnvSync",
            "appAuthReadinessSafety",
          ],
          acceptanceStatus: "not-accepted-filename-only",
          blockedReasons: [
            "mode-not-live",
            "status-not-ready",
            "target-result-proof-missing",
          ],
          rawUrl: fakeUrl,
        },
        {
          file: "2026-06-30-teaching-operations-route-smoke-production-live.json",
          target: "teaching-operations-route-smoke",
          mode: "dry-run",
          expectedMode: "live",
          environment: "production",
          status: "blocked",
          expectedStatus: "passed",
          releaseRunIdStatus: "missing",
          safetyStatus: "proved",
          targetResultStatus: "missing",
          targetContractStatus: "proved",
          acceptanceStatus: "not-accepted-filename-only",
          blockedReasons: [
            "mode-not-live",
            "status-not-passed",
            "release-run-missing",
            "target-result-proof-missing",
          ],
          cookie: fakeCookie,
        },
        {
          file: "2026-06-30-teaching-operation-detail-browser-smoke-production-live.json",
          target: "teaching-operation-detail-browser-smoke",
          mode: "dry-run",
          expectedMode: "live",
          environment: "production",
          status: "blocked",
          expectedStatus: "passed",
          releaseRunIdStatus: "missing",
          safetyStatus: "proved",
          targetResultStatus: "missing",
          targetContractStatus: "missing",
          acceptanceStatus: "not-accepted-filename-only",
          blockedReasons: [
            "mode-not-live",
            "status-not-passed",
            "release-run-missing",
            "target-result-proof-missing",
          ],
        },
        {
          file: "2026-06-30-ppt-manual-playback-acceptance-production-live.json",
          target: "ppt-manual-playback-acceptance",
          mode: "plan",
          expectedMode: "record",
          environment: "missing",
          status: "blocked",
          expectedStatus: "accepted",
          releaseRunIdStatus: "missing",
          safetyStatus: "proved",
          targetResultStatus: "missing",
          targetContractStatus: "not-required",
          acceptanceStatus: "not-accepted-filename-only",
          blockedReasons: [
            "mode-not-record",
            "environment-not-production",
            "status-not-accepted",
            "release-run-missing",
            "target-result-proof-missing",
          ],
          responseBody: "{\"secret\":\"do-not-print\"}",
        },
      ],
      safety: {
        valuesRedacted: true,
        cookieValuesOmitted: true,
        localPathsOmitted: true,
        fileNamesOnly: true,
        responseBodiesOmitted: true,
      },
    });

    const output = execFileSync("node", [
      "scripts/enterprise-live-evidence-triage.mjs",
      "--enterprise-live-evidence-audit",
      auditPath,
      "--release-gate-status",
      "blocked",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "enterprise-live-evidence-triage",
        status: "blocked",
        releaseGateStatus: "blocked",
        responsibleSession: "S22",
        summary: {
          totalTargets: 3,
          acceptedTargets: 0,
          blockedTargets: 3,
          missingRequiredTargets: 3,
          releaseRunIdConsistency: "missing",
          sharedReleaseRunIdStatus: "missing",
        },
        blockerCounts: {
          "mode-not-live": 3,
          "status-not-ready": 1,
          "target-result-proof-missing": 4,
          "status-not-passed": 2,
          "release-run-missing": 3,
          "mode-not-record": 1,
          "environment-not-production": 1,
          "status-not-accepted": 1,
        },
        categories: {
          ownerApprovedLiveRunRequired: [
            "app-auth-provider-readiness",
            "teaching-operations-route-smoke",
            "teaching-operation-detail-browser-smoke",
          ],
          sharedReleaseRunRequired: [
            "teaching-operations-route-smoke",
            "teaching-operation-detail-browser-smoke",
            "ppt-manual-playback-acceptance",
          ],
          targetResultProofRequired: [
            "app-auth-provider-readiness",
            "teaching-operations-route-smoke",
            "teaching-operation-detail-browser-smoke",
            "ppt-manual-playback-acceptance",
          ],
          targetContractProofRequired: ["teaching-operation-detail-browser-smoke"],
          safetyProofRequired: [],
          manualHumanQaRequired: ["ppt-manual-playback-acceptance"],
        },
        safety: {
          sourcePathsOmitted: true,
          rawUrlsOmitted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          noLiveMutationPerformed: true,
          noDeploymentMutationPerformed: true,
          noReleaseRunBindingPerformed: true,
          usesAuditRowsOnly: true,
        },
      }),
    );
    expect(body.nextActions).toEqual([
      expect.objectContaining({
        target: "app-auth-provider-readiness",
        evidenceFileName: "2026-06-30-app-auth-provider-readiness-production-live.json",
        nextAction:
          "Run owner-approved production live evidence for this target with body-level result proof.",
        responsibleSessions: ["Owner", "S12", "S19", "S22"],
      }),
      expect.objectContaining({
        target: "teaching-operations-route-smoke",
        evidenceFileName: "2026-06-30-teaching-operations-route-smoke-production-live.json",
        nextAction:
          "Run owner-approved production live smoke on the shared release-run ID with body-level result proof.",
        responsibleSessions: ["S05", "S12", "S13", "S19", "S22"],
      }),
      expect.objectContaining({
        target: "teaching-operation-detail-browser-smoke",
        evidenceFileName:
          "2026-06-30-teaching-operation-detail-browser-smoke-production-live.json",
        targetContractStatus: "missing",
        nextAction:
          "Run owner-approved production live smoke on the shared release-run ID with body-level result proof.",
        responsibleSessions: ["S05", "S12", "S13", "S19", "S22"],
      }),
      expect.objectContaining({
        target: "ppt-manual-playback-acceptance",
        nextAction:
          "Collect S24 human PowerPoint/WPS playback acceptance after production deployment, bound to the shared release-run ID.",
        responsibleSessions: ["Owner", "S24", "S22"],
      }),
    ]);
    expect(body.executionWaves).toEqual([
      expect.objectContaining({
        id: "provider-and-env-decisions",
        targetCount: 1,
        targets: [
          expect.objectContaining({
            target: "app-auth-provider-readiness",
            topBlockers: [
              "mode-not-live",
              "status-not-ready",
              "target-result-proof-missing",
            ],
          }),
        ],
      }),
      expect.objectContaining({
        id: "workflow-and-ordinary-teaching-smokes",
        targetCount: 2,
        targets: [
          expect.objectContaining({ target: "teaching-operations-route-smoke" }),
          expect.objectContaining({ target: "teaching-operation-detail-browser-smoke" }),
        ],
      }),
      expect.objectContaining({
        id: "manual-qa-and-final-audit",
        targetCount: 1,
        targets: [
          expect.objectContaining({ target: "ppt-manual-playback-acceptance" }),
        ],
      }),
    ]);
    const waveTargets = body.executionWaves.flatMap((wave: { targets: Array<{ target: string }> }) =>
      wave.targets.map((target) => target.target),
    );
    expect(new Set(waveTargets)).toEqual(
      new Set(body.nextActions.map((action: { target: string }) => action.target)),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain(["", "Users", ""].join("/"));
    expect(output).not.toContain(fakeUrl);
    expect(output).not.toContain(fakeCookie);
    expect(output).not.toContain("do-not-print");
  });

  it("renders a compact markdown triage table", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-triage-md-"));
    const auditPath = writeJson(tmpDir, "enterprise-audit.json", {
      target: "enterprise-live-evidence-audit",
      status: "blocked",
      summary: {
        totalProductionLiveNamed: 1,
        acceptedLiveEvidence: 0,
        filenameOnlyOrBlocked: 1,
        releaseRunIdConsistency: "missing",
        sharedReleaseRunIdStatus: "missing",
        missingRequiredTargetCount: 1,
      },
      missingRequiredTargets: ["external-storage-smoke"],
      rows: [
        {
          file: "2026-06-30-external-storage-smoke-production-live.json",
          target: "external-storage-smoke",
          mode: "dry-run",
          environment: "production",
          status: "blocked",
          releaseRunIdStatus: "missing",
          targetResultStatus: "missing",
          targetContractStatus: "not-required",
          acceptanceStatus: "not-accepted-filename-only",
          blockedReasons: [
            "mode-not-live",
            "status-not-passed",
            "release-run-missing",
            "safety-not-proven",
            "target-result-proof-missing",
          ],
        },
        {
          file: "2026-06-30-teaching-operation-detail-browser-smoke-production-live.json",
          target: "teaching-operation-detail-browser-smoke",
          mode: "dry-run",
          environment: "production",
          status: "blocked",
          releaseRunIdStatus: "missing",
          targetResultStatus: "missing",
          targetContractStatus: "missing",
          acceptanceStatus: "not-accepted-filename-only",
          blockedReasons: [
            "mode-not-live",
            "status-not-passed",
            "release-run-missing",
            "target-result-proof-missing",
          ],
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/enterprise-live-evidence-triage.mjs",
      "--enterprise-live-evidence-audit",
      auditPath,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Enterprise Live Evidence Triage");
    expect(output).toContain("Status: `blocked`");
    expect(output).toContain("Accepted targets: 0 / 1");
    expect(output).toContain("## Execution Waves");
    expect(output).toContain("### Auth and storage readiness");
    expect(output).toContain("### Workflow and ordinary teaching smokes");
    expect(output).toContain("## Category Queues");
    expect(output).toContain("Owner-approved live run required:");
    expect(output).toContain("Target contract proof required:");
    expect(output).toContain("Safety proof required:");
    expect(output).toContain("- `teaching-operation-detail-browser-smoke`");
    expect(output).toContain("| `external-storage-smoke` |");
    expect(output).toContain("`mode-not-live`, `status-not-passed`, `release-run-missing`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain(["", "Users", ""].join("/"));
  });

  it("renders none-recorded for empty markdown queues and blockers", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-live-evidence-triage-empty-md-"));
    const auditPath = writeJson(tmpDir, "enterprise-audit.json", {
      target: "enterprise-live-evidence-audit",
      status: "blocked",
      summary: {
        totalProductionLiveNamed: 1,
        acceptedLiveEvidence: 0,
        filenameOnlyOrBlocked: 1,
        releaseRunIdConsistency: "missing",
        sharedReleaseRunIdStatus: "missing",
        missingRequiredTargetCount: 1,
      },
      missingRequiredTargets: ["app-auth-provider-readiness"],
      rows: [
        {
          file: "2026-06-30-app-auth-provider-readiness-production-live.json",
          target: "app-auth-provider-readiness",
          mode: "dry-run",
          environment: "production",
          status: "blocked",
          releaseRunIdStatus: "present",
          targetResultStatus: "proved",
          targetContractStatus: "not-required",
          safetyStatus: "proved",
          acceptanceStatus: "not-accepted-filename-only",
          blockedReasons: [],
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/enterprise-live-evidence-triage.mjs",
      "--enterprise-live-evidence-audit",
      auditPath,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("blockers `none-recorded`");
    expect(output).toContain("Owner-approved live run required:\n- `none-recorded`");
    expect(output).toContain("Manual human QA required:\n- `none-recorded`");
    expect(output).not.toContain("- none");
    expect(output).not.toContain("blockers none");
  });
});

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
