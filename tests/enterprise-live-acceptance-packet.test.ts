import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEACHING_OPERATION_IDS } from "@/components/teaching/teaching-operation-data";

function extractConstStringArray(source: string, name: string): string[] {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));

  if (!match) {
    throw new Error(`Missing string array constant: ${name}`);
  }

  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, value]) => value);
}

function readRequiredEnterpriseLiveEvidenceTargets() {
  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/enterprise-live-evidence-audit.mjs"), "utf8"),
    "requiredEnterpriseLiveEvidenceTargets",
  );
}

function readRequiredTargetResultKeys() {
  const releaseGateSource = readFileSync(
    join(process.cwd(), "scripts/production-e2e-release-gate.mjs"),
    "utf8",
  );

  return {
    "deployment-route-smoke": extractConstStringArray(
      releaseGateSource,
      "requiredRouteSmokeIds",
    ),
    "teacher-workflow-deployment-smoke": extractConstStringArray(
      releaseGateSource,
      "requiredDeployedTeacherWorkflowAnchors",
    ),
    "teacher-workflow-browser-smoke": extractConstStringArray(
      releaseGateSource,
      "requiredTeacherWorkflowBrowserResults",
    ),
    "teacher-workflow-live-generation-smoke": extractConstStringArray(
      releaseGateSource,
      "requiredTeacherWorkflowLiveGenerationResults",
    ),
    "learning-ppt-playback-deployment-smoke": extractConstStringArray(
      releaseGateSource,
      "requiredLearningPptPlaybackResults",
    ),
    "teaching-operations-route-smoke": extractConstStringArray(
      releaseGateSource,
      "requiredTeachingOperationsRouteSmokeResults",
    ),
    "teaching-operation-detail-browser-smoke": extractConstStringArray(
      releaseGateSource,
      "requiredTeachingOperationDetailBrowserResults",
    ),
    "teaching-course-management-route-smoke": extractConstStringArray(
      releaseGateSource,
      "requiredTeachingCourseManagementRouteSmokeResults",
    ),
    "external-storage-smoke": extractConstStringArray(
      releaseGateSource,
      "requiredExternalStorageSmokeIds",
    ),
  };
}

function readRequiredTeachingOperationsRouteSmokeProofs() {
  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/teaching-operations-route-smoke.mjs"), "utf8"),
    "proves",
  );
}

function readRequiredTeachingOperationsRouteSmokeRoutes() {
  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/production-e2e-release-gate.mjs"), "utf8"),
    "requiredTeachingOperationsRouteSmokeRoutes",
  );
}

function readRequiredTeachingCourseManagementRouteSmokeProofs() {
  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/production-e2e-release-gate.mjs"), "utf8"),
    "requiredTeachingCourseManagementRouteSmokeProofs",
  );
}

function readRequiredTeachingCourseManagementRouteSmokeRoutes() {
  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/production-e2e-release-gate.mjs"), "utf8"),
    "requiredTeachingCourseManagementRouteSmokeRoutes",
  );
}

function readRequiredTeachingOperationDetailBrowserContractKeys() {
  return extractConstStringArray(
    readFileSync(join(process.cwd(), "scripts/enterprise-live-evidence-audit.mjs"), "utf8"),
    "requiredTeachingOperationDetailBrowserContractKeys",
  );
}

describe("enterprise live acceptance packet", () => {
  const packetPath = join(
    process.cwd(),
    "coordination/reports/2026-06-28-enterprise-live-acceptance-packet.md",
  );
  const auditPath = join(
    process.cwd(),
    "coordination/reports/2026-06-28-enterprise-live-evidence-audit.json",
  );
  const releaseGatePath = join(
    process.cwd(),
    "coordination/reports/2026-06-28-production-e2e-release-gate.json",
  );
  const orchestratorPath = join(
    process.cwd(),
    "coordination/reports/2026-06-28-production-e2e-orchestrator-dry-run-current-enterprise-refresh.json",
  );
  const evidenceHygieneBlockerPath = join(
    process.cwd(),
    "coordination/reports/2026-06-28-enterprise-live-evidence-hygiene-blocker.md",
  );

  it("requires live production proof from evidence body fields instead of filenames", () => {
    const packet = readFileSync(packetPath, "utf8");

    expect(packet).toContain("filenames such as `production-live` are not acceptance proof");
    expect(packet).toContain("JSON body fields required before accepting any production-live-named evidence");
    expect(packet).toContain("- `mode: \"live\"`");
    expect(packet).toContain("- `environment: \"production\"`");
    expect(packet).toContain("- default target status `passed`");
    expect(packet).toContain("- readiness target status `ready` for app auth, teacher auth, and external storage service readiness");
    expect(packet).toContain("- manual PPT playback acceptance status `accepted` with `mode: \"record\"`");
    expect(packet).toContain("- a non-empty `releaseRunId` shared by every live evidence file");
    expect(packet).toContain("- required `safety` redaction flags proved in the JSON body");
    expect(packet).toContain("- `cookieValuesOmitted: true`");
    expect(packet).toContain(
      "Enterprise live audit result/env/contract criteria are enabled",
    );
    expect(packet).toContain(
      '- for target-specific result evidence, `targetResultStatus: "proved"` with required workflow/page anchors as `present`, object-result keys as `passed`, and route/storage smoke result ids as `ok`',
    );
    expect(packet).toContain(
      'for operation-detail browser evidence, `targetContractStatus: "proved"` with live teaching APIs, an issuer-issued teacher auth cookie, remote HTTPS deployment origin, Vercel/deployment-domain/teacher-auth/app-auth bindings, and full 11-operation primary/secondary button coverage',
    );
    expect(packet).toContain(
      'for ordinary teaching route-smoke evidence, `targetContractStatus: "proved"` with the required `proves` proof-contract entries and `routes` subroute coverage from the release gate',
    );
    for (const route of readRequiredTeachingOperationsRouteSmokeRoutes()) {
      expect(packet).toContain(`- \`${route}\``);
    }
    for (const route of readRequiredTeachingCourseManagementRouteSmokeRoutes()) {
      expect(packet).toContain(`- \`${route}\``);
    }
    expect(packet).toContain(
      'ordinary teaching route-smoke `requiredEnv` entries for external backends, external provider URLs/tokens, smoke cookies, teacher/course/class ids, and deployment base URL must be body-proved as `present`',
    );
    expect(packet).toContain("ordinary teaching evidence statuses are all `live-passed`");
    expect(packet).toContain(
      "--enterprise-live-evidence-audit coordination/reports/2026-06-28-enterprise-live-evidence-audit.json",
    );
  });

  it("uses the orchestrated production-live manual PPT acceptance file in the final gate command", () => {
    const packet = readFileSync(packetPath, "utf8");
    const orchestrator = JSON.parse(readFileSync(orchestratorPath, "utf8")) as {
      evidenceFiles: { pptAcceptance: string };
    };
    const pptAcceptancePath = `coordination/reports/${orchestrator.evidenceFiles.pptAcceptance}`;
    const pptAcceptanceEvidence = JSON.parse(
      readFileSync(join(process.cwd(), pptAcceptancePath), "utf8"),
    ) as {
      target?: string;
      mode?: string;
      status?: string;
      safety?: {
        valuesRedacted?: boolean;
        cookieValuesOmitted?: boolean;
        responseBodiesOmitted?: boolean;
      };
    };

    expect(orchestrator.evidenceFiles.pptAcceptance).toBe(
      "2026-06-28-ppt-manual-playback-acceptance-production-live.json",
    );
    expect(packet).toContain(`--ppt-acceptance ${pptAcceptancePath}`);
    expect(pptAcceptanceEvidence.target).toBe("ppt-manual-playback-acceptance");
    expect([
      { mode: "plan", status: "blocked" },
      { mode: "record", status: "accepted" },
    ]).toContainEqual({
      mode: pptAcceptanceEvidence.mode,
      status: pptAcceptanceEvidence.status,
    });
    expect(pptAcceptanceEvidence.safety).toEqual(
      expect.objectContaining({
        valuesRedacted: true,
        cookieValuesOmitted: true,
        responseBodiesOmitted: true,
      }),
    );
    expect(packet).not.toContain(
      "--ppt-acceptance coordination/reports/2026-06-28-kangxia-ppt-manual-acceptance-production.json",
    );
  });

  it("keeps the current orchestrator ordinary teaching plan aligned with gradebook rollback provider evidence", () => {
    const orchestrator = readFileSync(orchestratorPath, "utf8");

    expect(orchestrator).toContain('"gradebookProviderRollbackReturned"');
    expect(orchestrator).toContain('"gradebook-provider-rollback-returned"');
  });

  it("keeps the current orchestrator external-storage step aligned with ordinary teaching backup and concurrent append proofs", () => {
    const orchestrator = JSON.parse(readFileSync(orchestratorPath, "utf8")) as {
      steps: Array<{ id?: string; proves?: string[] }>;
    };
    const externalStorageStep = orchestrator.steps.find(
      (step) => step.id === "s22-production-external-storage-smoke",
    );

    expect(externalStorageStep?.proves).toEqual(
      expect.arrayContaining([
        "teaching-operations-backup-created",
        "teaching-operations-restore-drill-verified",
        "ordinary-teaching-concurrent-append-readback",
        "ordinary-teaching-concurrent-append-sequence-distinct",
        "ordinary-teaching-concurrent-append-domain-projection-readback",
      ]),
    );
  });

  it("records the current local-production closed-loop evidence without counting it as production acceptance", () => {
    const packet = readFileSync(packetPath, "utf8");
    const localProductionEvidencePath =
      "coordination/reports/2026-06-30-local-production-e2e-smoke-enterprise-continuation.json";
    const localProductionEvidence = JSON.parse(
      readFileSync(join(process.cwd(), localProductionEvidencePath), "utf8"),
    ) as {
      target?: string;
      mode?: string;
      environment?: string;
      status?: string;
      checks?: Array<{ id?: string; status?: string; results?: Record<string, string> }>;
    };
    const operationDetailCheck = localProductionEvidence.checks?.find(
      (check) => check.id === "s22-local-teaching-operation-detail-browser-smoke",
    );

    expect(packet).toContain("## Local-Production Continuation Evidence");
    expect(packet).toContain(localProductionEvidencePath);
    expect(packet).toContain(`--local-production-e2e-smoke ${localProductionEvidencePath}`);
    expect(packet).toContain(
      "This evidence is a pre-production closed-loop proof, not production-live acceptance.",
    );
    expect(packet).toContain(
      "`localProductionPreflightSummary.status` may be `passed`, but `localProductionPreflightSummary.productionAcceptance` must remain `false`",
    );
    expect(packet).toContain("all 11 local-production checks are `passed`");
    expect(packet).toContain('`operationDetailCoverageVerified: "passed"`');
    expect(localProductionEvidence).toEqual(
      expect.objectContaining({
        target: "local-production-e2e-smoke",
        mode: "live",
        environment: "local-production",
        status: "passed",
      }),
    );
    expect(localProductionEvidence.checks?.every((check) => check.status === "passed")).toBe(true);
    expect(operationDetailCheck?.results?.operationDetailCoverageVerified).toBe("passed");
  });

  it("enumerates every required production-live target from the enterprise audit", () => {
    const packet = readFileSync(packetPath, "utf8");
    const requiredEnterpriseLiveEvidenceTargets =
      readRequiredEnterpriseLiveEvidenceTargets();

    expect(packet).toContain("## Required Enterprise Live Evidence Targets");
    expect(packet).toContain("Most targets must be body-proved with `status: \"passed\"`");
      expect(packet).toContain("readiness targets must be body-proved with `status: \"ready\"`");
      expect(packet).toContain("the manual PPT playback target must be body-proved with `mode: \"record\"` and `status: \"accepted\"`");
      expect(packet).toContain("no unexpected production-live evidence files");
      for (const target of requiredEnterpriseLiveEvidenceTargets) {
        expect(packet).toContain(`- \`${target}\``);
      }
  });

  it("enumerates target result proof keys from the enterprise audit", () => {
    const packet = readFileSync(packetPath, "utf8");
    const requiredTargetResultKeys = readRequiredTargetResultKeys();

    expect(packet).toContain("## Target Result Proof Keys");
    expect(packet).toContain('`targetResultStatus: "missing"`');
    expect(packet).toContain("`target-result-proof-missing`");

    for (const [target, resultKeys] of Object.entries(requiredTargetResultKeys)) {
      expect(packet).toContain(`### \`${target}\``);
      for (const resultKey of resultKeys) {
        expect(packet).toContain(`- \`${resultKey}\``);
      }
    }
  });

  it("enumerates ordinary teaching route-smoke proof-contract keys from the release gate", () => {
    const packet = readFileSync(packetPath, "utf8");
    const requiredTeachingOperationsProofs = readRequiredTeachingOperationsRouteSmokeProofs();
    const requiredTeachingOperationsRoutes = readRequiredTeachingOperationsRouteSmokeRoutes();
    const requiredTeachingCourseManagementProofs =
      readRequiredTeachingCourseManagementRouteSmokeProofs();
    const requiredTeachingCourseManagementRoutes =
      readRequiredTeachingCourseManagementRouteSmokeRoutes();
    const requiredOperationDetailBrowserContractKeys =
      readRequiredTeachingOperationDetailBrowserContractKeys();

    expect(packet).toContain("## Operation Detail Browser Contract Keys");
    expect(packet).toContain(
      "The operation-detail browser production-live evidence must include these contract entries",
    );
    expect(packet).toContain("### `teaching-operation-detail-browser-smoke`");
    for (const contractKey of requiredOperationDetailBrowserContractKeys) {
      expect(packet).toContain(`- \`${contractKey}\``);
    }
    expect(packet).toContain("## Ordinary Teaching Route-Smoke Proof Contract Keys");
    expect(packet).toContain(
      "The ordinary teaching route-smoke production-live evidence must include these `proves` entries",
    );
    expect(packet).toContain("### `teaching-operations-route-smoke`");
    expect(packet).toContain("### `teaching-course-management-route-smoke`");
    expect(packet).toContain('`targetContractStatus: "missing"`');
    expect(packet).toContain("`target-contract-proof-missing`");
    for (const route of requiredTeachingOperationsRoutes) {
      expect(packet).toContain(`- \`${route}\``);
    }
    for (const route of requiredTeachingCourseManagementRoutes) {
      expect(packet).toContain(`- \`${route}\``);
    }
    for (const proof of requiredTeachingOperationsProofs) {
      expect(packet).toContain(`- \`${proof}\``);
    }
    for (const proof of requiredTeachingCourseManagementProofs) {
      expect(packet).toContain(`- \`${proof}\``);
    }
  });

  it("keeps the current audit report free of stale unexpected target names", () => {
    const audit = JSON.parse(readFileSync(auditPath, "utf8"));
    const courseManagementEvidence = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "coordination/reports/2026-06-28-teaching-course-management-route-smoke-production-live.json",
        ),
        "utf8",
      ),
    );
    const teachingOperationsEvidence = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "coordination/reports/2026-06-28-teaching-operations-route-smoke-production-live.json",
        ),
        "utf8",
      ),
    );
    const teachingOperationDetailBrowserEvidence = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "coordination/reports/2026-06-28-teaching-operation-detail-browser-smoke-production-live.json",
        ),
        "utf8",
      ),
    );
    const teachingOperationsRequiredProofs =
      readRequiredTeachingOperationsRouteSmokeProofs();
    const teachingOperationsRequiredRoutes =
      readRequiredTeachingOperationsRouteSmokeRoutes();
    const courseManagementRequiredProofs =
      readRequiredTeachingCourseManagementRouteSmokeProofs();
    const persistenceRow = audit.rows.find(
      (row: { file?: string }) =>
        row.file === "2026-06-28-external-storage-persistence-production-live.json",
    );
    const appAuthRow = audit.rows.find(
      (row: { file?: string }) =>
        row.file === "2026-06-28-app-auth-provider-readiness-production-live.json",
    );
    const teacherAuthRow = audit.rows.find(
      (row: { file?: string }) =>
        row.file === "2026-06-28-teacher-auth-provider-readiness-production-live.json",
    );
    const deploymentReachabilityRow = audit.rows.find(
      (row: { file?: string }) =>
        row.file === "2026-06-28-deployment-domain-reachability-production-live.json",
    );
    const externalStorageReadinessRow = audit.rows.find(
      (row: { file?: string }) =>
        row.file === "2026-06-28-external-storage-service-readiness-production-live.json",
    );
    const routeSmokeRow = audit.rows.find(
      (row: { file?: string }) =>
        row.file === "2026-06-28-route-smoke-production-live.json",
    );
    const teacherAuthIssuerRouteRow = audit.rows.find(
      (row: { file?: string }) =>
        row.file === "2026-06-28-teacher-auth-issuer-route-smoke-production-live.json",
    );
    const courseManagementRow = audit.rows.find(
      (row: { file?: string }) =>
        row.file === "2026-06-28-teaching-course-management-route-smoke-production-live.json",
    );
    const teachingOperationsRow = audit.rows.find(
      (row: { file?: string }) =>
        row.file === "2026-06-28-teaching-operations-route-smoke-production-live.json",
    );
    const teachingOperationDetailBrowserRow = audit.rows.find(
      (row: { file?: string }) =>
        row.file ===
        "2026-06-28-teaching-operation-detail-browser-smoke-production-live.json",
    );

    expect(audit.summary.unexpectedTargetCount).toBe(0);
    expect(audit.unexpectedTargets).toEqual([]);
    expect(audit.summary.unexpectedEvidenceFileCount).toBe(0);
    expect(audit.unexpectedEvidenceFiles).toEqual([]);
    expect(audit.blockedReasons).not.toContain(
      "enterprise-live-unexpected-evidence-files-present",
    );
    expect(JSON.stringify(audit)).not.toContain("external-storage-persistence-smoke");
    expect(persistenceRow).toEqual(
      expect.objectContaining({
        filenameTarget: "external-storage-persistence",
        target: "external-storage-persistence",
        safetyStatus: "proved",
      }),
    );
    expect(persistenceRow.blockedReasons).not.toContain("target-not-required");
    expect(persistenceRow.blockedReasons).not.toContain("target-filename-mismatch");
    for (const row of [
      appAuthRow,
      teacherAuthRow,
      deploymentReachabilityRow,
      externalStorageReadinessRow,
      routeSmokeRow,
      teacherAuthIssuerRouteRow,
    ]) {
      expect(row).toEqual(expect.objectContaining({ safetyStatus: "proved" }));
      expect(row.blockedReasons).not.toContain("safety-not-proven");
    }
    expect(teachingOperationsEvidence.proves).toEqual(
      expect.arrayContaining(teachingOperationsRequiredProofs),
    );
    expect(teachingOperationsEvidence.routes).toEqual(
      expect.arrayContaining(teachingOperationsRequiredRoutes),
    );
    expect(teachingOperationsRow).toEqual(
      expect.objectContaining({
        target: "teaching-operations-route-smoke",
        targetContractStatus: "proved",
      }),
    );
    expect(teachingOperationsRow.missingContractKeys ?? []).toEqual([]);
    expect(
      teachingOperationDetailBrowserEvidence.operationCoverage.map(
        (entry: { operationId: string }) => entry.operationId,
      ),
    ).toEqual(TEACHING_OPERATION_IDS);
    for (const entry of teachingOperationDetailBrowserEvidence.operationCoverage) {
      expect(entry).toEqual(
        expect.objectContaining({
          route: expect.stringMatching(/^\/teaching\//),
          primaryButtonClick: expect.any(String),
          primaryPostPersisted: expect.any(String),
          secondaryButtonClick: expect.any(String),
          secondaryPostPersisted: expect.any(String),
        }),
      );
    }
    expect(teachingOperationDetailBrowserRow.missingContractKeys ?? []).not.toContain(
      "operationCoverage",
    );
    expect(courseManagementEvidence.proves).toEqual(
      expect.arrayContaining(courseManagementRequiredProofs),
    );
    expect(courseManagementRow).toEqual(
      expect.objectContaining({
        target: "teaching-course-management-route-smoke",
        targetContractStatus: "proved",
      }),
    );
    expect(courseManagementRow.missingContractKeys ?? []).toEqual([]);
  });

  it("keeps the current aggregate gate aligned with the final command evidence set", () => {
    const packet = readFileSync(packetPath, "utf8");
    const gate = JSON.parse(readFileSync(releaseGatePath, "utf8"));
    const finalCommandEvidencePaths = [
      "coordination/reports/2026-06-28-vercel-env-sync-production-apply.json",
      "coordination/reports/2026-06-28-vercel-env-inventory-production-observed.json",
      "coordination/reports/2026-06-28-trusted-teacher-auth-route-chain-contract.json",
      "coordination/reports/2026-06-28-external-storage-container-build-readiness-approved-build-release-run-bound.json",
      "coordination/reports/2026-06-28-vercel-production-deployment.json",
    ];

    for (const evidencePath of finalCommandEvidencePaths) {
      expect(packet).toContain(evidencePath);
      expect(() =>
        JSON.parse(readFileSync(join(process.cwd(), evidencePath), "utf8")),
      ).not.toThrow();
    }

    const requirementById = new Map(
      gate.requirements.map((requirement: { id: string }) => [
        requirement.id,
        requirement,
      ]),
    );

    expect(gate.blockedReasons).not.toContain("vercel-env-evidence-missing");
    expect(requirementById.get("vercel-env-placement")).toEqual(
      expect.objectContaining({
        id: "vercel-env-placement",
        evidenceStatus: expect.not.stringMatching(/^missing$/),
      }),
    );
    expect(requirementById.get("trusted-teacher-auth-route-chain")).toEqual(
      expect.objectContaining({
        id: "trusted-teacher-auth-route-chain",
        evidenceStatus: expect.not.stringContaining("waiting-for-trusted-route-chain"),
      }),
    );
    expect(requirementById.get("external-storage-container-build-readiness")).toEqual(
      expect.objectContaining({
        id: "external-storage-container-build-readiness",
        evidenceStatus: expect.not.stringContaining(
          "waiting-for-external-storage-container-build-readiness",
        ),
      }),
    );
    expect(requirementById.get("vercel-production-deployment")).toEqual(
      expect.objectContaining({
        id: "vercel-production-deployment",
        evidenceStatus: expect.not.stringMatching(/^missing$/),
      }),
    );
  });

  it("links the current production-live evidence hygiene blocker", () => {
    const packet = readFileSync(packetPath, "utf8");
    const hygieneReport = readFileSync(evidenceHygieneBlockerPath, "utf8");
    const templateFile =
      "2026-06-28-ppt-manual-playback-acceptance-record-template-production-live.json";

    expect(packet).toContain("Current evidence hygiene blocker");
    expect(packet).toContain(templateFile);
    expect(packet).toContain(
      "coordination/reports/2026-06-28-enterprise-live-evidence-hygiene-blocker.md",
    );
    expect(hygieneReport).toContain("# UAIS Enterprise Live Evidence Hygiene Blocker");
    expect(hygieneReport).toContain(templateFile);
    expect(hygieneReport).toContain("target-not-required");
    expect(hygieneReport).toContain("target-filename-mismatch");
    expect(hygieneReport).toContain("Do not delete or rename this file without owner/S22 cleanup authorization.");
    expect(hygieneReport).toContain("node scripts/enterprise-live-evidence-audit.mjs");
    expect(hygieneReport).toContain("node -- scripts/production-e2e-release-gate.mjs");
  });
});
