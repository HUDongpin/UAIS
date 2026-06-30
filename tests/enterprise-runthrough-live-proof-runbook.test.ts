import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function extractConstStringArray(source: string, name: string): string[] {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));

  if (!match) {
    throw new Error(`Missing string array constant: ${name}`);
  }

  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, value]) => value);
}

function readRequiredEnterpriseLiveEvidenceTargetCount() {
  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/enterprise-live-evidence-audit.mjs"), "utf8"),
    "requiredEnterpriseLiveEvidenceTargets",
  ).length;
}

describe("current enterprise live-proof runbook", () => {
  const runbookPath = join(
    process.cwd(),
    "coordination/reports/2026-06-26-current-enterprise-runthrough-live-proof-runbook.md",
  );

  it("tracks the current 24-requirement gate and enterprise-live audit evidence chain", () => {
    const runbook = readFileSync(runbookPath, "utf8");

    expect(runbook).toContain("24-requirement production release gate");
    expect(runbook).toContain("all 24 requirements `status: \"satisfied\"`");
    expect(runbook).not.toContain("23-requirement");
    expect(runbook).not.toContain("all 23 requirements");
    expect(runbook).not.toContain("22-requirement");
    expect(runbook).not.toContain("all 22 requirements");

    expect(runbook).toContain(
      "- `<app-auth-provider-readiness-evidence>`: current production app-auth readiness evidence.",
    );
    expect(runbook).toContain(
      "node scripts/app-auth-provider-readiness.mjs --live --approved --environment production --env-file <env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> > <app-auth-provider-readiness-evidence>",
    );

    const appAuthBinding =
      "--app-auth-provider-readiness <app-auth-provider-readiness-evidence>";
    const appAuthBindingCount = runbook.split(appAuthBinding).length - 1;

    expect(appAuthBindingCount).toBeGreaterThanOrEqual(3);
    expect(runbook).toContain(
      "node scripts/teaching-operations-route-smoke.mjs --live --approved --environment production",
    );
    expect(runbook).toContain("--class-id <class-id>");
    expect(runbook).toContain("--student-cookie <student-cookie>");
    expect(runbook).toContain("--collaboration-invite-email-provider external");
    expect(runbook).toContain("--student-roster-sync-provider external");
    expect(runbook).toContain("--knowledge-index-sync-provider external");
    expect(runbook).toContain("--gradebook-release-provider external");
    expect(runbook).toContain("--course-content-publish-provider external");
    expect(runbook).toContain("--course-export-provider external");
    expect(runbook).toContain("--grading-feedback-provider external");
    expect(runbook).toContain(
      "node scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment production",
    );
    expect(runbook).toContain(
      "--deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --api-mode live-teaching-operations",
    );
    expect(runbook).toContain(
      "node scripts/teaching-course-management-route-smoke.mjs --live --approved --environment production",
    );
    expect(runbook).toContain(
      "--vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence>",
    );
    expect(runbook).toContain(
      "node scripts/enterprise-live-evidence-audit.mjs --reports-dir <reports-dir> --date <report-date> --output <enterprise-live-evidence-audit-evidence>",
    );
    expect(runbook).toContain("## Evidence Hygiene Preflight");
    expect(runbook).toContain(
      "coordination/reports/2026-06-28-enterprise-live-evidence-hygiene-blocker.md",
    );
    expect(runbook).toContain(
      "coordination/reports/2026-06-28-ppt-manual-playback-acceptance-record-template-production-live.json",
    );
    expect(runbook).toContain(
      "Before this command, confirm every non-evidence template is outside the `*-production-live*.json` glob.",
    );
    expect(runbook).toContain(
      "--enterprise-live-evidence-audit <enterprise-live-evidence-audit-evidence>",
    );
    expect(runbook).toContain("enterprise live evidence audit reports `status: \"ready\"`");
    expect(runbook).toContain(
      `all ${readRequiredEnterpriseLiveEvidenceTargetCount()} required production-live targets`,
    );
    expect(runbook).toContain(
      "node scripts/production-e2e-release-gate.mjs --teacher-workflow-ui <teacher-workflow-ui-evidence>",
    );
  });

  it("lists every canonical step from the production E2E orchestrator", () => {
    const runbook = readFileSync(runbookPath, "utf8");
    const output = execFileSync("node", [
      "--",
      "scripts/production-e2e-orchestrator.mjs",
      "--dry-run",
      "--report-date",
      "2026-06-29",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const orchestrator = JSON.parse(output) as {
      steps: Array<{
        order: number;
        id: string;
        command: string;
      }>;
    };

    expect(orchestrator.steps).toHaveLength(26);
    expect(runbook).toContain("## Canonical Orchestrator Step Coverage");
    for (const step of orchestrator.steps) {
      expect(runbook).toContain(`- \`${step.order}. ${step.id}\`: \`${step.command}\``);
    }
  });
});
