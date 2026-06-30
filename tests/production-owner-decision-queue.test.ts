import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production owner decision queue", () => {
  it("orders owner decisions from current release blockers without leaking source details", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decision-queue-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      blockedRequirementCount: 4,
      blockedReasons: [
        "app-auth-provider-readiness-not-live-ready",
        "vercel-env-not-applied",
        "enterprise-live-evidence-audit-not-ready",
      ],
      requirements: [
        {
          id: "app-auth-provider-readiness",
          status: "blocked",
          evidenceStatus: "dry-run-blocked",
          blockedReason: "app-auth-provider-readiness-not-live-ready",
        },
        {
          id: "vercel-env-placement",
          status: "blocked",
          evidenceStatus: "dry-run-blocked",
          blockedReason: "vercel-env-not-applied",
        },
        {
          id: "enterprise-live-evidence-audit",
          status: "blocked",
          evidenceStatus: "blocked",
          blockedReason: "enterprise-live-evidence-audit-not-ready",
        },
      ],
      leakedUrl: "https://private-production.example.test",
      leakedToken: "secret-production-token",
    });
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      target: "production-owner-decision-checklist",
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "production-release-run",
          status: "waiting-for-upstream-evidence",
          blockedReasons: [
            "app-auth-provider-readiness-not-live-ready",
            "vercel-env-not-applied",
            "enterprise-live-evidence-audit-not-ready",
          ],
          safeNextActions: [
            "wait-for-final-release-gate-ready",
            "bind-one-public-release-run-id-after-all-production-evidence-is-ready",
          ],
          forbiddenUntilApproved: [
            "bind-release-run-id-while-release-gate-blocked",
          ],
        },
        {
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
          blockedReasons: ["app-auth-provider-readiness-not-live-ready"],
          safeNextActions: [
            "confirm-production-app-auth-provider-mode",
            "bind-server-only-app-auth-env-through-s19-vercel-env-sync",
          ],
          forbiddenUntilApproved: [
            "inspect-or-print-app-auth-credential-values",
            "run-live-app-auth-provider-network-call",
          ],
        },
        {
          id: "enterprise-live-evidence-audit",
          status: "waiting-for-live-evidence",
          blockedReasons: ["enterprise-live-evidence-audit-not-ready"],
          safeNextActions: [
            "wait-for-approved-production-live-evidence-files",
            "run-enterprise-live-evidence-audit-after-all-target-evidence-exists",
          ],
          forbiddenUntilApproved: [
            "accept-filename-only-production-live-evidence",
            "accept-mismatched-release-run-id-production-evidence",
          ],
        },
        {
          id: "vercel-env-deploy-and-smoke-chain",
          status: "waiting-for-upstream-owner-decisions",
          blockedReasons: ["vercel-env-not-applied"],
          safeNextActions: [
            "confirm-s19-vercel-env-apply-approval",
            "run-redacted-vercel-env-sync-apply-with-approved-project-and-release-run-id",
          ],
          forbiddenUntilApproved: [
            "run-vercel-env-apply-without-owner-approval",
          ],
          sequencing: "project-readiness-before-env-apply-before-production-deploy-before-smokes",
        },
      ],
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      target: "enterprise-live-evidence-audit",
      status: "blocked",
      summary: {
        acceptedLiveEvidence: 0,
        filenameOnlyOrBlocked: 2,
        missingRequiredTargetCount: 2,
      },
      missingRequiredTargets: [
        "app-auth-provider-readiness",
        "deployment-domain-reachability",
      ],
      leakedPath: "/Users/private/enterprise-audit.json",
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-queue.mjs",
      "--release-gate",
      releaseGate,
      "--owner-checklist",
      ownerChecklist,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "production-owner-decision-queue",
        status: "owner-decisions-required",
        releaseGateStatus: "blocked",
        responsibleSession: "S22",
        summary: expect.objectContaining({
          blockedRequirementCount: 4,
          ownerDecisionCount: 4,
          acceptedLiveEvidence: 0,
          missingEnterpriseLiveTargetCount: 2,
          firstActionableDecisionId: "app-auth-provider-production-selector",
        }),
        safety: {
          sourcePathsOmitted: true,
          valuesRedacted: true,
          liveMutationPerformed: false,
          deploymentMutationPerformed: false,
        },
      }),
    );
    expect(body.queue.map((item: { id: string }) => item.id)).toEqual([
      "app-auth-provider-production-selector",
      "vercel-env-deploy-and-smoke-chain",
      "enterprise-live-evidence-audit",
      "production-release-run",
    ]);
    expect(body.queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          status: "owner-decision-needed",
          releaseGateRequirementIds: ["app-auth-provider-readiness"],
          enterpriseAuditMissingTargets: ["app-auth-provider-readiness"],
          nextOwnerQuestion: "Confirm production app auth provider mode and approved server-only env source.",
          safeNextActions: expect.arrayContaining([
            "confirm-production-app-auth-provider-mode",
          ]),
          forbiddenUntilApproved: expect.arrayContaining([
            "inspect-or-print-app-auth-credential-values",
          ]),
        }),
        expect.objectContaining({
          id: "production-release-run",
          category: "final-release-binding",
          releaseGateRequirementIds: [
            "app-auth-provider-readiness",
            "vercel-env-placement",
            "enterprise-live-evidence-audit",
          ],
          nextOwnerQuestion: "Do not bind the production release-run ID until the release gate is ready.",
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-production.example.test");
    expect(output).not.toContain("secret-production-token");
  });

  it("renders a concise markdown queue for S10 and S25 handoff", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-owner-decision-queue-md-"));
    const releaseGate = writeJson(tmpDir, "release-gate.json", {
      status: "blocked",
      blockedRequirementCount: 1,
      requirements: [
        {
          id: "manual-ppt-playback-acceptance",
          status: "blocked",
          blockedReason: "manual-ppt-playback-not-accepted",
        },
      ],
    });
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "manual-ppt-playback-acceptance",
          status: "human-qa-needed",
          blockedReasons: ["manual-ppt-playback-not-accepted"],
          safeNextActions: ["package-manual-ppt-playback-evidence-for-human-review"],
          forbiddenUntilApproved: ["mark-manual-ppt-accepted-before-human-playback"],
        },
      ],
    });
    const enterpriseAudit = writeJson(tmpDir, "enterprise-audit.json", {
      status: "blocked",
      summary: { acceptedLiveEvidence: 0, missingRequiredTargetCount: 1 },
      missingRequiredTargets: ["ppt-manual-playback-acceptance"],
    });

    const output = execFileSync("node", [
      "scripts/production-owner-decision-queue.mjs",
      "--release-gate",
      releaseGate,
      "--owner-checklist",
      ownerChecklist,
      "--enterprise-live-evidence-audit",
      enterpriseAudit,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS Production Owner Decision Queue");
    expect(output).toContain("| 1 | `manual-ppt-playback-acceptance` | human-qa | human-qa-needed |");
    expect(output).toContain("Do not treat this report as release-ready evidence while the release gate is blocked.");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(tmpDir: string, filename: string, body: unknown) {
  const filePath = join(tmpDir, filename);
  writeFileSync(filePath, JSON.stringify(body, null, 2));
  return filePath;
}
