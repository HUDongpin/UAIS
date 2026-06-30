import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const extractConstStringArray = (source: string, name: string): string[] => {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));

  if (!match) {
    throw new Error(`Missing string array constant: ${name}`);
  }

  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, value]) => value);
};

describe("production E2E release orchestration plan", () => {
  it("prints a redacted dry-run plan for the production release proof chain", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-orchestrator-"));
    const envFile = join(tmpDir, "production.env");
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=https://uais-production.example.test",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=secret-production-storage-token",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "--",
      "scripts/production-e2e-orchestrator.mjs",
      "--dry-run",
      "--report-date",
      "2026-06-17",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "production-e2e-release-orchestrator",
        mode: "dry-run",
        environment: "production",
        network: "disabled",
        status: "planned",
        responsibleSession: "S22",
        reportDate: "2026-06-17",
        outputDir: "redacted",
        safety: {
          valuesRedacted: true,
          envFilePathOmitted: true,
          deploymentUrlOmitted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          liveRequiresReleaseRunId: true,
          vercelEnvApplyNotRunInDryRun: true,
          remoteMutationCommandsSeparated: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );
    expect(body.steps.map((step: { id: string }) => step.id)).toEqual([
      "s05-teacher-workflow-ui-smoke",
      "s22-vercel-project-readiness",
      "s19-vercel-env-sync-apply-evidence",
      "s19-vercel-env-inventory-observation",
      "s22-app-auth-provider-readiness",
      "s12-trusted-teacher-auth-route-chain-contract",
      "s22-external-storage-production-launch-contract",
      "s22-external-storage-container-build-readiness",
      "s22-external-storage-persistence",
      "s22-external-storage-service-readiness",
      "s22-vercel-production-deployment",
      "s22-deployment-domain-reachability",
      "s22-teacher-auth-issuer-route-smoke",
      "s22-teacher-auth-provider-readiness",
      "s22-deployed-teacher-workflow-page-smoke",
      "s22-deployed-teacher-workflow-browser-smoke",
      "s22-deployed-teacher-workflow-live-generation-smoke",
      "s22-deployed-learning-ppt-playback-smoke",
      "s22-protected-deployment-route-smoke",
      "s22-deployed-teaching-operations-route-smoke",
      "s22-deployed-teaching-operation-detail-browser-smoke",
      "s22-deployed-teaching-course-management-route-smoke",
      "s22-production-external-storage-smoke",
      "s24-manual-ppt-playback-acceptance",
      "s22-enterprise-live-evidence-audit",
      "s22-production-e2e-release-gate",
    ]);
    expect(body.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s05-teacher-workflow-ui-smoke",
          mutatesRemote: false,
          requiresOwnerApproval: false,
          evidence: "2026-06-17-teacher-workflow-ui-smoke-current.json",
          command:
            "node -- scripts/teacher-workflow-ui-smoke.mjs > <evidence>",
          proves: expect.arrayContaining([
            "voice-sample-upload-marker",
            "uploaded-audio-payload-marker",
            "signed-session-bootstrap-marker",
            "signed-session-readiness-marker",
            "server-workflow-status-marker",
            "feature-evidence-output-redacted",
          ]),
        }),
        expect.objectContaining({
          id: "s22-vercel-project-readiness",
          command:
            "node -- scripts/vercel-project-readiness.mjs --project-name <approved-project-name> --scope <approved-scope> > <evidence>",
          proves: expect.arrayContaining([
            "approved-or-detected-vercel-scope",
            "approved-project-candidate",
          ]),
        }),
      ]),
    );
    const deployedPageStep = body.steps.find(
      (step: { id: string }) =>
        step.id === "s22-deployed-teacher-workflow-page-smoke",
    );
    expect(deployedPageStep).toEqual(
      expect.objectContaining({
        proves: expect.arrayContaining([
          "voice-sample-select-marker",
          "uploaded-audio-payload-marker",
          "selected-sample-identity-marker",
          "signed-session-bootstrap-marker",
          "signed-session-readiness-marker",
          "protected-workflow-session-action-manifest",
          "server-workflow-status-marker",
        ]),
      }),
    );
    expect(body.evidenceFiles).toEqual(
      expect.objectContaining({
        teacherWorkflowUi: "2026-06-17-teacher-workflow-ui-smoke-current.json",
        vercelProjectReadiness: "2026-06-17-vercel-project-readiness.json",
        vercelEnvSync: "2026-06-17-vercel-env-sync-production-apply.json",
        vercelEnvInventory:
          "2026-06-17-vercel-env-inventory-production-observed.json",
        appAuthProviderReadiness:
          "2026-06-17-app-auth-provider-readiness-production-live.json",
        trustedTeacherAuthRouteChain:
          "2026-06-17-trusted-teacher-auth-route-chain-contract.json",
        teacherAuthIssuerRouteSmoke:
          "2026-06-17-teacher-auth-issuer-route-smoke-production-live.json",
        teacherAuthProviderReadiness:
          "2026-06-17-teacher-auth-provider-readiness-production-live.json",
        externalStorageProductionLauncher:
          "2026-06-17-external-storage-production-launch-contract.json",
        externalStorageContainerBuildReadiness:
          "2026-06-17-external-storage-container-build-readiness-approved-build-release-run-bound.json",
        externalStoragePersistence:
          "2026-06-17-external-storage-persistence-production-live.json",
        externalStorageServiceReadiness:
          "2026-06-17-external-storage-service-readiness-production-live.json",
        deploymentDomainReachability:
          "2026-06-17-deployment-domain-reachability-production-live.json",
        deployedTeacherWorkflowUi:
          "2026-06-17-teacher-workflow-deployment-smoke-production-live.json",
        learningPptPlayback:
          "2026-06-17-learning-ppt-playback-deployment-smoke-production-live.json",
        teacherWorkflowBrowserUi:
          "2026-06-17-teacher-workflow-browser-smoke-production-live.json",
        teacherWorkflowLiveGeneration:
          "2026-06-17-teacher-workflow-live-generation-smoke-production-live.json",
        routeSmoke: "2026-06-17-route-smoke-production-live.json",
        teachingOperationsRouteSmoke:
          "2026-06-17-teaching-operations-route-smoke-production-live.json",
        teachingOperationDetailBrowserSmoke:
          "2026-06-17-teaching-operation-detail-browser-smoke-production-live.json",
        teachingCourseManagementRouteSmoke:
          "2026-06-17-teaching-course-management-route-smoke-production-live.json",
        externalStorageSmoke: "2026-06-17-external-storage-smoke-production-live.json",
        pptAcceptance: "2026-06-17-ppt-manual-playback-acceptance-production-live.json",
        enterpriseLiveEvidenceAudit:
          "2026-06-17-enterprise-live-evidence-audit.json",
        localProductionE2eSmoke:
          "2026-06-17-local-production-e2e-smoke-enterprise-continuation.json",
        releaseGate: "2026-06-17-production-e2e-release-gate.json",
      }),
    );
    expect(body.ordinaryTeachingEvidenceBundle).toEqual(
      expect.objectContaining({
        id: "ordinary-teaching-production-evidence",
        status: "planned",
        ownerFacingDecision: "ordinary-teaching-production-evidence",
        sequencing:
          "external-storage-and-auth-readiness-before-live-ordinary-teaching-smokes",
        dependencies: [
          "vercelProductionDeployment",
          "deploymentDomainReachability",
          "teacherAuthProviderReadiness",
          "appAuthProviderReadiness",
          "externalStorageServiceReadiness",
        ],
        evidenceKeys: [
          "teachingOperationsRouteSmoke",
          "teachingOperationDetailBrowserSmoke",
          "teachingCourseManagementRouteSmoke",
        ],
        steps: [
          "s22-deployed-teaching-operations-route-smoke",
          "s22-deployed-teaching-operation-detail-browser-smoke",
          "s22-deployed-teaching-course-management-route-smoke",
        ],
        proofNeeded: expect.arrayContaining([
          "live-teaching-operations-route-smoke",
          "live-teaching-operation-detail-browser-smoke",
          "live-teaching-course-management-route-smoke",
          "ordinary-teaching-operation-clicks-use-live-operations-api",
          "ordinary-teaching-route-smoke-provider-backed-side-effects",
          "ordinary-teaching-audit-readback-rollback-alerts",
          "course-cover-and-course-management-external-backend-readback",
          "same-release-run-id-bound-to-ordinary-teaching-evidence",
          "same-vercel-production-deployment-bound-to-ordinary-teaching-smokes",
          "teacher-auth-provider-readiness-bound-to-ordinary-teaching-smokes",
          "external-storage-readiness-bound-to-ordinary-teaching-smokes",
        ]),
        releaseGateRequiredResults: {
          teachingOperationsRouteSmoke: expect.any(Array),
          teachingOperationDetailBrowserSmoke: expect.any(Array),
          teachingCourseManagementRouteSmoke: expect.any(Array),
        },
      }),
    );
    expect(
      body.ordinaryTeachingEvidenceBundle.releaseGateRequiredResults
        .teachingOperationsRouteSmoke,
    ).toContain("courseContentProviderPublishReturned");
    expect(
      body.ordinaryTeachingEvidenceBundle.releaseGateRequiredResults
        .teachingOperationsRouteSmoke,
    ).toContain("courseExportProviderReturned");
    expect(
      body.ordinaryTeachingEvidenceBundle.releaseGateRequiredResults
        .teachingOperationsRouteSmoke,
    ).toContain("gradingFeedbackProviderReturned");
    expect(body.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s19-vercel-env-sync-apply-evidence",
          mutatesRemote: true,
          requiresOwnerApproval: true,
          command:
            "node -- scripts/vercel-env-sync.mjs --apply --approved --project <approved-project> --env-file <env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <evidence>",
          proves: expect.arrayContaining([
            "app-auth-trusted-account-provider-bound",
            "redacted-env-apply-preflight",
            "redacted-env-apply-summary",
          ]),
        }),
        expect.objectContaining({
          id: "s19-vercel-env-inventory-observation",
          mutatesRemote: false,
          requiresOwnerApproval: true,
          evidence:
            "2026-06-17-vercel-env-inventory-production-observed.json",
          command:
            "node -- scripts/vercel-env-inventory.mjs --method rest --project-dir <vercel-project-dir> --release-run-id <release-run-id> > <evidence>",
          proves: expect.arrayContaining([
            "redacted-vercel-env-name-inventory",
            "required-production-and-preview-env-observed",
            "optional-external-storage-adapter-env-observed",
            "release-run-id-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-app-auth-provider-readiness",
          mutatesRemote: false,
          requiresOwnerApproval: true,
          evidence:
            "2026-06-17-app-auth-provider-readiness-production-live.json",
          command:
            "node -- scripts/app-auth-provider-readiness.mjs --live --approved --environment production --env-file <env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> > <evidence>",
          proves: expect.arrayContaining([
            "trusted-app-account-provider-selector",
            "app-session-cookie-pair-contract",
            "vercel-env-app-auth-provider-selector-bound",
            "app-auth-provider-token-strength-redacted",
            "release-run-id-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s12-trusted-teacher-auth-route-chain-contract",
          mutatesRemote: false,
          requiresOwnerApproval: false,
          evidence:
            "2026-06-17-trusted-teacher-auth-route-chain-contract.json",
          command:
            "node -- scripts/trusted-teacher-auth-route-chain-contract.mjs > <evidence>",
          proves: expect.arrayContaining([
            "trusted-cookie-issuer-route-chain",
            "issued-cookie-pair-to-scoped-ai-session",
            "ppt-narration-submit-scoped-session",
            "cookie-and-session-values-omitted",
          ]),
        }),
        expect.objectContaining({
          id: "s22-teacher-auth-issuer-route-smoke",
          mutatesRemote: false,
          requiresOwnerApproval: true,
          evidence:
            "2026-06-17-teacher-auth-issuer-route-smoke-production-live.json",
          command:
            "node -- scripts/ai-route-smoke.mjs --live --approved --environment production --teacher-auth-issuer-only --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> > <evidence>",
          proves: expect.arrayContaining([
            "deployed-teacher-auth-issuer-route",
            "issuer-cookie-hardening",
            "teacher-auth-issuer-response-shape",
            "matching-deployment-fingerprint",
            "release-run-id-bound",
            "vercel-production-deployment-fingerprint-bound",
            "same-deployment-domain-reachability-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-teacher-auth-provider-readiness",
          mutatesRemote: false,
          requiresOwnerApproval: true,
          evidence:
            "2026-06-17-teacher-auth-provider-readiness-production-live.json",
          command:
            "node -- scripts/teacher-auth-provider-readiness.mjs --live --approved --environment production --env-file <env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> --trusted-teacher-auth-route-chain <trusted-teacher-auth-route-chain-evidence> --route-smoke <teacher-auth-issuer-route-smoke-evidence> > <evidence>",
          proves: expect.arrayContaining([
            "local-trusted-route-chain-contract-present",
            "deployed-teacher-auth-issuer-route-smoke",
            "teacher-auth-provider-selector",
            "vercel-env-auth-provider-selector-bound",
            "teacher-auth-session-cookie-contract",
            "production-session-cookie-pair-contract",
            "trusted-issuer-or-oidc-provider-readiness",
            "secret-strength-redacted",
            "release-run-id-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-deployed-teaching-course-management-route-smoke",
          mutatesRemote: true,
          requiresOwnerApproval: true,
          evidence:
            "2026-06-17-teaching-course-management-route-smoke-production-live.json",
          command:
            "node -- scripts/teaching-course-management-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <evidence>",
          proves: expect.arrayContaining([
            "unauthenticated-course-list-denied",
            "unauthenticated-course-cover-denied",
            "unauthenticated-course-create-denied",
            "signed-student-course-create-denied",
            "signed-student-course-cover-denied",
            "signed-teacher-foreign-course-create-denied",
            "signed-other-teacher-course-cover-denied",
            "unauthenticated-class-create-denied",
            "signed-student-class-create-denied",
            "signed-other-teacher-class-create-denied",
            "course-cover-asset-generated",
            "course-cover-asset-readback-revision-returned",
            "course-cover-asset-readback-managed-database-adapter-returned",
            "course-cover-audit-auth-session-returned",
            "course-cover-asset-audit-external-readback-returned",
            "teacher-owned-course-created",
            "duplicate-course-create-denied",
            "course-create-external-snapshot-policy-returned",
            "course-create-audit-source-readback-returned",
            "course-create-auth-session-readback-returned",
            "created-course-used-cover-draft-scope",
            "existing-course-cover-binding-readback-returned",
            "existing-course-cover-listed-readback-returned",
            "existing-course-cover-asset-audit-external-readback-returned",
            "existing-course-cover-binding-audit-source-returned",
            "teacher-owned-class-created",
            "class-create-external-snapshot-policy-returned",
            "class-create-audit-source-readback-returned",
            "class-create-auth-session-readback-returned",
            "created-course-and-class-readable-after-write",
            "signed-other-teacher-course-list-returned",
            "other-teacher-course-hidden",
            "other-teacher-class-hidden",
            "student-course-hidden-before-membership",
            "unauthenticated-invite-join-denied",
            "student-invite-join-persisted",
            "duplicate-student-invite-join-idempotent-returned",
            "student-invite-join-audit-source-returned",
            "student-invite-join-auth-session-returned",
            "student-invite-join-auth-session-readback-returned",
            "external-ownership-merge-returned",
            "unauthenticated-membership-approval-denied",
            "signed-student-membership-approval-denied",
            "signed-other-teacher-membership-approval-denied",
            "signed-other-teacher-membership-approval-actor-resource-returned",
            "teacher-membership-approval-persisted",
            "duplicate-membership-approval-idempotent-returned",
            "teacher-membership-approval-audit-source-returned",
            "teacher-membership-approval-auth-session-returned",
            "teacher-membership-approval-auth-session-readback-returned",
            "unauthenticated-course-cover-trace-header-returned",
            "unauthenticated-course-create-trace-header-returned",
            "signed-student-course-create-trace-header-returned",
            "signed-student-course-cover-trace-header-returned",
            "signed-other-teacher-course-cover-trace-header-returned",
            "unauthenticated-class-create-trace-header-returned",
            "signed-student-class-create-trace-header-returned",
            "signed-other-teacher-class-create-trace-header-returned",
            "signed-other-teacher-course-list-trace-header-returned",
            "signed-student-prejoin-course-list-trace-header-returned",
            "unauthenticated-invite-join-trace-header-returned",
            "unauthenticated-membership-approval-trace-header-returned",
            "signed-student-membership-approval-trace-header-returned",
            "signed-other-teacher-membership-approval-trace-header-returned",
            "same-teacher-auth-provider-readiness-bound",
            "same-app-auth-provider-readiness-bound",
            "same-vercel-production-deployment-bound",
            "same-deployment-domain-reachability-bound",
            "same-external-storage-service-readiness-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-external-storage-production-launch-contract",
          mutatesRemote: false,
          requiresOwnerApproval: false,
          evidence:
            "2026-06-17-external-storage-production-launch-contract.json",
          command:
            "node -- scripts/external-storage-service-production-launcher.mjs --dry-run > <evidence>",
          proves: expect.arrayContaining([
            "env-only-secret-launch",
            "production-service-mode-forced",
            "persistent-data-dir-required",
            "container-runtime-artifact",
            "redacted-launch-contract",
          ]),
        }),
        expect.objectContaining({
          id: "s22-external-storage-container-build-readiness",
          mutatesRemote: false,
          requiresOwnerApproval: true,
          evidence:
            "2026-06-17-external-storage-container-build-readiness-approved-build-release-run-bound.json",
          command:
            "node -- scripts/external-storage-container-build-readiness.mjs --build --approved --image-tag <non-secret-image-tag> --release-run-id <release-run-id> > <evidence>",
          proves: expect.arrayContaining([
            "dockerfile-contract",
            "docker-context-secret-exclusion",
            "docker-daemon-availability-status",
            "approved-container-build-invoked",
            "docker-output-omitted",
            "container-image-tag-redacted",
            "release-run-id-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-external-storage-persistence",
          mutatesRemote: true,
          requiresOwnerApproval: true,
          evidence: "2026-06-17-external-storage-persistence-production-live.json",
          command:
            "node -- scripts/external-storage-persistence-smoke.mjs --live --approved --environment production --phase read --env-file <env-file> --teacher-id <redacted-smoke-teacher-id> --proof-id <redacted-persistence-proof-id> --release-run-id <release-run-id> > <evidence>",
          proves: expect.arrayContaining([
            "remote-https-storage-persistence-read-after-restart",
            "redacted-storage-service-fingerprint",
            "redacted-persistence-proof-fingerprint",
            "persisted-ownership-read",
            "persisted-lifecycle-audit-read",
            "release-run-id-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-external-storage-service-readiness",
          mutatesRemote: false,
          requiresOwnerApproval: true,
          evidence:
            "2026-06-17-external-storage-service-readiness-production-live.json",
          command:
            "node -- scripts/external-storage-service-readiness.mjs --live --approved --environment production --env-file <env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> --external-storage-production-launch-contract <external-storage-production-launch-contract-evidence> --external-storage-persistence <external-storage-persistence-evidence> > <evidence>",
          proves: expect.arrayContaining([
            "remote-https-storage-service-endpoint",
            "redacted-storage-service-fingerprint",
            "vercel-env-storage-service-fingerprint-bound",
            "production-launch-contract-bound",
            "storage-persistence-evidence-bound",
            "production-service-mode-health-target",
            "production-storage-service-identity",
            "durable-backing-store-readiness",
            "teaching-operations-schema-migration-health",
            "teaching-operations-managed-database-adapter-proof",
            "teaching-course-management-schema-migration-health",
            "teaching-course-management-managed-database-adapter-proof",
            "teaching-course-assets-schema-migration-health",
            "teaching-course-assets-managed-database-adapter-proof",
            "redacted-health-readiness",
            "release-run-id-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-vercel-production-deployment",
          mutatesRemote: true,
          requiresOwnerApproval: true,
          evidence: "2026-06-17-vercel-production-deployment.json",
          command:
            "node -- scripts/vercel-production-deployment-evidence.mjs --live --approved --deploy --environment production --env-file <env-file> --scope <approved-scope> --vercel-project-readiness <vercel-project-readiness-evidence> --vercel-env-sync <vercel-env-sync-evidence> --release-run-id <release-run-id> > <evidence>",
          proves: expect.arrayContaining([
            "production-deployment-created-or-inspected",
            "ready-project-readiness-guard",
            "applied-env-sync-guard",
            "env-sync-apply-summary-guard",
            "env-sync-apply-preflight-guard",
            "deployment-url-redacted",
            "deployment-fingerprint-source-for-smokes",
            "release-run-id-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-deployment-domain-reachability",
          mutatesRemote: false,
          requiresOwnerApproval: true,
          evidence: "2026-06-17-deployment-domain-reachability-production-live.json",
          command:
            "node -- scripts/deployment-reachability-diagnostics.mjs --live --approved --environment production --base-url <deployment-url> --release-run-id <release-run-id> --domain-reachability-evidence > <evidence>",
          proves: expect.arrayContaining([
            "custom-production-domain-reachable",
            "redacted-domain-origin",
            "redacted-domain-deployment-fingerprint",
            "route-smoke-domain-binding-evidence",
            "release-run-id-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-deployed-teacher-workflow-page-smoke",
          command:
            "node -- scripts/teacher-workflow-deployment-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <evidence>",
          proves: expect.arrayContaining([
            "release-run-id-bound",
            "vercel-production-deployment-fingerprint-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-deployed-learning-ppt-playback-smoke",
          command:
            "node -- scripts/learning-ppt-playback-deployment-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <evidence>",
          proves: expect.arrayContaining([
            "kang-xia-learning-playback-19-slides",
            "student-safe-playback-manifest",
            "first-slide-public-wav-response",
            "first-slide-wav-minimum-content-length",
            "matching-deployment-fingerprint",
            "release-run-id-bound",
            "vercel-production-deployment-fingerprint-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-deployed-teacher-workflow-browser-smoke",
          command:
            "node -- scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --api-mode live-workflow-status > <evidence>",
          proves: expect.arrayContaining([
            "real-protected-workflow-status-read",
            "fixture-blocked-workflow-mutations",
            "ppt-narration-slide-payload-contract",
            "protected-wav-download-href-contract",
            "release-run-id-bound",
            "vercel-production-deployment-fingerprint-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-deployed-teacher-workflow-live-generation-smoke",
          mutatesRemote: true,
          requiresOwnerApproval: true,
          command:
            "node -- scripts/teacher-workflow-live-generation-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <evidence>",
          proves: expect.arrayContaining([
            "live-provider-approved-workflow-mutations",
            "voice-clone-status-succeeded",
            "ppt-narration-submit-live-provider",
            "generated-audio-manifest",
            "generated-zip-export",
            "per-slide-audio-download",
            "response-bodies-omitted",
            "provider-task-ids-redacted",
            "release-run-id-bound",
            "vercel-production-deployment-fingerprint-bound",
            "same-teacher-auth-provider-readiness-bound",
            "same-external-storage-service-readiness-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-protected-deployment-route-smoke",
          command:
            "node -- scripts/ai-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> > <evidence>",
          proves: expect.arrayContaining([
            "teacher-ppt-workflow-response-shape",
            "teacher-ppt-workflow-download-contract",
            "signed-ai-contract-direct-call-denied",
            "signed-ai-download-direct-call-denied",
            "legacy-scoped-ai-direct-call-denied",
            "teacher-cookie-helper-direct-call-denied",
            "release-run-id-bound",
            "vercel-production-deployment-fingerprint-bound",
            "same-deployment-domain-reachability-bound",
            "teacher-auth-provider-readiness-selector-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-deployed-teaching-operations-route-smoke",
          mutatesRemote: true,
          requiresOwnerApproval: true,
          command:
            "node -- scripts/teaching-operations-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <evidence>",
          proves: expect.arrayContaining([
            "unauthenticated-post-denied",
            "signed-teacher-cookie-required",
            "signed-student-post-denied",
            "signed-teacher-course-scope-denied",
            "signed-teacher-course-scope-no-write-side-effects",
            "course-ownership-bound-operation-persisted",
            "durable-external-persistence-returned",
            "append-ledger-sequence-returned",
            "append-ledger-sequence-readback-returned",
            "audit-trace-returned",
            "audit-auth-session-returned",
            "signed-student-response-trace-header-returned",
            "unauthenticated-audit-readback-denied",
            "unauthenticated-audit-readback-trace-header-returned",
            "signed-student-audit-readback-denied",
            "signed-student-audit-readback-trace-header-returned",
            "unauthenticated-alert-notification-enqueue-denied",
            "unauthenticated-alert-notification-trace-header-returned",
            "signed-student-alert-notification-enqueue-denied",
            "signed-student-alert-notification-trace-header-returned",
            "unauthenticated-alert-notification-readback-denied",
            "unauthenticated-alert-notification-readback-trace-header-returned",
            "signed-student-alert-notification-readback-denied",
            "signed-student-alert-notification-readback-trace-header-returned",
            "audit-auth-session-readback-returned",
            "external-domain-projection-readback-returned",
            "course-settings-domain-object-returned",
            "student-preview-session-domain-object-returned",
            "student-preview-session-audit-source-returned",
            "student-roster-domain-object-returned",
            "student-roster-provider-sync-returned",
            "student-group-suggestion-domain-object-returned",
            "student-group-suggestion-audit-source-returned",
            "knowledge-index-domain-object-returned",
            "knowledge-index-provider-sync-returned",
            "resource-review-item-domain-object-returned",
            "resource-review-item-audit-source-returned",
            "course-content-domain-object-returned",
            "course-content-provider-publish-returned",
            "course-unit-draft-domain-object-returned",
            "course-unit-draft-audit-source-returned",
            "dashboard-state-domain-object-returned",
            "dashboard-state-audit-source-returned",
            "dashboard-snapshot-domain-object-returned",
            "dashboard-snapshot-audit-source-returned",
            "quiz-assessment-domain-object-returned",
            "quiz-item-review-domain-object-returned",
            "quiz-item-review-audit-source-returned",
            "agent-settings-domain-object-returned",
            "agent-settings-audit-source-returned",
            "agent-permission-preflight-domain-object-returned",
            "agent-permission-preflight-audit-source-returned",
            "admin-settings-domain-object-returned",
            "admin-settings-audit-source-returned",
            "collaboration-invite-notification-domain-object-returned",
            "collaboration-invite-email-delivery-returned",
            "collaboration-invite-email-delivery-audit-source-returned",
            "unauthenticated-collaboration-invite-email-callback-denied",
            "unauthenticated-collaboration-invite-email-callback-trace-header-returned",
            "unauthenticated-collaboration-invite-email-callback-no-write-side-effects",
            "signed-student-collaboration-invite-email-callback-denied",
            "signed-student-collaboration-invite-email-callback-trace-header-returned",
            "signed-student-collaboration-invite-email-callback-no-write-side-effects",
            "invalid-token-collaboration-invite-email-callback-denied",
            "invalid-token-collaboration-invite-email-callback-trace-header-returned",
            "invalid-token-collaboration-invite-email-callback-no-write-side-effects",
            "unsafe-collaboration-invite-email-callback-denied",
            "unsafe-collaboration-invite-email-callback-trace-header-returned",
            "unsafe-collaboration-invite-email-callback-no-write-side-effects",
            "collaboration-invite-email-bounce-callback-returned",
            "collaboration-invite-email-callback-audit-source-returned",
            "course-export-manifest-domain-object-returned",
            "course-export-provider-returned",
            "course-export-manifest-audit-source-returned",
            "unauthenticated-export-manifest-download-denied",
            "unauthenticated-export-manifest-download-trace-header-returned",
            "export-manifest-download-readback-returned",
            "export-redaction-validation-domain-object-returned",
            "export-redaction-validation-audit-source-returned",
            "grading-queue-domain-object-returned",
            "grading-feedback-draft-domain-object-returned",
            "grading-feedback-provider-returned",
            "idempotent-retry-returned",
            "idempotent-retry-append-sequence-stable-returned",
            "concurrent-idempotent-retry-append-sequence-stable-returned",
            "idempotency-conflict-denied",
            "unauthenticated-rollback-denied",
            "unauthenticated-rollback-trace-header-returned",
            "signed-student-rollback-denied",
            "signed-student-rollback-trace-header-returned",
            "signed-student-rollback-no-write-side-effects",
            "rollback-trace-closure-returned",
            "rollback-readback-returned",
            "rollback-readback-response-trace-header-returned",
            "unauthenticated-alert-summary-readback-denied",
            "unauthenticated-alert-summary-readback-trace-header-returned",
            "signed-student-alert-summary-readback-denied",
            "signed-student-alert-summary-readback-trace-header-returned",
            "alert-summary-readback-returned",
            "signed-student-alert-notification-no-write-side-effects",
            "alert-notification-queued-returned",
            "alert-notification-readback-returned",
            "invite-code-draft-domain-object-returned",
            "invite-code-draft-audit-source-returned",
            "invite-code-publish-audit-source-returned",
            "unauthenticated-gradebook-release-denied",
            "unauthenticated-gradebook-release-trace-header-returned",
            "unauthenticated-gradebook-rollback-denied",
            "unauthenticated-gradebook-rollback-trace-header-returned",
            "gradebook-release-trace-closure-returned",
            "gradebook-release-external-storage-returned",
            "gradebook-provider-release-returned",
            "gradebook-rollback-trace-closure-returned",
            "gradebook-rollback-external-storage-returned",
            "gradebook-provider-rollback-returned",
            "external-backup-created-returned",
            "unauthenticated-backup-restore-denied",
            "unauthenticated-backup-restore-trace-header-returned",
            "signed-student-backup-restore-denied",
            "signed-student-backup-restore-trace-header-returned",
            "signed-student-backup-restore-no-write-side-effects",
            "direct-backup-restore-disabled-returned",
            "direct-backup-restore-trace-closure-returned",
            "external-restore-drill-verified-returned",
            "response-values-redacted",
            "release-run-id-bound",
            "same-vercel-production-deployment-bound",
            "same-deployment-domain-reachability-bound",
            "same-teacher-auth-provider-readiness-bound",
            "same-app-auth-provider-readiness-bound",
            "same-external-storage-service-readiness-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-deployed-teaching-operation-detail-browser-smoke",
          mutatesRemote: true,
          requiresOwnerApproval: true,
          command:
            "node -- scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --api-mode live-teaching-operations > <evidence>",
          proves: expect.arrayContaining([
            "real-browser-operation-page-hydration",
            "signed-teacher-session-bootstrap",
            "operation-button-click-submits-to-backend",
            "live-teaching-operations-api-mutation",
            "operation-post-persisted",
            "audit-readback-verified",
            "domain-projection-verified",
            "trace-actor-session-visible",
            "duplicate-submit-blocked",
            "operation-failure-alert-verified",
            "main-course-create-button-click",
            "main-course-create-persisted",
            "main-course-create-readback-verified",
            "main-class-create-button-click",
            "main-class-create-persisted",
            "main-class-create-readback-verified",
            "main-inline-workspace-hydration",
            "main-inline-operation-button-click",
            "main-inline-duplicate-submit-blocked",
            "main-inline-course-settings-patch-submitted",
            "main-inline-operation-post-persisted",
            "main-inline-operation-failed-save-alert",
            "main-inline-audit-readback-verified",
            "main-inline-course-settings-card-audit-gated",
            "main-inline-domain-projection-verified",
            "main-inline-knowledge-index-sync-submitted",
            "main-inline-student-roster-sync-submitted",
            "main-inline-dashboard-refresh-submitted",
            "main-inline-student-preview-submitted",
            "main-inline-agent-permission-preflight-submitted",
            "main-inline-resource-placeholder-submitted",
            "main-inline-unit-draft-submitted",
            "main-inline-collaboration-invite-submitted",
            "main-inline-student-group-suggestion-submitted",
            "main-inline-export-redaction-validation-submitted",
            "main-inline-dashboard-snapshot-submitted",
            "main-inline-quiz-item-review-submitted",
            "main-inline-grading-feedback-draft-submitted",
            "main-inline-agent-plan-submitted",
            "main-inline-content-publish-submitted",
            "main-inline-admin-settings-submitted",
            "main-inline-export-manifest-submitted",
            "main-inline-quiz-board-refresh-submitted",
            "main-inline-grading-queue-submitted",
            "main-inline-audit-pending-before-success",
            "main-inline-alert-pending-before-success",
            "main-inline-audit-alert-readback-verified",
            "main-inline-alert-notification-button-click",
            "main-inline-alert-notification-readback-verified",
            "main-inline-rollback-button-click",
            "main-inline-rollback-persisted",
            "operation-detail-invite-artifact-audit-gated",
            "main-invite-workspace-hydration",
            "main-invite-generate-button-click",
            "main-invite-audit-pending-before-artifact",
            "main-invite-audit-readback-verified",
            "main-invite-draft-artifact-returned",
            "main-invite-publish-button-click",
            "main-invite-publish-audit-readback-verified",
            "main-invite-publish-artifact-returned",
            "main-invite-publish-class-readback-verified",
            "all-operation-detail-pages-opened",
            "all-operation-detail-primary-buttons-clicked",
            "all-operation-detail-primary-posts-persisted",
            "all-operation-detail-secondary-buttons-clicked",
            "all-operation-detail-secondary-posts-persisted",
            "response-values-redacted",
            "release-run-id-bound",
            "vercel-production-deployment-fingerprint-bound",
            "same-deployment-domain-reachability-bound",
            "teacher-auth-provider-readiness-bound",
            "app-auth-provider-readiness-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-production-external-storage-smoke",
          command:
            "node -- scripts/external-storage-smoke.mjs --live --approved --environment production --teacher-id <redacted-smoke-teacher-id> --env-file <env-file> --release-run-id <release-run-id> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <evidence>",
          proves: expect.arrayContaining([
            "managed-database-adapter-proof-shape",
            "redacted-storage-service-fingerprint",
            "course-management-backup-created",
            "course-management-restore-drill-verified",
            "course-assets-backup-created",
            "course-assets-restore-drill-verified",
            "teaching-operations-backup-created",
            "teaching-operations-restore-drill-verified",
            "ordinary-teaching-concurrent-append-readback",
            "ordinary-teaching-concurrent-append-sequence-distinct",
            "ordinary-teaching-concurrent-append-domain-projection-readback",
            "release-run-id-bound",
            "external-storage-service-readiness-fingerprint-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s24-manual-ppt-playback-acceptance",
          command:
            "node -- scripts/ppt-manual-playback-acceptance.mjs --package-json <kangxia-package-json> --preflight-report <desktop-preflight-report> --manual-record <manual-record> --vercel-production-deployment <vercel-production-deployment-evidence> > <evidence>",
          proves: expect.arrayContaining([
            "release-run-id-bound",
            "deployment-fingerprint-bound",
            "deployment-observation-bound",
            "vercel-production-deployment-evidence-bound",
          ]),
        }),
        expect.objectContaining({
          id: "s22-enterprise-live-evidence-audit",
          mutatesRemote: false,
          requiresOwnerApproval: false,
          evidence: "2026-06-17-enterprise-live-evidence-audit.json",
          command:
            "node -- scripts/enterprise-live-evidence-audit.mjs --reports-dir <reports-dir> --date <report-date> --output <evidence>",
          proves: expect.arrayContaining([
            "production-live-filenames-body-field-audited",
            "accepted-live-evidence-counted",
            "filename-only-or-blocked-evidence-counted",
            "shared-release-run-id-across-production-live-evidence",
            "all-orchestrated-production-live-targets-present",
            "required-production-live-safety-redaction-flags",
            "filename-only-production-live-evidence-rejected",
            "file-names-only-output",
            "response-bodies-omitted",
          ]),
        }),
        expect.objectContaining({
          id: "s22-production-e2e-release-gate",
          mutatesRemote: false,
          requiresOwnerApproval: false,
          command:
            "node -- scripts/production-e2e-release-gate.mjs --teacher-workflow-ui <teacher-workflow-ui-evidence> --deployed-teacher-workflow-ui <deployed-teacher-workflow-ui-evidence> --teacher-workflow-browser-ui <teacher-workflow-browser-ui-evidence> --teacher-workflow-live-generation <teacher-workflow-live-generation-evidence> --learning-ppt-playback <learning-ppt-playback-evidence> --vercel-project-readiness <vercel-project-readiness-evidence> --vercel-env-sync <vercel-env-sync-evidence> --vercel-env-inventory <vercel-env-inventory-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --trusted-teacher-auth-route-chain <trusted-teacher-auth-route-chain-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --external-storage-production-launch-contract <external-storage-production-launch-contract-evidence> --external-storage-container-build-readiness <external-storage-container-build-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --vercel-production-deployment <vercel-production-deployment-evidence> --route-smoke <route-smoke-evidence> --teaching-operations-route-smoke <teaching-operations-route-smoke-evidence> --teaching-operation-detail-browser-smoke <teaching-operation-detail-browser-smoke-evidence> --teaching-course-management-route-smoke <teaching-course-management-route-smoke-evidence> --external-storage-smoke <external-storage-smoke-evidence> --ppt-acceptance <ppt-acceptance-evidence> --enterprise-live-evidence-audit <enterprise-live-evidence-audit-evidence> --local-production-e2e-smoke <local-production-e2e-smoke-evidence> > <evidence>",
          proves: expect.arrayContaining([
            "teacher-workflow-live-provider-generation-proof",
            "learning-playback-deployment-fingerprint-match",
            "trusted-teacher-auth-route-chain-contract",
            "vercel-env-inventory-bound",
            "app-auth-trusted-account-provider-proof",
            "main-teaching-course-class-browser-proof",
            "ordinary-teaching-operation-detail-invite-artifact-audit-gate-proof",
            "ordinary-teaching-operation-detail-all-pages-primary-secondary-proof",
            "external-storage-production-launch-contract",
            "external-storage-container-build-readiness",
            "ordinary-teaching-managed-database-adapter-proof",
            "ordinary-teaching-course-backup-restore-drill-proof",
            "ordinary-teaching-student-roster-sis-provider-proof",
            "ordinary-teaching-knowledge-index-provider-proof",
            "ordinary-teaching-course-content-provider-proof",
            "ordinary-teaching-collaboration-invite-email-provider-proof",
            "ordinary-teaching-gradebook-provider-release-proof",
            "ordinary-teaching-course-export-provider-proof",
            "ordinary-teaching-grading-feedback-provider-proof",
            "storage-service-fingerprint-match",
            "body-level-production-live-evidence-audit-proof",
            "local-production-preflight-proof-not-production-acceptance",
          ]),
        }),
      ]),
    );
    const envFileCommands = body.steps
      .map((step: { command: string }) => step.command)
      .filter((command: string) => command.includes("--env-file"));
    expect(envFileCommands.length).toBeGreaterThan(0);
    expect(envFileCommands.every((command: string) => command.startsWith("node -- scripts/"))).toBe(
      true,
    );
    expect(output).not.toContain("--token");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("production.env");
    expect(output).not.toContain("uais-production.example.test");
    expect(output).not.toContain("secret-production-storage-token");
    expect(output).not.toContain("/Users/");
  });

  it("keeps exact route and browser proof summaries aligned with the production release gate", () => {
    const releaseGateSource = readFileSync(
      "scripts/production-e2e-release-gate.mjs",
      "utf8",
    );
    const output = execFileSync("node", [
      "--",
      "scripts/production-e2e-orchestrator.mjs",
      "--dry-run",
      "--report-date",
      "2026-06-17",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);
    const stepsById = new Map(
      body.steps.map((step: { id: string }) => [step.id, step]),
    );

    const expectedProofSummaries = [
      {
        stepId: "s22-deployed-teacher-workflow-browser-smoke",
        releaseGateConstant: "requiredTeacherWorkflowBrowserResults",
      },
      {
        stepId: "s22-deployed-teaching-operations-route-smoke",
        releaseGateConstant: "requiredTeachingOperationsRouteSmokeResults",
      },
      {
        stepId: "s22-deployed-teaching-operation-detail-browser-smoke",
        releaseGateConstant: "requiredTeachingOperationDetailBrowserResults",
      },
      {
        stepId: "s22-deployed-teaching-course-management-route-smoke",
        releaseGateConstant: "requiredTeachingCourseManagementRouteSmokeResults",
      },
    ];

    for (const { stepId, releaseGateConstant } of expectedProofSummaries) {
      const step = stepsById.get(stepId) as { releaseGateRequiredResults?: string[] };

      expect(step).toBeDefined();
      expect(step.releaseGateRequiredResults).toEqual(
        extractConstStringArray(releaseGateSource, releaseGateConstant),
      );
    }
  });

  it("keeps enterprise live audit targets aligned with orchestrated production-live evidence", () => {
    const auditSource = readFileSync(
      "scripts/enterprise-live-evidence-audit.mjs",
      "utf8",
    );
    const releaseGateSource = readFileSync(
      "scripts/production-e2e-release-gate.mjs",
      "utf8",
    );
    const output = execFileSync("node", [
      "--",
      "scripts/production-e2e-orchestrator.mjs",
      "--dry-run",
      "--report-date",
      "2026-06-17",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);
    const expectedProductionLiveEvidence = [
      ["appAuthProviderReadiness", "app-auth-provider-readiness"],
      ["teacherAuthIssuerRouteSmoke", "teacher-auth-issuer-route-smoke"],
      ["teacherAuthProviderReadiness", "teacher-auth-provider-readiness"],
      ["externalStoragePersistence", "external-storage-persistence"],
      ["externalStorageServiceReadiness", "external-storage-service-readiness"],
      ["deploymentDomainReachability", "deployment-domain-reachability"],
      ["deployedTeacherWorkflowUi", "teacher-workflow-deployment-smoke"],
      ["teacherWorkflowBrowserUi", "teacher-workflow-browser-smoke"],
      ["teacherWorkflowLiveGeneration", "teacher-workflow-live-generation-smoke"],
      ["learningPptPlayback", "learning-ppt-playback-deployment-smoke"],
      ["pptAcceptance", "ppt-manual-playback-acceptance"],
      ["routeSmoke", "deployment-route-smoke"],
      ["teachingOperationsRouteSmoke", "teaching-operations-route-smoke"],
      ["teachingOperationDetailBrowserSmoke", "teaching-operation-detail-browser-smoke"],
      ["teachingCourseManagementRouteSmoke", "teaching-course-management-route-smoke"],
      ["externalStorageSmoke", "external-storage-smoke"],
    ];
    const expectedTargets = expectedProductionLiveEvidence.map(([, target]) => target);

    for (const [key] of expectedProductionLiveEvidence) {
      expect(body.evidenceFiles[key]).toContain("production-live");
    }
    expect(body.evidenceFiles.vercelProductionDeployment).not.toContain("production-live");
    expect(extractConstStringArray(auditSource, "requiredEnterpriseLiveEvidenceTargets"))
      .toEqual(expectedTargets);
    expect(releaseGateSource).toContain("enterprise-live-evidence-audit.mjs");
    expect(releaseGateSource).toContain("requiredEnterpriseLiveEvidenceTargets");
  });

  it("rejects live production orchestration without explicit approval", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/production-e2e-orchestrator.mjs",
        "--live",
        "--report-date",
        "2026-06-17",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("explicit owner approval");
  });

  it("rejects approved live production orchestration without a release run id", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/production-e2e-orchestrator.mjs",
        "--live",
        "--approved",
        "--report-date",
        "2026-06-17",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("--release-run-id");
  });

  it("summarizes expected evidence file readiness without printing local paths", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-production-evidence-"));
    writeFileSync(
      join(tmpDir, "2026-06-17-vercel-project-readiness.json"),
      JSON.stringify({
        target: "vercel-project-readiness",
        mode: "local",
        status: "blocked",
        blockedReasons: ["vercel-project-not-linked"],
      }),
    );
    writeFileSync(
      join(tmpDir, "2026-06-17-production-e2e-release-gate.json"),
      JSON.stringify({
        target: "uais-production-e2e-release-gate",
        status: "blocked",
        blockedReasons: ["manual-ppt-playback-not-accepted"],
      }),
    );

    const output = execFileSync("node", [
      "scripts/production-e2e-orchestrator.mjs",
      "--dry-run",
      "--report-date",
      "2026-06-17",
      "--output-dir",
      tmpDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.evidenceReadiness).toEqual(
      expect.arrayContaining([
        {
          key: "vercelProjectReadiness",
          file: "2026-06-17-vercel-project-readiness.json",
          presence: "present",
          target: "vercel-project-readiness",
          evidenceStatus: "local-blocked",
          releaseStatus: "blocked",
          blockedReasons: ["vercel-project-not-linked"],
        },
        {
          key: "vercelEnvSync",
          file: "2026-06-17-vercel-env-sync-production-apply.json",
          presence: "missing",
          releaseStatus: "missing",
        },
        {
          key: "appAuthProviderReadiness",
          file: "2026-06-17-app-auth-provider-readiness-production-live.json",
          presence: "missing",
          releaseStatus: "missing",
        },
        {
          key: "trustedTeacherAuthRouteChain",
          file: "2026-06-17-trusted-teacher-auth-route-chain-contract.json",
          presence: "missing",
          releaseStatus: "missing",
        },
        {
          key: "teacherAuthProviderReadiness",
          file: "2026-06-17-teacher-auth-provider-readiness-production-live.json",
          presence: "missing",
          releaseStatus: "missing",
        },
        {
          key: "externalStorageServiceReadiness",
          file: "2026-06-17-external-storage-service-readiness-production-live.json",
          presence: "missing",
          releaseStatus: "missing",
        },
        {
          key: "externalStoragePersistence",
          file: "2026-06-17-external-storage-persistence-production-live.json",
          presence: "missing",
          releaseStatus: "missing",
        },
        {
          key: "releaseGate",
          file: "2026-06-17-production-e2e-release-gate.json",
          presence: "present",
          target: "uais-production-e2e-release-gate",
          evidenceStatus: "blocked",
          releaseStatus: "blocked",
          blockedReasons: ["manual-ppt-playback-not-accepted"],
        },
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});
