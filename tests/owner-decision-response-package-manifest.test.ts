import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("owner decision response package manifest", () => {
  it("fingerprints response template and validation packages in owner queue order", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-package-manifest-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeText(
      reportsDir,
      "2026-07-01-production-owner-decision-queue-enterprise-runthrough.json",
      JSON.stringify({
        status: "owner-decisions-required",
        releaseGateStatus: "blocked",
        summary: {
          blockedRequirementCount: 19,
          ownerDecisionCount: 2,
          acceptedLiveEvidence: 0,
          missingEnterpriseLiveTargetCount: 16,
        },
        queue: [
          {
            rank: 1,
            id: "app-auth-provider-production-selector",
            status: "owner-decision-needed",
            category: "owner-decision",
          },
          {
            rank: 2,
            id: "production-release-run",
            status: "waiting-for-upstream-evidence",
            category: "final-release-binding",
          },
        ],
        leakedPath: "/Users/example/private/queue.json",
      }),
    );
    const queueMarkdown = writeText(
      reportsDir,
      "2026-07-01-production-owner-decision-queue-enterprise-runthrough.md",
      "queue markdown with https://private-production.example.test omitted by manifest\n",
    );
    const appTemplate = writeResponseReport({
      reportsDir,
      fileStem: "2026-07-01-owner-decision-app-auth-response-template-enterprise-runthrough",
      target: "owner-decision-app-auth-response-template",
      status: "awaiting-owner-response",
      decisionId: "app-auth-provider-production-selector",
      summary: {
        queueRank: 1,
        releaseReady: false,
      },
    });
    const appTemplateMd = writeText(
      reportsDir,
      "2026-07-01-owner-decision-app-auth-response-template-enterprise-runthrough.md",
      "app template markdown\n",
    );
    const appValidation = writeResponseReport({
      reportsDir,
      fileStem: "2026-07-01-owner-decision-app-auth-response-validation-enterprise-runthrough",
      target: "owner-decision-app-auth-response-validation",
      status: "owner-response-incomplete",
      decisionId: "app-auth-provider-production-selector",
      summary: {
        missingFieldCount: 7,
        unsafeFindingCount: 0,
        releaseReady: false,
      },
    });
    const appValidationMd = writeText(
      reportsDir,
      "2026-07-01-owner-decision-app-auth-response-validation-enterprise-runthrough.md",
      "app validation markdown\n",
    );
    const releaseTemplate = writeResponseReport({
      reportsDir,
      fileStem: "2026-07-01-owner-decision-production-release-run-response-template-enterprise-runthrough",
      target: "owner-decision-production-release-run-response-template",
      status: "queued-awaiting-final-release-gate",
      decisionId: "production-release-run",
      summary: {
        queueRank: 2,
        upstreamBlockedDecisionCount: 1,
        releaseReady: false,
      },
    });
    const releaseTemplateMd = writeText(
      reportsDir,
      "2026-07-01-owner-decision-production-release-run-response-template-enterprise-runthrough.md",
      "release template markdown\n",
    );
    const releaseValidation = writeResponseReport({
      reportsDir,
      fileStem: "2026-07-01-owner-decision-production-release-run-response-validation-enterprise-runthrough",
      target: "owner-decision-production-release-run-response-validation",
      status: "owner-response-incomplete",
      decisionId: "production-release-run",
      summary: {
        missingFieldCount: 17,
        unsafeFindingCount: 0,
        releaseRunBindingPerformed: false,
        releaseReady: false,
      },
    });
    const releaseValidationMd = writeText(
      reportsDir,
      "2026-07-01-owner-decision-production-release-run-response-validation-enterprise-runthrough.md",
      "release validation markdown\n",
    );

    const output = execFileSync("node", [
      "scripts/owner-decision-response-package-manifest.mjs",
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "owner-decision-response-package-manifest",
        status: "response-package-manifest-created",
        releaseReady: false,
        releaseGateStatus: "blocked",
        ownerDecisionQueueStatus: "owner-decisions-required",
        sourceQueueFileName: "2026-07-01-production-owner-decision-queue-enterprise-runthrough.json",
        summary: {
          queueItemCount: 2,
          responsePackageCount: 2,
          templateReportCount: 2,
          validationReportCount: 2,
          markdownReportCount: 5,
          artifactCount: 10,
          missingArtifactCount: 0,
          incompleteValidationCount: 2,
          unsafeFindingTotal: 0,
          releaseRunBindingPerformedCount: 0,
          safetyAttentionCount: 0,
          releaseReady: false,
        },
        missingArtifacts: [],
        safety: {
          sourcePathsOmitted: true,
          rawUrlsOmitted: true,
          secretValuesOmitted: true,
          responseBodiesOmitted: true,
          noLiveMutationPerformed: true,
          noDeploymentMutationPerformed: true,
          noReleaseRunBindingPerformed: true,
          fileContentsOmitted: true,
        },
      }),
    );
    expect(body.responsePackages).toEqual([
      expect.objectContaining({
        rank: 1,
        decisionId: "app-auth-provider-production-selector",
        queueStatus: "owner-decision-needed",
        templateStatus: "awaiting-owner-response",
        validationStatus: "owner-response-incomplete",
        missingFieldCount: 7,
        unsafeFindingCount: 0,
      }),
      expect.objectContaining({
        rank: 2,
        decisionId: "production-release-run",
        queueStatus: "waiting-for-upstream-evidence",
        templateStatus: "queued-awaiting-final-release-gate",
        validationStatus: "owner-response-incomplete",
        missingFieldCount: 17,
        unsafeFindingCount: 0,
        releaseRunBindingPerformed: false,
      }),
    ]);
    expect(body.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "owner-decision-queue-json",
          fileName: "2026-07-01-production-owner-decision-queue-enterprise-runthrough.json",
          sha256: sha256(queue),
        }),
        expect.objectContaining({
          role: "owner-decision-queue-markdown",
          fileName: "2026-07-01-production-owner-decision-queue-enterprise-runthrough.md",
          sha256: sha256(queueMarkdown),
        }),
        expect.objectContaining({
          role: "response-template-json",
          decisionId: "app-auth-provider-production-selector",
          rank: 1,
          fileName: "2026-07-01-owner-decision-app-auth-response-template-enterprise-runthrough.json",
          sha256: sha256(appTemplate),
        }),
        expect.objectContaining({
          role: "response-template-markdown",
          decisionId: "app-auth-provider-production-selector",
          rank: 1,
          fileName: "2026-07-01-owner-decision-app-auth-response-template-enterprise-runthrough.md",
          sha256: sha256(appTemplateMd),
        }),
        expect.objectContaining({
          role: "response-validation-json",
          decisionId: "app-auth-provider-production-selector",
          rank: 1,
          fileName: "2026-07-01-owner-decision-app-auth-response-validation-enterprise-runthrough.json",
          sha256: sha256(appValidation),
        }),
        expect.objectContaining({
          role: "response-validation-markdown",
          decisionId: "app-auth-provider-production-selector",
          rank: 1,
          fileName: "2026-07-01-owner-decision-app-auth-response-validation-enterprise-runthrough.md",
          sha256: sha256(appValidationMd),
        }),
        expect.objectContaining({
          role: "response-template-json",
          decisionId: "production-release-run",
          rank: 2,
          fileName: "2026-07-01-owner-decision-production-release-run-response-template-enterprise-runthrough.json",
          sha256: sha256(releaseTemplate),
        }),
        expect.objectContaining({
          role: "response-template-markdown",
          decisionId: "production-release-run",
          rank: 2,
          fileName: "2026-07-01-owner-decision-production-release-run-response-template-enterprise-runthrough.md",
          sha256: sha256(releaseTemplateMd),
        }),
        expect.objectContaining({
          role: "response-validation-json",
          decisionId: "production-release-run",
          rank: 2,
          fileName: "2026-07-01-owner-decision-production-release-run-response-validation-enterprise-runthrough.json",
          sha256: sha256(releaseValidation),
        }),
        expect.objectContaining({
          role: "response-validation-markdown",
          decisionId: "production-release-run",
          rank: 2,
          fileName: "2026-07-01-owner-decision-production-release-run-response-validation-enterprise-runthrough.md",
          sha256: sha256(releaseValidationMd),
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-production.example.test");
  });

  it("reports incomplete when a queued response validation artifact is missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-package-manifest-missing-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeText(
      reportsDir,
      "2026-07-01-production-owner-decision-queue-enterprise-runthrough.json",
      JSON.stringify({
        status: "owner-decisions-required",
        queue: [
          {
            rank: 1,
            id: "teacher-auth-provider-production-selector",
            status: "owner-decision-needed",
          },
        ],
      }),
    );
    writeResponseReport({
      reportsDir,
      fileStem: "2026-07-01-owner-decision-teacher-auth-response-template-enterprise-runthrough",
      target: "owner-decision-teacher-auth-response-template",
      status: "queued-awaiting-upstream-app-auth",
      decisionId: "teacher-auth-provider-production-selector",
      summary: {
        queueRank: 1,
        releaseReady: false,
      },
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-package-manifest.mjs",
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("response-package-manifest-incomplete");
    expect(body.summary.missingArtifactCount).toBeGreaterThanOrEqual(1);
    expect(body.missingArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "response-validation-json",
          decisionId: "teacher-auth-provider-production-selector",
        }),
      ]),
    );
  });

  it("marks the manifest for safety review when response validation reports unsafe side effects", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-package-manifest-safety-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeText(
      reportsDir,
      "2026-07-01-production-owner-decision-queue-enterprise-runthrough.json",
      JSON.stringify({
        status: "owner-decisions-required",
        releaseGateStatus: "blocked",
        queue: [
          {
            rank: 1,
            id: "production-release-run",
            status: "waiting-for-upstream-evidence",
          },
        ],
      }),
    );
    writeResponseReport({
      reportsDir,
      fileStem: "2026-07-01-owner-decision-production-release-run-response-template-enterprise-runthrough",
      target: "owner-decision-production-release-run-response-template",
      status: "queued-awaiting-final-release-gate",
      decisionId: "production-release-run",
      summary: {
        queueRank: 1,
        releaseReady: false,
      },
    });
    writeResponseReport({
      reportsDir,
      fileStem: "2026-07-01-owner-decision-production-release-run-response-validation-enterprise-runthrough",
      target: "owner-decision-production-release-run-response-validation",
      status: "owner-response-accepted",
      decisionId: "production-release-run",
      summary: {
        missingFieldCount: 0,
        unsafeFindingCount: 2,
        releaseRunBindingPerformed: true,
        releaseReady: false,
      },
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-package-manifest.mjs",
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("response-package-manifest-needs-safety-review");
    expect(body.summary.unsafeFindingTotal).toBe(2);
    expect(body.summary.releaseRunBindingPerformedCount).toBe(1);
    expect(body.summary.safetyAttentionCount).toBe(3);
    expect(body.safety.noReleaseRunBindingPerformed).toBe(false);
    expect(body.responsePackages[0]).toEqual(
      expect.objectContaining({
        decisionId: "production-release-run",
        validationStatus: "owner-response-accepted",
        unsafeFindingCount: 2,
        releaseRunBindingPerformed: true,
      }),
    );
  });

  it("does not mark the package release-ready from a single ready template while validations remain incomplete", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-package-manifest-ready-mismatch-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeText(
      reportsDir,
      "2026-07-01-production-owner-decision-queue-enterprise-runthrough.json",
      JSON.stringify({
        status: "owner-decisions-required",
        releaseGateStatus: "blocked",
        queue: [
          {
            rank: 1,
            id: "app-auth-provider-production-selector",
            status: "owner-decision-needed",
          },
        ],
      }),
    );
    writeResponseReport({
      reportsDir,
      fileStem: "2026-07-01-owner-decision-app-auth-response-template-enterprise-runthrough",
      target: "owner-decision-app-auth-response-template",
      status: "awaiting-owner-response",
      decisionId: "app-auth-provider-production-selector",
      summary: {
        queueRank: 1,
        releaseReady: true,
      },
    });
    writeResponseReport({
      reportsDir,
      fileStem: "2026-07-01-owner-decision-app-auth-response-validation-enterprise-runthrough",
      target: "owner-decision-app-auth-response-validation",
      status: "owner-response-incomplete",
      decisionId: "app-auth-provider-production-selector",
      summary: {
        missingFieldCount: 2,
        unsafeFindingCount: 0,
        releaseReady: false,
      },
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-package-manifest.mjs",
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.summary.incompleteValidationCount).toBe(1);
    expect(body.responsePackages[0]).toEqual(
      expect.objectContaining({
        decisionId: "app-auth-provider-production-selector",
        validationStatus: "owner-response-incomplete",
        releaseReady: false,
      }),
    );
    expect(body.summary.releaseReady).toBe(false);
  });

  it("does not mark the manifest release-ready while the owner queue still requires decisions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-package-manifest-queue-blocked-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeText(
      reportsDir,
      "2026-07-01-production-owner-decision-queue-enterprise-runthrough.json",
      JSON.stringify({
        status: "owner-decisions-required",
        releaseGateStatus: "blocked",
        queue: [
          {
            rank: 1,
            id: "app-auth-provider-production-selector",
            status: "owner-decision-needed",
          },
        ],
      }),
    );
    writeResponseReport({
      reportsDir,
      fileStem: "2026-07-01-owner-decision-app-auth-response-template-enterprise-runthrough",
      target: "owner-decision-app-auth-response-template",
      status: "owner-response-accepted",
      decisionId: "app-auth-provider-production-selector",
      summary: {
        queueRank: 1,
        releaseReady: true,
      },
    });
    writeResponseReport({
      reportsDir,
      fileStem: "2026-07-01-owner-decision-app-auth-response-validation-enterprise-runthrough",
      target: "owner-decision-app-auth-response-validation",
      status: "owner-response-accepted",
      decisionId: "app-auth-provider-production-selector",
      summary: {
        missingFieldCount: 0,
        unsafeFindingCount: 0,
        releaseRunBindingPerformed: false,
        releaseReady: true,
      },
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-package-manifest.mjs",
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.ownerDecisionQueueStatus).toBe("owner-decisions-required");
    expect(body.summary.incompleteValidationCount).toBe(0);
    expect(body.responsePackages).toEqual([
      expect.objectContaining({
        decisionId: "app-auth-provider-production-selector",
        releaseReady: true,
      }),
    ]);
    expect(body.summary.releaseReady).toBe(false);
  });

  it("renders markdown for S10/S25 owner response handoff", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-response-package-manifest-md-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const queue = writeText(
      reportsDir,
      "2026-07-01-production-owner-decision-queue-enterprise-runthrough.json",
      JSON.stringify({
        status: "owner-decisions-required",
        releaseGateStatus: "blocked",
        queue: [
          {
            rank: 1,
            id: "external-storage-production-service",
            status: "owner-decision-needed",
          },
        ],
      }),
    );
    writeResponseReport({
      reportsDir,
      fileStem: "2026-07-01-owner-decision-external-storage-response-template-enterprise-runthrough",
      target: "owner-decision-external-storage-response-template",
      status: "queued-awaiting-upstream-auth-decisions",
      decisionId: "external-storage-production-service",
      summary: {
        queueRank: 1,
        releaseReady: false,
      },
    });
    writeResponseReport({
      reportsDir,
      fileStem: "2026-07-01-owner-decision-external-storage-response-validation-enterprise-runthrough",
      target: "owner-decision-external-storage-response-validation",
      status: "owner-response-incomplete",
      decisionId: "external-storage-production-service",
      summary: {
        missingFieldCount: 11,
        unsafeFindingCount: 0,
        releaseReady: false,
      },
    });

    const output = execFileSync("node", [
      "scripts/owner-decision-response-package-manifest.mjs",
      "--owner-decision-queue",
      queue,
      "--reports-dir",
      reportsDir,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Owner Decision Response Package Manifest");
    expect(output).toContain("Release gate: `blocked`");
    expect(output).toContain("Owner queue: `owner-decisions-required`");
    expect(output).toContain("| `1` | `external-storage-production-service` |");
    expect(output).toContain("`owner-response-incomplete`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeResponseReport({
  reportsDir,
  fileStem,
  target,
  status,
  decisionId,
  summary,
}: {
  reportsDir: string;
  fileStem: string;
  target: string;
  status: string;
  decisionId: string;
  summary: Record<string, unknown>;
}) {
  return writeText(
    reportsDir,
    `${fileStem}.json`,
    JSON.stringify({
      target,
      status,
      decisionId,
      summary,
      leakedPath: "/Users/example/private/response.json",
      leakedUrl: "https://private-production.example.test/response",
    }),
  );
}

function writeText(dir: string, filename: string, body: string) {
  const filePath = join(dir, filename);
  writeFileSync(filePath, body);
  return filePath;
}

function sha256(filePath: string) {
  const output = execFileSync("shasum", ["-a", "256", filePath], {
    encoding: "utf8",
  });
  return `sha256:${output.split(/\s+/)[0]}`;
}
