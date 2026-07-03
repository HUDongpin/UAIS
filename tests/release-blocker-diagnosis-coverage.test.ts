import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("release blocker diagnosis coverage", () => {
  it("does not mark release ready when a ready release gate still has blocked requirements", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-blocker-diagnosis-ready-"));
    const releaseGatePath = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "ready",
      requirements: [
        {
          id: "app-auth-provider-readiness",
          status: "blocked",
          blockedReason: "app-auth-provider-readiness-not-live-ready",
          evidenceStatus: "dry-run-blocked",
        },
      ],
    });
    const diagnosisPath = writeText(
      tmpDir,
      "2026-07-01-app-auth-provider-live-blocker-diagnosis.md",
      "`app-auth-provider-readiness-not-live-ready`",
    );

    const output = execFileSync("node", [
      "scripts/release-blocker-diagnosis-coverage.mjs",
      "--release-gate",
      releaseGatePath,
      "--diagnosis",
      diagnosisPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("coverage-complete");
    expect(body.summary.uncoveredRequirementCount).toBe(0);
    expect(body.summary.releaseReady).toBe(false);
  });

  it("does not mark release ready when the owner decision queue is still waiting", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-blocker-diagnosis-owner-queue-"));
    const releaseGatePath = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "ready",
      requirements: [
        {
          id: "local-production-smoke",
          status: "satisfied",
          evidenceStatus: "passed",
        },
      ],
    });
    const ownerQueuePath = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      queue: [
        {
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/release-blocker-diagnosis-coverage.mjs",
      "--release-gate",
      releaseGatePath,
      "--owner-decision-queue",
      ownerQueuePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("coverage-complete");
    expect(body.ownerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.summary.blockedRequirementCount).toBe(0);
    expect(body.summary.ownerQueueBlockingReasonCount).toBe(1);
    expect(body.summary.releaseReady).toBe(false);
    expect(body.releaseReadinessBlockers).toEqual([
      "owner-queue-status-owner-decisions-required",
    ]);
  });

  it("maps blocked release-gate requirements to redacted diagnosis reports", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-blocker-diagnosis-coverage-"));
    const fakeLocalPath = ["", "Users", "example", "private", "secret.md"].join("/");
    const fakeUrl = ["https://", "private-production.example.test", "/smoke"].join("");
    const releaseGatePath = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      requirements: [
        {
          id: "app-auth-provider-readiness",
          status: "blocked",
          blockedReason: "app-auth-provider-readiness-not-live-ready",
          evidenceStatus: "dry-run-blocked",
        },
        {
          id: "deployment-route-smoke",
          status: "blocked",
          blockedReason: "deployment-route-smoke-not-live-passed",
          evidenceStatus: "dry-run-blocked",
        },
        {
          id: "ppt-manual-playback-acceptance",
          status: "blocked",
          blockedReason: "manual-ppt-playback-not-accepted",
          evidenceStatus: "plan-blocked",
        },
        {
          id: "still-uncovered-requirement",
          status: "blocked",
          blockedReason: "still-uncovered-reason",
          evidenceStatus: "blocked",
        },
        {
          id: "already-satisfied",
          status: "satisfied",
        },
      ],
    });
    const appAuthDiagnosis = writeText(
      tmpDir,
      "2026-07-01-app-auth-provider-live-blocker-diagnosis.md",
      [
        "# Diagnosis",
        "`app-auth-provider-readiness`",
        "`deployment-route-smoke-not-live-passed`",
      ].join("\n"),
    );
    const manualDiagnosis = writeText(
      tmpDir,
      "2026-07-01-manual-playback-live-blocker-diagnosis.md",
      [
        "# Diagnosis",
        "`manual-ppt-playback-not-accepted`",
        fakeLocalPath,
        fakeUrl,
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/release-blocker-diagnosis-coverage.mjs",
      "--release-gate",
      releaseGatePath,
      "--diagnosis",
      appAuthDiagnosis,
      "--diagnosis",
      manualDiagnosis,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain(fakeLocalPath);
    expect(output).not.toContain(fakeUrl);
    expect(body).toEqual(
      expect.objectContaining({
        target: "release-blocker-diagnosis-coverage",
        status: "coverage-needs-attention",
        releaseGateStatus: "blocked",
        responsibleSession: "S22/S25",
        summary: {
          blockedRequirementCount: 4,
          coveredRequirementCount: 3,
          uncoveredRequirementCount: 1,
          diagnosisFileCount: 2,
          ownerQueueBlockingReasonCount: 0,
          releaseReady: false,
        },
        uncoveredRequirementIds: ["still-uncovered-requirement"],
        safety: {
          sourcePathsOmitted: true,
          rawUrlsOmitted: true,
          secretValuesOmitted: true,
          responseBodiesOmitted: true,
          fileContentsOmitted: true,
          noLiveMutationPerformed: true,
          noDeploymentMutationPerformed: true,
          noReleaseRunBindingPerformed: true,
        },
      }),
    );
    expect(body.requirements).toEqual([
      expect.objectContaining({
        requirementId: "app-auth-provider-readiness",
        covered: true,
        diagnosisFileNames: ["2026-07-01-app-auth-provider-live-blocker-diagnosis.md"],
      }),
      expect.objectContaining({
        requirementId: "deployment-route-smoke",
        covered: true,
        diagnosisFileNames: ["2026-07-01-app-auth-provider-live-blocker-diagnosis.md"],
      }),
      expect.objectContaining({
        requirementId: "ppt-manual-playback-acceptance",
        covered: true,
        diagnosisFileNames: ["2026-07-01-manual-playback-live-blocker-diagnosis.md"],
      }),
      expect.objectContaining({
        requirementId: "still-uncovered-requirement",
        covered: false,
        diagnosisFileNames: [],
      }),
    ]);
  });

  it("renders none-recorded for empty diagnosis file lists in markdown", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-blocker-diagnosis-coverage-md-"));
    const releaseGatePath = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      requirements: [
        {
          id: "still-uncovered-requirement",
          status: "blocked",
          blockedReason: "still-uncovered-reason",
          evidenceStatus: "blocked",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/release-blocker-diagnosis-coverage.mjs",
      "--release-gate",
      releaseGatePath,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Release Blocker Diagnosis Coverage");
    expect(output).toContain("`still-uncovered-requirement`");
    expect(output).toContain("`none-recorded`");
    expect(output).not.toContain(tmpDir);
  });
});

function writeJson(dir: string, filename: string, value: unknown) {
  return writeText(dir, filename, JSON.stringify(value));
}

function writeText(dir: string, filename: string, value: string) {
  const path = join(dir, filename);
  writeFileSync(path, value);
  return path;
}
