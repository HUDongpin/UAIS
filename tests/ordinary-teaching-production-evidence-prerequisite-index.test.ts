import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ordinary teaching production evidence prerequisite index", () => {
  it("does not request ordinary teaching owner labels while upstream production evidence is missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ordinary-prereq-index-"));
    const gapMatrixPath = writeJson(tmpDir, "gap-matrix.json", {
      target: "owner-decision-response-gap-matrix",
      status: "owner-response-gaps-present",
      summary: {
        firstActionableDecisionId: "ordinary-teaching-production-evidence",
      },
      gapRows: [
        acceptedRow("app-auth-provider-production-selector"),
        acceptedRow("teacher-auth-provider-production-selector"),
        acceptedRow("external-storage-production-service"),
        acceptedRow("vercel-env-deploy-and-smoke-chain"),
        {
          rank: 5,
          decisionId: "ordinary-teaching-production-evidence",
          validationStatus: "owner-response-incomplete",
          missingFieldCount: 11,
          missingFields: [
            "approvedAppAuthReadinessEvidenceLabel-missing-or-invalid",
            "approvedTeacherAuthReadinessEvidenceLabel-missing-or-invalid",
          ],
        },
      ],
    });
    const releaseGatePath = writeJson(tmpDir, "release-gate.json", {
      target: "uais-production-e2e-release-gate",
      status: "blocked",
      requirements: [
        blockedRequirement("app-auth-provider-readiness", "dry-run-blocked"),
        blockedRequirement("teacher-auth-provider-readiness", "dry-run-blocked"),
        blockedRequirement("external-storage-service-readiness", "dry-run-blocked"),
        blockedRequirement("vercel-production-deployment", "dry-run-blocked"),
        blockedRequirement("deployment-domain-reachability", "dry-run-blocked"),
        blockedRequirement("teaching-operations-route-smoke", "dry-run-blocked"),
        blockedRequirement("teaching-operation-detail-browser-smoke", "dry-run-blocked"),
        blockedRequirement("teaching-course-management-route-smoke", "dry-run-blocked"),
      ],
    });
    const actionPacketPath = writeJson(tmpDir, "ordinary-action-packet.json", {
      target: "ordinary-teaching-production-evidence-action-packet",
      decisionId: "ordinary-teaching-production-evidence",
      upstreamEvidenceIds: [
        "app-auth-provider-readiness",
        "teacher-auth-provider-readiness",
        "external-storage-service-readiness",
        "vercel-production-deployment",
        "deployment-domain-reachability",
      ],
      releaseGateRequirementIds: [
        "teaching-operations-route-smoke",
        "teaching-operation-detail-browser-smoke",
        "teaching-course-management-route-smoke",
      ],
      requiredEvidence: [
        "app-auth-provider-readiness-production-live-ready",
        "teacher-auth-provider-readiness-production-live-ready",
        "external-storage-service-readiness-production-live-ready",
      ],
      commands: {
        teachingOperationsRouteSmoke:
          "node scripts/teaching-operations-route-smoke.mjs --base-url <deployment-url>",
      },
      stopConditions: ["Stop if production evidence is missing."],
    });

    const output = execFileSync("node", [
      "scripts/ordinary-teaching-production-evidence-prerequisite-index.mjs",
      "--owner-response-gap-matrix",
      gapMatrixPath,
      "--release-gate",
      releaseGatePath,
      "--ordinary-teaching-action-packet",
      actionPacketPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "ordinary-teaching-production-evidence-prerequisite-index",
        status: "waiting-for-production-live-evidence",
        releaseReady: false,
        decisionId: "ordinary-teaching-production-evidence",
        summary: expect.objectContaining({
          acceptedOwnerPrerequisiteCount: 4,
          incompleteOwnerPrerequisiteCount: 0,
          missingPrerequisiteEvidenceCount: 5,
          missingSmokeTargetCount: 3,
          ordinaryOwnerResponseCanBeAccepted: false,
          releaseReady: false,
        }),
        nextOperationalBlocker: "production-live-evidence-missing",
        commandBodiesOmitted: true,
      }),
    );
    expect(body.ownerPrerequisites.map((item: { decisionId: string }) => item.decisionId)).toEqual([
      "app-auth-provider-production-selector",
      "teacher-auth-provider-production-selector",
      "external-storage-production-service",
      "vercel-env-deploy-and-smoke-chain",
    ]);
    expect(body.missingPrerequisiteEvidence.map((item: { id: string }) => item.id)).toEqual([
      "app-auth-provider-readiness",
      "teacher-auth-provider-readiness",
      "external-storage-service-readiness",
      "vercel-production-deployment",
      "deployment-domain-reachability",
    ]);
    expect(body.missingSmokeTargets.map((item: { id: string }) => item.id)).toEqual([
      "teaching-operations-route-smoke",
      "teaching-operation-detail-browser-smoke",
      "teaching-course-management-route-smoke",
    ]);
    expect(body.nextSafeActions).toContain(
      "produce-release-run-bound-auth-storage-deployment-evidence-before-ordinary-owner-response",
    );
    expect(body.stillForbiddenUntilResolved).toContain(
      "fill-ordinary-teaching-owner-response-with-unproven-evidence-labels",
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("<deployment-url>");
  });
});

function acceptedRow(decisionId: string) {
  return {
    decisionId,
    validationStatus: "owner-response-accepted",
    missingFieldCount: 0,
    unsafeFindingCount: 0,
  };
}

function blockedRequirement(id: string, evidenceStatus: string) {
  return {
    id,
    status: "blocked",
    evidenceStatus,
    blockedReason: `${id}-not-live-ready`,
  };
}

function writeJson(dir: string, fileName: string, value: unknown) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}
