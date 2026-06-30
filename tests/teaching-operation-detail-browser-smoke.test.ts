import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("deployed teaching operation detail browser smoke", () => {
  it("returns redacted failure diagnostics for browser interaction failures", () => {
    const source = readFileSync("scripts/teaching-operation-detail-browser-smoke.mjs", "utf8");

    expect(source).toContain('let lastInteraction = "launch-browser";');
    expect(source).toContain('failureDiagnostics: {');
    expect(source).toContain("lastInteraction,");
    expect(source).toContain("uiState");
    expect(source).toContain("auditIncompleteVisible");
    expect(source).toContain("newCourseDialogVisible");
    expect(source).toContain("mainCourseCreateReadbackMismatchVisible");
    expect(source).toContain("liveTeachingOperationPostDiagnostics");
    expect(source).toContain("statusCode: response.status()");
    expect(source).toContain("?course=research-methods&action=course-settings");
    expect(source).toContain("?course=research-methods&action=invite-code");
    expect(source).toContain("?course=${encodeURIComponent(");
    expect(source).not.toContain("?courseId=research-methods");
    expect(source).toContain('message: "omitted"');
    expect(source).toContain('screenshots: "omitted"');
  });

  it("prints Node v24-safe help usage for env-file arguments", () => {
    const output = execFileSync("node", [
      "scripts/teaching-operation-detail-browser-smoke.mjs",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain(
      "Usage: node -- scripts/teaching-operation-detail-browser-smoke.mjs",
    );
    expect(output).not.toContain(
      "Usage: node scripts/teaching-operation-detail-browser-smoke.mjs",
    );
  });

  it("reports a redacted dry-run browser click plan for ordinary teaching operations", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-operation-browser-smoke-"));
    const envFile = join(tmpDir, "operation-browser.env");
    const baseUrl = "https://operation-browser.example.test";
    const releaseRunId = "release-operation-browser-dry-run";
    writeFileSync(envFile, `UAIS_DEPLOYMENT_BASE_URL=${baseUrl}\n`);
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const deploymentDomainReachability = writeDeploymentDomainReachabilityEvidenceForTest(
      tmpDir,
      {
        baseUrl,
        filename: "deployment-domain-reachability.json",
        releaseRunId,
      },
    );
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    const appAuthProviderReadiness = writeAppAuthProviderReadinessEvidenceForTest(tmpDir, {
      filename: "app-auth-provider-readiness.json",
      releaseRunId,
    });

    const output = execFileSync("node", [
      "scripts/teaching-operation-detail-browser-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--deployment-domain-reachability",
      deploymentDomainReachability,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--app-auth-provider-readiness",
      appAuthProviderReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teaching-operation-detail-browser-smoke",
        mode: "dry-run",
        environment: "production",
        network: "disabled",
        status: "ready",
        responsibleSession: "S22",
        route: "/teaching/course-settings",
        operationId: "course-settings",
        vercelProductionDeploymentEvidence: {
          target: "vercel-production-deployment",
          status: "matched",
          deploymentObservationStatus: "observed",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
        deploymentDomainReachabilityEvidence: {
          target: "deployment-domain-reachability",
          status: "matched",
          releaseRunIdStatus: "matched",
          deploymentFingerprintStatus: "matched",
          valueRedacted: true,
        },
        teacherAuthProviderReadinessEvidence: {
          target: "teacher-auth-provider-readiness",
          status: "matched",
          authProviderMode: "trusted-cookie-issuer",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
        appAuthProviderReadinessEvidence: {
          target: "app-auth-provider-readiness",
          status: "matched",
          appAuthProviderMode: "trusted-account-provider",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
        browserInteractions: [
          "open-operation-page",
          "hydrate-operation-page",
          "verify-signed-teacher-session-evidence",
          "click-primary-operation-button",
          "verify-operation-post-persisted",
          "click-secondary-operation-button",
          "verify-secondary-operation-post-persisted",
          "verify-audit-readback",
          "verify-domain-projection-readback",
          "verify-trace-actor-session-copy",
          "verify-duplicate-submit-blocked",
          "verify-operation-failed-save-alert",
          "open-invite-operation-page",
          "click-invite-operation-generate-code",
          "verify-invite-operation-audit-pending-before-artifact",
          "verify-invite-operation-audit-readback",
          "verify-invite-operation-artifact",
          "open-main-teaching-page",
          "hydrate-main-inline-workspace",
          "click-main-new-course-button",
          "click-main-new-course-cover-generate",
          "verify-main-new-course-cover-generated",
          "verify-main-new-course-cover-asset-audit-gated",
          "verify-main-new-course-cover-bound-to-create",
          "verify-main-new-course-submitted",
          "verify-main-new-course-readback",
          "click-main-new-class-button",
          "verify-main-new-class-submitted",
          "verify-main-new-class-readback",
          "click-main-inline-primary-button",
          "verify-main-inline-duplicate-submit-blocked",
          "verify-main-inline-course-settings-patch-submitted",
          "verify-main-inline-operation-post-persisted",
          "verify-main-inline-operation-failed-save-alert",
          "verify-main-inline-audit-pending-before-success",
            "verify-main-inline-course-settings-card-audit-gated",
            "verify-main-inline-audit-readback",
            "verify-main-inline-domain-projection-readback",
          "verify-main-inline-alert-pending-before-success",
          "click-main-inline-student-preview",
          "verify-main-inline-student-preview-submitted",
          "open-main-inline-knowledge-base-workspace",
          "click-main-inline-knowledge-index-sync",
          "verify-main-inline-knowledge-index-sync-submitted",
          "click-main-inline-resource-placeholder",
          "verify-main-inline-resource-placeholder-submitted",
          "open-main-inline-students-workspace",
          "click-main-inline-student-roster-sync",
          "verify-main-inline-student-roster-sync-submitted",
          "click-main-inline-student-group-suggestions",
          "verify-main-inline-student-group-suggestions-submitted",
          "open-main-inline-dashboard-workspace",
          "click-main-inline-dashboard-refresh",
          "verify-main-inline-dashboard-refresh-submitted",
          "click-main-inline-dashboard-snapshot",
          "verify-main-inline-dashboard-snapshot-submitted",
          "open-main-inline-agents-workspace",
          "click-main-inline-agent-plan-save",
          "verify-main-inline-agent-plan-submitted",
          "click-main-inline-agent-permission-preflight",
          "verify-main-inline-agent-permission-preflight-submitted",
          "open-main-inline-content-workspace",
          "click-main-inline-content-publish",
          "verify-main-inline-content-publish-submitted",
          "click-main-inline-unit-draft",
          "verify-main-inline-unit-draft-submitted",
          "open-main-inline-admins-workspace",
          "click-main-inline-admin-settings-save",
          "verify-main-inline-admin-settings-submitted",
          "click-main-inline-collaboration-invite",
          "verify-main-inline-collaboration-invite-submitted",
          "open-main-inline-data-export-workspace",
          "click-main-inline-export-manifest-create",
          "verify-main-inline-export-manifest-submitted",
          "click-main-inline-export-redaction-validation",
          "verify-main-inline-export-redaction-validation-submitted",
          "open-main-inline-quiz-board-workspace",
          "click-main-inline-quiz-board-refresh",
          "verify-main-inline-quiz-board-refresh-submitted",
          "click-main-inline-quiz-item-review",
          "verify-main-inline-quiz-item-review-submitted",
          "open-main-inline-grading-workspace",
          "click-main-inline-grading-queue-save",
          "verify-main-inline-grading-queue-submitted",
          "click-main-inline-grading-feedback-draft",
          "verify-main-inline-grading-feedback-draft-submitted",
          "verify-main-inline-audit-alert-readback",
          "click-main-inline-alert-notification-button",
          "verify-main-inline-alert-notification-readback",
          "click-main-inline-rollback-button",
          "verify-main-inline-rollback-persisted",
          "open-main-invite-code-workspace",
          "hydrate-main-invite-code-workspace",
          "click-main-invite-generate-code",
          "verify-main-invite-audit-pending-before-code-change",
          "verify-main-invite-audit-readback",
          "verify-main-invite-draft-artifact",
          "click-main-invite-publish-code",
          "verify-main-invite-publish-audit-readback",
          "verify-main-invite-publish-artifact",
          "verify-main-invite-publish-class-readback",
          "verify-all-operation-detail-pages-primary-secondary",
        ],
        apiInterceptionPolicy: {
          operationApi: "fixture-backed-contract",
          courseManagementApi: "fixture-backed-contract",
          auditReadback: "fixture-backed-contract",
          auditAlertReadback: "fixture-backed-contract",
          alertNotificationOutbox: "fixture-backed-contract",
          failureProbe: "browser-negative-response",
          remoteMutations: "fixture-blocked",
          responseBodiesOmitted: true,
        },
        detailOperationCoveragePlan: [
          {
            operationId: "course-settings",
            route: "/teaching/course-settings",
            primaryAction: "Save Course Settings",
            secondaryAction: "Preview Student View",
          },
          {
            operationId: "agents",
            route: "/teaching/agents",
            primaryAction: "Save Agent Plan",
            secondaryAction: "Run Permission Preflight",
          },
          {
            operationId: "knowledge-base",
            route: "/teaching/knowledge-base",
            primaryAction: "Sync Knowledge Index",
            secondaryAction: "Add Resource Placeholder",
          },
          {
            operationId: "content",
            route: "/teaching/content",
            primaryAction: "Publish Course Content",
            secondaryAction: "Generate Unit Draft",
          },
          {
            operationId: "admins",
            route: "/teaching/admins",
            primaryAction: "Save Admin Settings",
            secondaryAction: "Send Collaboration Invite",
          },
          {
            operationId: "students",
            route: "/teaching/students",
            primaryAction: "Sync Roster",
            secondaryAction: "Generate Group Suggestions",
          },
          {
            operationId: "data-export",
            route: "/teaching/data-export",
            primaryAction: "Create Export Manifest",
            secondaryAction: "Validate Redaction Scope",
          },
          {
            operationId: "dashboard",
            route: "/teaching/dashboard",
            primaryAction: "Refresh Dashboard",
            secondaryAction: "Lock Daily Snapshot",
          },
          {
            operationId: "quiz-board",
            route: "/teaching/quiz-board",
            primaryAction: "Refresh Quiz Board",
            secondaryAction: "Flag Low-quality Items",
          },
          {
            operationId: "grading",
            route: "/teaching/grading",
            primaryAction: "Save Review Queue",
            secondaryAction: "Generate AI Feedback",
          },
          {
            operationId: "invite-code",
            route: "/teaching/invite-code",
            primaryAction: "Generate New Invite Code",
            secondaryAction: "Publish Invite Code",
          },
        ],
        safety: {
          valuesRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          screenshotsOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-deployment-base-url",
          responsibleSession: "S22",
          requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
          status: "present",
        },
        {
          id: "s12-teacher-auth-provider-readiness",
          responsibleSession: "S12",
          requiredEvidence: "teacher-auth-provider-readiness",
          status: "matched",
          valueRedacted: true,
        },
        {
          id: "s22-browser-automation-runtime",
          responsibleSession: "S22",
          runtime: "playwright",
          status: "required-for-live",
        },
      ]),
    );
    expect(body.auth).toBe("requires-live-teacher-auth-cookie");
    expect(body.operationCoverage).toHaveLength(11);
    expect(body.operationCoverage[0]).toEqual({
      operationId: "course-settings",
      route: "/teaching/course-settings",
      primaryButtonClick: "pending",
      primaryPostPersisted: "pending",
      secondaryButtonClick: "pending",
      secondaryPostPersisted: "pending",
    });
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("plans live ordinary teaching API browser smoke with signed teacher auth prerequisites", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-operation-browser-live-api-"));
    const envFile = join(tmpDir, "operation-browser-live-api.env");
    const baseUrl = "https://operation-browser-live-api.example.test";
    const releaseRunId = "release-operation-browser-live-api";
    writeFileSync(
      envFile,
      [
        `UAIS_DEPLOYMENT_BASE_URL=${baseUrl}`,
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-ai-access-live-api-fixture",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-session-live-api-fixture",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-issuer-live-api-fixture",
      ].join("\n"),
    );
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const deploymentDomainReachability = writeDeploymentDomainReachabilityEvidenceForTest(
      tmpDir,
      {
        baseUrl,
        filename: "deployment-domain-reachability.json",
        releaseRunId,
      },
    );
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    const appAuthProviderReadiness = writeAppAuthProviderReadinessEvidenceForTest(tmpDir, {
      filename: "app-auth-provider-readiness.json",
      releaseRunId,
    });

    const output = execFileSync("node", [
      "scripts/teaching-operation-detail-browser-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--deployment-domain-reachability",
      deploymentDomainReachability,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--app-auth-provider-readiness",
      appAuthProviderReadiness,
      "--api-mode",
      "live-teaching-operations",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teaching-operation-detail-browser-smoke",
        mode: "dry-run",
        environment: "production",
        status: "ready",
        apiInterceptionPolicy: {
          operationApi: "live-teaching-operations",
          courseManagementApi: "live-teaching-course-management",
          auditReadback: "live-teaching-operations",
          auditAlertReadback: "live-teaching-operations",
          alertNotificationOutbox: "live-teaching-operations",
          failureProbe: "browser-negative-response",
          remoteMutations: "live-approved-teaching-operation",
          responseBodiesOmitted: true,
        },
      }),
    );
    expect(body.runtimeSetup.liveCommand).toContain(
      "--deployment-domain-reachability <deployment-domain-reachability-evidence>",
    );
    expect(body.runtimeSetup.liveCommand).toContain(
      "--app-auth-provider-readiness <app-auth-provider-readiness-evidence>",
    );
    expect(body.runtimeSetup.transientRuntimeCommand).toContain(
      "--deployment-domain-reachability <deployment-domain-reachability-evidence>",
    );
    expect(body.runtimeSetup.transientRuntimeCommand).toContain(
      "--app-auth-provider-readiness <app-auth-provider-readiness-evidence>",
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s12-teaching-operation-browser-auth-bootstrap",
          responsibleSession: "S12",
          requiredEnv: "UAIS_TEACHER_AUTH_PROVIDER",
          status: "present",
        },
        {
          id: "s19-teaching-operation-browser-ai-access-secret",
          responsibleSession: "S19",
          requiredEnv: "UAIS_AI_ACCESS_SIGNING_SECRET",
          status: "present",
        },
        {
          id: "s19-teaching-operation-browser-session-secret",
          responsibleSession: "S19",
          requiredEnv: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          status: "present",
        },
        {
          id: "s12-teaching-operation-browser-issuer-secret",
          responsibleSession: "S12",
          requiredEnv: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
          status: "present",
        },
      ]),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("secret-");
    expect(output).not.toContain("/Users/");
  });

  it("accepts production deployment evidence through deployment-domain reachability when fingerprints differ", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-operation-browser-domain-fallback-"));
    const envFile = join(tmpDir, "operation-browser-domain-fallback.env");
    const baseUrl = "https://operation-browser-custom-domain.example.test";
    const vercelDeploymentUrl = "https://operation-browser-vercel-deployment.example.test";
    const releaseRunId = "release-operation-browser-domain-fallback";
    writeFileSync(envFile, `UAIS_DEPLOYMENT_BASE_URL=${baseUrl}\n`);
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: vercelDeploymentUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const deploymentDomainReachability = writeDeploymentDomainReachabilityEvidenceForTest(
      tmpDir,
      {
        baseUrl,
        filename: "deployment-domain-reachability.json",
        releaseRunId,
      },
    );
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      {
        filename: "teacher-auth-provider-readiness.json",
        releaseRunId,
      },
    );
    const appAuthProviderReadiness = writeAppAuthProviderReadinessEvidenceForTest(tmpDir, {
      filename: "app-auth-provider-readiness.json",
      releaseRunId,
    });

    const output = execFileSync("node", [
      "scripts/teaching-operation-detail-browser-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--deployment-domain-reachability",
      deploymentDomainReachability,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--app-auth-provider-readiness",
      appAuthProviderReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teaching-operation-detail-browser-smoke",
        mode: "dry-run",
        environment: "production",
        status: "ready",
        vercelProductionDeploymentEvidence: {
          target: "vercel-production-deployment",
          status: "matched-via-domain-reachability",
          deploymentObservationStatus: "observed",
          releaseRunIdStatus: "matched",
          deploymentDomainReachabilityStatus: "matched",
          valueRedacted: true,
        },
        appAuthProviderReadinessEvidence: {
          target: "app-auth-provider-readiness",
          status: "matched",
          appAuthProviderMode: "trusted-account-provider",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
        deploymentDomainReachabilityEvidence: {
          target: "deployment-domain-reachability",
          status: "matched",
          releaseRunIdStatus: "matched",
          deploymentFingerprintStatus: "matched",
          valueRedacted: true,
        },
      }),
    );
    expect(body.blockedReasons).toEqual([]);
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(vercelDeploymentUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("continues live teaching operation API calls after issuing signed teacher auth cookies", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-operation-browser-live-api-runtime-"));
    const nodeModulesDir = join(tmpDir, "node_modules");
    const markerPath = join(tmpDir, "operation-api-marker.json");
    const envFile = join(tmpDir, "operation-browser-live-api.env");
    writeLiveTeachingOperationsPlaywrightRuntimeForTest({ nodeModulesDir, markerPath });

    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      if (request.url === "/api/ai/teacher-auth/issue" && request.method === "POST") {
        response.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": [
            "uais_teacher_auth_claims=redacted-claims; Path=/; HttpOnly",
            "uais_teacher_auth_signature=redacted-signature; Path=/; HttpOnly",
          ],
        });
        response.end(JSON.stringify({ status: "issued" }));
        return;
      }
      response.writeHead(404);
      response.end("not found");
    });
    const baseUrl = await listenForTest(server);
    writeFileSync(
      envFile,
      [
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-ai-access-live-runtime-fixture",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-session-live-runtime-fixture",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-issuer-live-runtime-fixture",
      ].join("\n"),
    );

    try {
      const output = await execFileForTest(
        "node",
        [
          "scripts/teaching-operation-detail-browser-smoke.mjs",
          "--live",
          "--approved",
          "--environment",
          "local-production",
          "--base-url",
          baseUrl,
          "--env-file",
          envFile,
          "--api-mode",
          "live-teaching-operations",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_PATH: nodeModulesDir,
          },
        },
      );
      const body = JSON.parse(output);
      const marker = JSON.parse(readFileSync(markerPath, "utf8"));

      expect(requests).toEqual(["POST /api/ai/teacher-auth/issue"]);
      expect(marker).toEqual(
        expect.objectContaining({
          cookiesAdded: true,
          operationApiContinued: false,
          operationApiFetched: true,
          auditReadbackContinued: true,
          auditAlertReadbackContinued: true,
          alertNotificationPostContinued: true,
          alertNotificationReadbackContinued: true,
          rollbackApiContinued: true,
          failureProbeFulfilled: true,
          mainInlineFailureProbeFulfilled: true,
          mainCourseCreateSubmitted: true,
          mainCourseCreateReceiptAuthSessionReturned: true,
          mainCourseCoverGenerated: true,
          mainCourseCreateBoundGeneratedCoverAsset: true,
          mainCourseCreateReadbackVerified: true,
          mainClassCreateSubmitted: true,
          mainClassCreateReceiptAuthSessionReturned: true,
          mainClassCreateReadbackVerified: true,
          mainInlineCourseSettingsPatchSubmitted: true,
          mainInlineOperationReceiptAuthSessionReturned: true,
          mainInlineKnowledgeIndexSyncSubmitted: true,
          mainInlineStudentRosterSyncSubmitted: true,
          mainInlineDashboardRefreshSubmitted: true,
          mainInlineStudentPreviewSubmitted: true,
          mainInlineAgentPermissionPreflightSubmitted: true,
          mainInlineResourcePlaceholderSubmitted: true,
          mainInlineUnitDraftSubmitted: true,
          mainInlineCollaborationInviteSubmitted: true,
          mainInlineStudentGroupSuggestionSubmitted: true,
          mainInlineExportRedactionValidationSubmitted: true,
          mainInlineDashboardSnapshotSubmitted: true,
          mainInlineQuizItemReviewSubmitted: true,
          mainInlineGradingFeedbackDraftSubmitted: true,
          mainInlineAgentPlanSubmitted: true,
          mainInlineContentPublishSubmitted: true,
          mainInlineAdminSettingsSubmitted: true,
          mainInlineExportManifestSubmitted: true,
          mainInlineQuizBoardRefreshSubmitted: true,
          mainInlineGradingQueueSubmitted: true,
          mainInviteDraftSubmitted: true,
          mainInvitePublishSubmitted: true,
          mainInvitePublishClassReadbackVerified: true,
          operationInviteDraftSubmitted: true,
          secondaryOperationSubmitted: true,
          operationApiContinueCount: 0,
          operationApiFetchCount: 44,
          auditReadbackContinueCount: 44,
          auditAlertReadbackContinueCount: 20,
          alertNotificationPostContinueCount: 1,
          alertNotificationReadbackContinueCount: 1,
          rollbackApiContinueCount: 1,
          operationApiFulfilled: true,
          auditReadbackFulfilled: false,
          auditAlertReadbackFulfilled: false,
          alertNotificationPostFulfilled: false,
          alertNotificationReadbackFulfilled: false,
          rollbackApiFulfilled: false,
        }),
      );
      expect(body).toEqual(
        expect.objectContaining({
          target: "teaching-operation-detail-browser-smoke",
          mode: "live",
          environment: "local-production",
          status: "passed",
          auth: "issued-teacher-auth-cookie",
          apiInterceptionPolicy: {
            operationApi: "live-teaching-operations",
            courseManagementApi: "live-teaching-course-management",
            auditReadback: "live-teaching-operations",
            auditAlertReadback: "live-teaching-operations",
            alertNotificationOutbox: "live-teaching-operations",
            failureProbe: "browser-negative-response",
            remoteMutations: "live-approved-teaching-operation",
            responseBodiesOmitted: true,
          },
          results: Object.fromEntries([
            "openOperationPage",
            "browserHydration",
            "signedTeacherSessionBootstrap",
            "operationButtonClick",
            "operationPostPersisted",
            "secondaryOperationButtonClick",
            "secondaryOperationPostPersisted",
            "auditReadbackVerified",
            "domainProjectionVerified",
            "traceVisible",
            "actorVisible",
            "authSessionVisible",
            "duplicateSubmitBlocked",
            "operationFailureAlertVerified",
            "operationInviteArtifactAuditGated",
            "openMainTeachingPage",
            "mainInlineWorkspaceHydration",
            "mainCourseCreateButtonClick",
            "mainCourseCoverGenerateButtonClick",
            "mainCourseCoverGenerated",
            "mainCourseCoverAssetAuditGated",
            "mainCourseCoverAssetBoundToCourseCreate",
            "mainCourseCreatePersisted",
            "mainCourseCreateReceiptAuthSessionReturned",
            "mainCourseCreateReadbackVerified",
            "mainClassCreateButtonClick",
            "mainClassCreatePersisted",
            "mainClassCreateReceiptAuthSessionReturned",
            "mainClassCreateReadbackVerified",
            "mainInlineOperationButtonClick",
            "mainInlineDuplicateSubmitBlocked",
            "mainInlineCourseSettingsPatchSubmitted",
            "mainInlineOperationPostPersisted",
            "mainInlineOperationReceiptAuthSessionReturned",
            "mainInlineOperationFailureAlertVerified",
            "mainInlineAuditPendingBeforeSuccess",
            "mainInlineCourseSettingsCardAuditGated",
            "mainInlineAuditReadbackVerified",
            "mainInlineDomainProjectionVerified",
            "mainInlineAlertPendingBeforeSuccess",
            "mainInlineKnowledgeIndexSyncSubmitted",
            "mainInlineStudentRosterSyncSubmitted",
            "mainInlineDashboardRefreshSubmitted",
            "mainInlineStudentPreviewSubmitted",
            "mainInlineAgentPermissionPreflightSubmitted",
            "mainInlineResourcePlaceholderSubmitted",
            "mainInlineUnitDraftSubmitted",
            "mainInlineCollaborationInviteSubmitted",
            "mainInlineStudentGroupSuggestionSubmitted",
            "mainInlineExportRedactionValidationSubmitted",
            "mainInlineDashboardSnapshotSubmitted",
            "mainInlineQuizItemReviewSubmitted",
            "mainInlineGradingFeedbackDraftSubmitted",
            "mainInlineAgentPlanSubmitted",
            "mainInlineContentPublishSubmitted",
            "mainInlineAdminSettingsSubmitted",
            "mainInlineExportManifestSubmitted",
            "mainInlineQuizBoardRefreshSubmitted",
            "mainInlineGradingQueueSubmitted",
            "mainInlineAuditAlertReadbackVerified",
            "mainInlineAlertNotificationButtonClick",
            "mainInlineAlertNotificationReadbackVerified",
            "mainInlineRollbackButtonClick",
            "mainInlineRollbackPersisted",
            "mainInviteWorkspaceHydration",
            "mainInviteGenerateButtonClick",
            "mainInviteAuditPendingBeforeArtifact",
            "mainInviteAuditReadbackVerified",
            "mainInviteDraftArtifactReturned",
            "mainInvitePublishButtonClick",
            "mainInvitePublishAuditReadbackVerified",
            "mainInvitePublishArtifactReturned",
            "mainInvitePublishClassReadbackVerified",
            "operationDetailCoverageVerified",
          ].map((key) => [key, "passed"])),
          detailOperationCoverage: [
            "course-settings",
            "agents",
            "knowledge-base",
            "content",
            "admins",
            "students",
            "data-export",
            "dashboard",
            "quiz-board",
            "grading",
            "invite-code",
          ].map((operationId) => ({
            operationId,
            route: `/teaching/${operationId}`,
            primaryButtonClick: "passed",
            primaryPostPersisted: "passed",
            secondaryButtonClick: "passed",
            secondaryPostPersisted: "passed",
          })),
        }),
      );
      expect(output).not.toContain(baseUrl);
      expect(output).not.toContain(tmpDir);
      expect(output).not.toContain("secret-");
      expect(output).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("ties production release eligibility to live ordinary teaching API proof", () => {
    const source = readFileSync(
      "scripts/teaching-operation-detail-browser-smoke.mjs",
      "utf8",
    );
    const createLiveEvidence = source.slice(
      source.indexOf("function createLiveEvidence"),
      source.indexOf("function buildPlan"),
    );

    expect(createLiveEvidence).toContain("const liveTeachingOperationsApiProved");
    expect(createLiveEvidence).toContain(
      'plan.apiInterceptionPolicy.operationApi === "live-teaching-operations"',
    );
    expect(createLiveEvidence).toContain(
      'plan.apiInterceptionPolicy.courseManagementApi === "live-teaching-course-management"',
    );
    expect(createLiveEvidence).toContain(
      'plan.apiInterceptionPolicy.remoteMutations === "live-approved-teaching-operation"',
    );
    expect(createLiveEvidence).toContain("liveTeachingOperationsApiBindingStatus");
    expect(createLiveEvidence).toContain("liveTeachingOperationsApiProved,");
    expect(createLiveEvidence.indexOf("liveTeachingOperationsApiProved")).toBeLessThan(
      createLiveEvidence.lastIndexOf("productionReleaseEligible"),
    );
  });

  it("requires Vercel production deployment evidence for production browser smoke plans", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-operation-browser-missing-vercel-"));
    const envFile = join(tmpDir, "operation-browser-missing-vercel.env");
    writeFileSync(envFile, "UAIS_DEPLOYMENT_BASE_URL=https://operation-browser.example.test\n");

    const output = execFileSync("node", [
      "scripts/teaching-operation-detail-browser-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      "release-operation-browser-missing-vercel",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teaching-operation-detail-browser-smoke",
        mode: "dry-run",
        environment: "production",
        status: "blocked",
        blockedReasons: [
          "vercel-production-deployment-evidence-missing",
          "deployment-domain-reachability-evidence-missing",
          "teacher-auth-provider-readiness-evidence-missing",
          "app-auth-provider-readiness-evidence-missing",
        ],
        vercelProductionDeploymentEvidence: {
          target: "missing",
          status: "missing",
          deploymentObservationStatus: "missing",
          valueRedacted: true,
        },
        teacherAuthProviderReadinessEvidence: {
          target: "missing",
          status: "missing",
          authProviderMode: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
        appAuthProviderReadinessEvidence: {
          target: "missing",
          status: "missing",
          appAuthProviderMode: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
      }),
    );
    expect(output).not.toContain("operation-browser.example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects live operation browser smoke without explicit owner approval", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/teaching-operation-detail-browser-smoke.mjs",
        "--live",
        "--environment",
        "production",
        "--base-url",
        "https://operation-browser.example.test",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("explicit owner approval");
  });
});

function writeVercelDeploymentEvidenceForTest(
  tmpDir: string,
  input: {
    baseUrl: string;
    filename: string;
    releaseRunId: string;
  },
) {
  const evidencePath = join(tmpDir, input.filename);
  writeFileSync(
    evidencePath,
    JSON.stringify({
      target: "vercel-production-deployment",
      mode: "live",
      status: "deployed",
      releaseRunId: input.releaseRunId,
      deploymentObservation: {
        status: "observed",
      },
      deploymentFingerprint: createDeploymentFingerprintForTest(input.baseUrl),
    }),
  );
  return evidencePath;
}

function writeDeploymentDomainReachabilityEvidenceForTest(
  tmpDir: string,
  input: {
    baseUrl: string;
    filename: string;
    releaseRunId: string;
  },
) {
  const evidencePath = join(tmpDir, input.filename);
  writeFileSync(
    evidencePath,
    JSON.stringify({
      target: "deployment-domain-reachability",
      mode: "live",
      environment: "production",
      status: "reachable",
      releaseRunId: input.releaseRunId,
      deploymentFingerprint: createDeploymentFingerprintForTest(input.baseUrl),
      deploymentUrlRedacted: true,
    }),
  );
  return evidencePath;
}

function writeTeacherAuthProviderReadinessEvidenceForTest(
  tmpDir: string,
  input: {
    filename: string;
    releaseRunId: string;
  },
) {
  const evidencePath = join(tmpDir, input.filename);
  writeFileSync(
    evidencePath,
    JSON.stringify({
      target: "teacher-auth-provider-readiness",
      mode: "live",
      environment: "production",
      status: "ready",
      releaseRunId: input.releaseRunId,
      authProviderMode: "trusted-cookie-issuer",
    }),
  );
  return evidencePath;
}

function writeAppAuthProviderReadinessEvidenceForTest(
  tmpDir: string,
  input: {
    filename: string;
    releaseRunId: string;
  },
) {
  const evidencePath = join(tmpDir, input.filename);
  writeFileSync(
    evidencePath,
    JSON.stringify({
      target: "app-auth-provider-readiness",
      mode: "live",
      environment: "production",
      status: "ready",
      releaseRunId: input.releaseRunId,
      appAuthProviderMode: "trusted-account-provider",
    }),
  );
  return evidencePath;
}

function createDeploymentFingerprintForTest(baseUrl: string) {
  return {
    status: "present",
    value: `sha256:${createHash("sha256")
      .update(baseUrl.replace(/\/+$/, ""))
      .digest("hex")
      .slice(0, 16)}`,
  };
}

function writeLiveTeachingOperationsPlaywrightRuntimeForTest(input: {
  nodeModulesDir: string;
  markerPath: string;
}) {
  const playwrightDir = join(input.nodeModulesDir, "playwright");
  mkdirSync(playwrightDir, { recursive: true });
  writeFileSync(
    join(playwrightDir, "package.json"),
    JSON.stringify({ name: "playwright", version: "0.0.0-smoke", main: "index.js" }),
  );
  writeFileSync(
    join(playwrightDir, "index.js"),
`
const fs = require("fs");
const markerPath = ${JSON.stringify(input.markerPath)};
const marker = {
  cookiesAdded: false,
  operationApiContinued: false,
  auditReadbackContinued: false,
  auditAlertReadbackContinued: false,
  alertNotificationPostContinued: false,
  alertNotificationReadbackContinued: false,
  rollbackApiContinued: false,
  failureProbeFulfilled: false,
  mainInlineFailureProbeFulfilled: false,
  mainInlineCourseSettingsPatchSubmitted: false,
  mainInlineKnowledgeIndexSyncSubmitted: false,
  mainInlineStudentRosterSyncSubmitted: false,
  mainInlineDashboardRefreshSubmitted: false,
  mainInlineStudentPreviewSubmitted: false,
  mainInlineAgentPermissionPreflightSubmitted: false,
  mainInlineResourcePlaceholderSubmitted: false,
  mainInlineUnitDraftSubmitted: false,
  mainInlineCollaborationInviteSubmitted: false,
  mainInlineStudentGroupSuggestionSubmitted: false,
  mainInlineExportRedactionValidationSubmitted: false,
  mainInlineDashboardSnapshotSubmitted: false,
  mainInlineQuizItemReviewSubmitted: false,
  mainInlineGradingFeedbackDraftSubmitted: false,
  mainInlineAgentPlanSubmitted: false,
  mainInlineContentPublishSubmitted: false,
  mainInlineAdminSettingsSubmitted: false,
  mainInlineExportManifestSubmitted: false,
  mainInlineQuizBoardRefreshSubmitted: false,
  mainInlineGradingQueueSubmitted: false,
  mainInlineOperationReceiptAuthSessionReturned: false,
  mainCourseCreateReceiptAuthSessionReturned: false,
  mainClassCreateReceiptAuthSessionReturned: false,
  mainInviteDraftSubmitted: false,
  mainInvitePublishSubmitted: false,
  mainInvitePublishClassReadbackVerified: false,
  operationInviteDraftSubmitted: false,
  secondaryOperationSubmitted: false,
  operationApiContinueCount: 0,
  auditReadbackContinueCount: 0,
  auditAlertReadbackContinueCount: 0,
  alertNotificationPostContinueCount: 0,
  alertNotificationReadbackContinueCount: 0,
  rollbackApiContinueCount: 0,
  operationApiFulfilled: false,
  auditReadbackFulfilled: false,
  auditAlertReadbackFulfilled: false,
  alertNotificationPostFulfilled: false,
  alertNotificationReadbackFulfilled: false,
  rollbackApiFulfilled: false,
};
let apiHandler;

function writeMarker() {
  fs.writeFileSync(markerPath, JSON.stringify(marker));
}

function createRouteRequest(pathname, method, body) {
  return {
    request: () => ({
      url: () => "http://127.0.0.1" + pathname,
      method: () => method,
      postDataJSON: () => body,
      postData: () => body ? JSON.stringify(body) : undefined,
    }),
    continue: async () => {
      if (pathname === "/api/teaching/operations") {
        marker.operationApiContinued = true;
        marker.operationApiContinueCount += 1;
        if (body && body.courseSettingsPatch) {
          marker.mainInlineCourseSettingsPatchSubmitted = true;
        }
        if (
          body &&
          body.operationId === "course-settings" &&
          body.actionSlot === "secondary" &&
          currentSurface === "operation-detail"
        ) {
          marker.secondaryOperationSubmitted = true;
        }
        if (
          body &&
          body.operationId === "course-settings" &&
          body.actionSlot === "secondary" &&
          currentSurface === "main-teaching"
        ) {
          marker.mainInlineStudentPreviewSubmitted = true;
        }
        if (body && body.operationId === "agents" && body.actionSlot === "secondary") {
          marker.mainInlineAgentPermissionPreflightSubmitted = true;
        }
        if (body && body.operationId === "knowledge-base" && body.actionSlot === "secondary") {
          marker.mainInlineResourcePlaceholderSubmitted = true;
        }
        if (body && body.operationId === "content" && body.actionSlot === "secondary") {
          marker.mainInlineUnitDraftSubmitted = true;
        }
        if (body && body.operationId === "admins" && body.actionSlot === "secondary") {
          marker.mainInlineCollaborationInviteSubmitted = true;
        }
        if (body && body.operationId === "students" && body.actionSlot === "secondary") {
          marker.mainInlineStudentGroupSuggestionSubmitted = true;
        }
        if (body && body.operationId === "data-export" && body.actionSlot === "secondary") {
          marker.mainInlineExportRedactionValidationSubmitted = true;
        }
        if (body && body.operationId === "dashboard" && body.actionSlot === "secondary") {
          marker.mainInlineDashboardSnapshotSubmitted = true;
        }
        if (body && body.operationId === "quiz-board" && body.actionSlot === "secondary") {
          marker.mainInlineQuizItemReviewSubmitted = true;
        }
        if (body && body.operationId === "grading" && body.actionSlot === "secondary") {
          marker.mainInlineGradingFeedbackDraftSubmitted = true;
        }
        if (
          body &&
          body.operationId === "knowledge-base" &&
          body.actionSlot === "primary"
        ) {
          marker.mainInlineKnowledgeIndexSyncSubmitted = true;
        }
        if (body && body.operationId === "students" && body.actionSlot === "primary") {
          marker.mainInlineStudentRosterSyncSubmitted = true;
        }
        if (body && body.operationId === "dashboard" && body.actionSlot === "primary") {
          marker.mainInlineDashboardRefreshSubmitted = true;
        }
        if (body && body.operationId === "agents" && body.actionSlot === "primary") {
          marker.mainInlineAgentPlanSubmitted = true;
        }
        if (body && body.operationId === "content" && body.actionSlot === "primary") {
          marker.mainInlineContentPublishSubmitted = true;
        }
        if (body && body.operationId === "admins" && body.actionSlot === "primary") {
          marker.mainInlineAdminSettingsSubmitted = true;
        }
        if (body && body.operationId === "data-export" && body.actionSlot === "primary") {
          marker.mainInlineExportManifestSubmitted = true;
        }
        if (body && body.operationId === "quiz-board" && body.actionSlot === "primary") {
          marker.mainInlineQuizBoardRefreshSubmitted = true;
        }
        if (body && body.operationId === "grading" && body.actionSlot === "primary") {
          marker.mainInlineGradingQueueSubmitted = true;
        }
        if (
          body &&
          body.operationId === "invite-code" &&
          body.actionSlot === "primary" &&
          currentSurface === "operation-detail"
        ) {
          marker.operationInviteDraftSubmitted = true;
        }
        if (
          body &&
          body.operationId === "invite-code" &&
          body.actionSlot === "primary" &&
          currentSurface === "main-teaching"
        ) {
          marker.mainInviteDraftSubmitted = true;
        }
        if (body && body.operationId === "invite-code" && body.actionSlot === "secondary") {
          marker.mainInvitePublishSubmitted = true;
        }
        if (
          body &&
          body.operationId === "course-settings" &&
          body.actionSlot === "primary" &&
          currentSurface === "main-teaching"
        ) {
          marker.mainInlineOperationReceiptAuthSessionReturned = true;
        }
        emitRouteResponse(pathname, method, createTeachingOperationResponse(body));
      }
      if (pathname === "/api/teaching/operations/audit") {
        marker.auditReadbackContinued = true;
        marker.auditReadbackContinueCount += 1;
      }
      if (pathname === "/api/teaching/operations/audit/alerts") {
        marker.auditAlertReadbackContinued = true;
        marker.auditAlertReadbackContinueCount += 1;
      }
      if (
        pathname === "/api/teaching/operations/audit/alerts/notifications" &&
        method === "POST"
      ) {
        marker.alertNotificationPostContinued = true;
        marker.alertNotificationPostContinueCount += 1;
      }
      if (
        pathname === "/api/teaching/operations/audit/alerts/notifications" &&
        method === "GET"
      ) {
        marker.alertNotificationReadbackContinued = true;
        marker.alertNotificationReadbackContinueCount += 1;
      }
      if (pathname.includes("/api/teaching/operations/records/")) {
        marker.rollbackApiContinued = true;
        marker.rollbackApiContinueCount += 1;
      }
      if (pathname === "/api/teaching/course-cover" && method === "POST") {
        marker.mainCourseCoverGenerated = true;
        emitRouteResponse(pathname, method, createCourseCoverResponse(body));
      }
      if (pathname === "/api/teaching/courses" && method === "POST") {
        marker.mainCourseCreateSubmitted = true;
        if (body && body.coverAssetId) {
          marker.mainCourseCreateBoundGeneratedCoverAsset = true;
        }
      }
      if (
        pathname === "/api/teaching/courses" &&
        method === "GET" &&
        marker.mainCourseCreateSubmitted
      ) {
        marker.mainCourseCreateReadbackVerified = true;
      }
      if (
        pathname === "/api/teaching/courses/teacher-course-main-browser-smoke/classes" &&
        method === "POST"
      ) {
        marker.mainClassCreateSubmitted = true;
      }
      if (
        pathname === "/api/teaching/courses" &&
        method === "GET" &&
        marker.mainClassCreateSubmitted
      ) {
        marker.mainClassCreateReadbackVerified = true;
      }
      if (
        pathname === "/api/teaching/courses" &&
        method === "GET" &&
        marker.mainInvitePublishSubmitted
      ) {
        marker.mainInvitePublishClassReadbackVerified = true;
      }
      writeMarker();
    },
    fallback: async () => undefined,
    fetch: async () => {
      if (pathname === "/api/teaching/operations") {
        marker.operationApiFetched = true;
        marker.operationApiFetchCount = (marker.operationApiFetchCount || 0) + 1;
        if (body && body.courseSettingsPatch) {
          marker.mainInlineCourseSettingsPatchSubmitted = true;
        }
        if (
          body &&
          body.operationId === "course-settings" &&
          body.actionSlot === "secondary" &&
          currentSurface === "operation-detail"
        ) {
          marker.secondaryOperationSubmitted = true;
        }
        if (
          body &&
          body.operationId === "course-settings" &&
          body.actionSlot === "secondary" &&
          currentSurface === "main-teaching"
        ) {
          marker.mainInlineStudentPreviewSubmitted = true;
        }
        if (body && body.operationId === "agents" && body.actionSlot === "secondary") {
          marker.mainInlineAgentPermissionPreflightSubmitted = true;
        }
        if (body && body.operationId === "knowledge-base" && body.actionSlot === "secondary") {
          marker.mainInlineResourcePlaceholderSubmitted = true;
        }
        if (body && body.operationId === "content" && body.actionSlot === "secondary") {
          marker.mainInlineUnitDraftSubmitted = true;
        }
        if (body && body.operationId === "admins" && body.actionSlot === "secondary") {
          marker.mainInlineCollaborationInviteSubmitted = true;
        }
        if (body && body.operationId === "students" && body.actionSlot === "secondary") {
          marker.mainInlineStudentGroupSuggestionSubmitted = true;
        }
        if (body && body.operationId === "data-export" && body.actionSlot === "secondary") {
          marker.mainInlineExportRedactionValidationSubmitted = true;
        }
        if (body && body.operationId === "dashboard" && body.actionSlot === "secondary") {
          marker.mainInlineDashboardSnapshotSubmitted = true;
        }
        if (body && body.operationId === "quiz-board" && body.actionSlot === "secondary") {
          marker.mainInlineQuizItemReviewSubmitted = true;
        }
        if (body && body.operationId === "grading" && body.actionSlot === "secondary") {
          marker.mainInlineGradingFeedbackDraftSubmitted = true;
        }
        if (body && body.operationId === "knowledge-base" && body.actionSlot === "primary") {
          marker.mainInlineKnowledgeIndexSyncSubmitted = true;
        }
        if (body && body.operationId === "students" && body.actionSlot === "primary") {
          marker.mainInlineStudentRosterSyncSubmitted = true;
        }
        if (body && body.operationId === "dashboard" && body.actionSlot === "primary") {
          marker.mainInlineDashboardRefreshSubmitted = true;
        }
        if (body && body.operationId === "agents" && body.actionSlot === "primary") {
          marker.mainInlineAgentPlanSubmitted = true;
        }
        if (body && body.operationId === "content" && body.actionSlot === "primary") {
          marker.mainInlineContentPublishSubmitted = true;
        }
        if (body && body.operationId === "admins" && body.actionSlot === "primary") {
          marker.mainInlineAdminSettingsSubmitted = true;
        }
        if (body && body.operationId === "data-export" && body.actionSlot === "primary") {
          marker.mainInlineExportManifestSubmitted = true;
        }
        if (body && body.operationId === "quiz-board" && body.actionSlot === "primary") {
          marker.mainInlineQuizBoardRefreshSubmitted = true;
        }
        if (body && body.operationId === "grading" && body.actionSlot === "primary") {
          marker.mainInlineGradingQueueSubmitted = true;
        }
        if (
          body &&
          body.operationId === "course-settings" &&
          body.actionSlot === "primary" &&
          currentSurface === "main-teaching"
        ) {
          marker.mainInlineOperationReceiptAuthSessionReturned = true;
        }
        if (
          body &&
          body.operationId === "invite-code" &&
          body.actionSlot === "primary" &&
          currentSurface === "operation-detail"
        ) {
          marker.operationInviteDraftSubmitted = true;
        }
        if (
          body &&
          body.operationId === "invite-code" &&
          body.actionSlot === "primary" &&
          currentSurface === "main-teaching"
        ) {
          marker.mainInviteDraftSubmitted = true;
        }
        const responseBody = createTeachingOperationResponse(body);
        if (
          body &&
          body.operationId === "invite-code" &&
          body.actionSlot === "secondary"
        ) {
          marker.mainInvitePublishSubmitted = true;
        }
        writeMarker();
        return {
          status: () => 200,
          json: async () => responseBody,
        };
      }
      if (pathname === "/api/teaching/courses" && method === "POST") {
        marker.mainCourseCreateSubmitted = true;
        if (body && body.coverAssetId) {
          marker.mainCourseCreateBoundGeneratedCoverAsset = true;
        }
        marker.mainCourseCreateReceiptAuthSessionReturned = true;
        writeMarker();
        return {
          status: () => 200,
          json: async () => ({
            receipt: {
              authSession: {
                sessionId: "session-uais-operation-browser-smoke",
                authenticatedAt: "2026-06-30T08:00:00.000Z",
                expiresAt: "2026-06-30T09:00:00.000Z",
              },
            },
          }),
        };
      }
      if (
        pathname === "/api/teaching/courses/teacher-course-main-browser-smoke/classes" &&
        method === "POST"
      ) {
        marker.mainClassCreateSubmitted = true;
        marker.mainClassCreateReceiptAuthSessionReturned = true;
        writeMarker();
        return {
          status: () => 200,
          json: async () => ({
            receipt: {
              authSession: {
                sessionId: "session-uais-operation-browser-smoke",
                authenticatedAt: "2026-06-30T08:00:00.000Z",
                expiresAt: "2026-06-30T09:00:00.000Z",
              },
            },
          }),
        };
      }
      if (pathname === "/api/teaching/courses" && method === "GET") {
        if (marker.mainCourseCreateSubmitted) {
          marker.mainCourseCreateReadbackVerified = true;
        }
        if (marker.mainClassCreateSubmitted) {
          marker.mainClassCreateReadbackVerified = true;
        }
        if (marker.mainInvitePublishSubmitted) {
          marker.mainInvitePublishClassReadbackVerified = true;
        }
        writeMarker();
        return {
          status: () => 200,
          json: async () => ({
            courses: [
              {
                courseId: "teacher-course-main-browser-smoke",
                courseName: "浏览器烟测课程",
              },
            ],
            classes: [
              {
                classId: "teacher-course-main-browser-smoke-class-1",
                courseId: "teacher-course-main-browser-smoke",
                className: "浏览器烟测班级",
                invitationCode: "88442211",
              },
            ],
          }),
        };
      }
      return {
        status: () => 200,
        json: async () => ({}),
      };
    },
    fulfill: async (options = {}) => {
      let responseBody;
      if (options && typeof options.body === "string") {
        try {
          responseBody = JSON.parse(options.body);
        } catch {
          responseBody = undefined;
        }
      }
      if (!responseBody && options && options.response && typeof options.response.json === "function") {
        responseBody = await options.response.json().catch(() => undefined);
      }
      if (pathname === "/api/teaching/operations") {
        emitRouteResponse(pathname, method, responseBody || createTeachingOperationResponse(body));
        if (body && body.sourceAction === "failure-alert-probe") {
          marker.failureProbeFulfilled = true;
        } else if (
          responseBody &&
          responseBody.error === "Main inline teaching operation was rejected."
        ) {
          marker.mainInlineFailureProbeFulfilled = true;
        } else if (
          body &&
          body.operationId === "course-settings" &&
          body.actionSlot === "primary" &&
          marker.operationApiContinueCount >= 3
        ) {
          marker.mainInlineFailureProbeFulfilled = true;
        } else {
          marker.operationApiFulfilled = true;
        }
      }
      if (pathname === "/api/teaching/operations/audit") {
        marker.auditReadbackFulfilled = true;
      }
      if (pathname === "/api/teaching/operations/audit/alerts") {
        marker.auditAlertReadbackFulfilled = true;
      }
      if (
        pathname === "/api/teaching/operations/audit/alerts/notifications" &&
        method === "POST"
      ) {
        marker.alertNotificationPostFulfilled = true;
      }
      if (
        pathname === "/api/teaching/operations/audit/alerts/notifications" &&
        method === "GET"
      ) {
        marker.alertNotificationReadbackFulfilled = true;
      }
      if (pathname.includes("/api/teaching/operations/records/")) {
        marker.rollbackApiFulfilled = true;
      }
      if (pathname === "/api/teaching/course-cover" && method === "POST") {
        marker.mainCourseCoverGenerated = true;
      }
      writeMarker();
    },
  };
}

let currentSurface = "operation-detail";
let currentWorkspace = "course-settings";
let currentDialog = "";
let currentSourceAction = "";
let currentCourseSettingsName = "大学研究方法";
let pendingCourseSettingsName = "";
let mainCourseCardPatched = false;
const pendingResponseWaiters = [];

function locatorNameMatches(candidate, optionName) {
  if (!optionName) {
    return false;
  }
  if (optionName instanceof RegExp) {
    return optionName.test(candidate);
  }
  return String(candidate).includes(String(optionName));
}

function createRouteResponse(pathname, method, responseBody) {
  return {
    url: () => "http://127.0.0.1" + pathname,
    request: () => ({
      method: () => method,
    }),
    json: async () => responseBody || {},
  };
}

function emitRouteResponse(pathname, method, responseBody) {
  const response = createRouteResponse(pathname, method, responseBody);
  const remainingWaiters = [];
  for (const waiter of pendingResponseWaiters) {
    if (waiter.predicate(response)) {
      if (waiter.timeoutId) {
        clearTimeout(waiter.timeoutId);
      }
      waiter.resolve(response);
    } else {
      remainingWaiters.push(waiter);
    }
  }
  pendingResponseWaiters.length = 0;
  pendingResponseWaiters.push(...remainingWaiters);
}

function createTeachingOperationResponse(body) {
  const operationId = body && body.operationId ? body.operationId : "course-settings";
  const actionSlot = body && body.actionSlot ? body.actionSlot : "primary";
  const inviteArtifact =
    operationId === "invite-code"
      ? {
          kind: "invite-code",
          code: actionSlot === "secondary" ? "88442211" : "88442211",
          status: actionSlot === "secondary" ? "published" : "generated",
          joinUrl: "/courses?invite=88442211",
        }
      : undefined;
  return {
    status: "ok",
    receipt: {
      receiptId: "operation-record-course-settings-primary",
      operationId,
      actionSlot,
      status: "persisted",
      ...(inviteArtifact ? { artifacts: [inviteArtifact] } : {}),
      audit: {
        authMode: "signed-teacher-session",
        authSession: {
          sessionId: "session-uais-operation-browser-smoke",
          authenticatedAt: "2026-06-30T08:00:00.000Z",
          expiresAt: "2026-06-30T09:00:00.000Z",
        },
      },
    },
    ...(operationId === "invite-code" && actionSlot === "secondary"
      ? {
          classInvitePublicationReceipt: {
            action: "publish-class-invite-code",
            actorId: "teacher-kang",
            courseId: "teacher-course-main-browser-smoke",
            classId: "teacher-course-main-browser-smoke-class-1",
            status: "persisted",
          },
        }
      : {}),
  };
}

function createCourseCoverResponse(body) {
  const courseId =
    body && typeof body.courseId === "string" ? body.courseId : "teacher-course-main-browser-smoke";
  return {
    cover: {
      provider: "qwen",
      imageUrl: "https://redacted.example.test/course-cover-main-browser-smoke.png",
      model: "qwen-image-redacted",
      requestId: "redacted-course-cover-main-browser-smoke",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    },
    asset: {
      assetId: "course-cover-asset-main-browser-smoke",
      courseId,
      storagePolicy: "external-redacted-teaching-course-cover-assets",
    },
    assetPersistence: {
      status: "persisted",
      storagePolicy: "external-redacted-teaching-course-cover-assets",
      responsibleSession: "S12",
    },
    audit: {
      eventType: "teaching-course-cover.generated",
      assetId: "course-cover-asset-main-browser-smoke",
      courseId,
      authMode: "signed-teacher-session",
      authSession: {
        sessionId: "session-uais-operation-browser-smoke",
        authenticatedAt: "2026-06-30T08:00:00.000Z",
        expiresAt: "2026-06-30T09:00:00.000Z",
      },
    },
  };
}

const page = {
  route: async (_pattern, handler) => {
    apiHandler = handler;
  },
  waitForResponse: async (predicate, options = {}) =>
    new Promise((resolve, reject) => {
      const timeoutMs =
        options && typeof options.timeout === "number" ? options.timeout : 15_000;
      const waiter = { predicate, resolve, reject, timeoutId: undefined };
      waiter.timeoutId = setTimeout(() => {
        const index = pendingResponseWaiters.indexOf(waiter);
        if (index >= 0) {
          pendingResponseWaiters.splice(index, 1);
        }
        reject(new Error("Timed out waiting for fake route response."));
      }, timeoutMs);
      pendingResponseWaiters.push(waiter);
    }),
  goto: async (url) => {
    const target = String(url || "");
    const operationRouteMatch = target.match(new RegExp("/teaching/([^/?#]+)"));
    currentSurface = operationRouteMatch ? "operation-detail" : "main-teaching";
    currentWorkspace = operationRouteMatch
      ? decodeURIComponent(operationRouteMatch[1])
      : "course-settings";
    currentSourceAction = target.includes("failure-alert-probe")
      ? "failure-alert-probe"
      : currentSurface === "operation-detail"
      ? currentWorkspace
      : "";
  },
  getByText: () => ({
    count: async () => 0,
    first: () => ({ waitFor: async () => undefined }),
  }),
  getByLabel: (label) => ({
    fill: async (value) => {
      const labelText = String(label);
      if (
        labelText.includes("课程名称") ||
        labelText.includes("Course Name") ||
        labelText.includes("名称") ||
        labelText.includes("Name")
      ) {
        pendingCourseSettingsName = String(value);
      }
    },
    inputValue: async () => currentCourseSettingsName,
  }),
  getByRole: (role, options) => {
    if (role === "heading") {
      return {
        count: async () => {
          if (
            !mainCourseCardPatched &&
            locatorNameMatches(currentCourseSettingsName, options && options.name)
          ) {
            return 1;
          }
          if (
            mainCourseCardPatched &&
            locatorNameMatches(currentCourseSettingsName, options && options.name)
          ) {
            return 1;
          }
          return 0;
        },
        first: () => ({ waitFor: async () => undefined }),
      };
    }
    if (role === "link") {
      return {
        click: async () => {
          const name = String(options && options.name);
          if (name.includes("Knowledge Base") || name.includes("课程知识库")) {
            currentWorkspace = "knowledge-base";
          }
          if (name.includes("Student Management") || name.includes("学生管理")) {
            currentWorkspace = "students";
          }
          if (name.includes("Data Dashboard") || name.includes("数据看板")) {
            currentWorkspace = "dashboard";
          }
          if (name.includes("Agent Setup") || name.includes("智能体配置")) {
            currentWorkspace = "agents";
          }
          if (name.includes("Course Content") || name.includes("课程内容")) {
            currentWorkspace = "content";
          }
          if (name.includes("Admin Settings") || name.includes("管理员设置")) {
            currentWorkspace = "admins";
          }
          if (name.includes("Data Export") || name.includes("数据导出")) {
            currentWorkspace = "data-export";
          }
          if (name.includes("Quiz Board") || name.includes("测验看板")) {
            currentWorkspace = "quiz-board";
          }
          if (name.includes("Assignment Review") || name.includes("作业批改")) {
            currentWorkspace = "grading";
          }
          if (name.includes("Invite Code") || name.includes("邀请码")) {
            currentWorkspace = "invite-code";
          }
        },
        evaluate: async () => false,
      };
    }
    if (role === "button") {
      return {
        click: async () => {
          const buttonName = String(options && options.name);
          if (buttonName.includes("New Course") || buttonName.includes("新增课程")) {
            currentDialog = "new-course";
            return;
          }
          if (buttonName.includes("Generate Cover") || buttonName.includes("生成封面")) {
            marker.mainCourseCoverGenerated = true;
            await apiHandler(createRouteRequest("/api/teaching/course-cover", "POST", {
              courseId: "teacher-course-main-browser-smoke",
              name: "浏览器烟测课程",
            }));
            writeMarker();
            return;
          }
          if (
            (buttonName.includes("New class") || buttonName.includes("新建班级")) &&
            currentDialog === ""
          ) {
            currentDialog = "new-class";
            return;
          }
          if ((buttonName.includes("Done") || buttonName.includes("完成")) && currentDialog) {
            if (currentDialog === "new-course") {
              await apiHandler(createRouteRequest("/api/teaching/courses", "POST", {
                name: "浏览器烟测课程",
                ...(marker.mainCourseCoverGenerated
                  ? { coverAssetId: "course-cover-asset-main-browser-smoke" }
                  : {}),
              }));
              await apiHandler(createRouteRequest("/api/teaching/courses", "GET"));
              currentCourseSettingsName = "浏览器烟测课程";
              pendingCourseSettingsName = "";
              mainCourseCardPatched = false;
              currentDialog = "";
              return;
            }
            if (currentDialog === "new-class") {
              await apiHandler(createRouteRequest(
                "/api/teaching/courses/teacher-course-main-browser-smoke/classes",
                "POST",
                {
                  className: "浏览器烟测班级",
                },
              ));
              await apiHandler(createRouteRequest("/api/teaching/courses", "GET"));
              currentDialog = "";
              return;
            }
          }
          if (buttonName.includes("Roll Back")) {
            await apiHandler(createRouteRequest("/api/teaching/operations/records/operation-record-course-settings-primary/rollback", "POST"));
            return;
          }
          if (buttonName.includes("Notify Admin")) {
            await apiHandler(createRouteRequest("/api/teaching/operations/audit/alerts/notifications", "POST"));
            await apiHandler(createRouteRequest("/api/teaching/operations/audit/alerts/notifications", "GET"));
            return;
          }
          const isSecondaryAction =
            buttonName.includes("Preview Student View") ||
            buttonName.includes("预览学生端") ||
            buttonName.includes("Run Permission Preflight") ||
            buttonName.includes("运行权限预检") ||
            buttonName.includes("Add Resource Placeholder") ||
            buttonName.includes("添加资料占位") ||
            buttonName.includes("Generate Unit Draft") ||
            buttonName.includes("生成单元草稿") ||
            buttonName.includes("Send Collaboration Invite") ||
            buttonName.includes("发送协作邀请") ||
            buttonName.includes("Generate Group Suggestions") ||
            buttonName.includes("生成分组建议") ||
            buttonName.includes("Validate Redaction Scope") ||
            buttonName.includes("校验脱敏范围") ||
            buttonName.includes("Lock Daily Snapshot") ||
            buttonName.includes("锁定日报快照") ||
            buttonName.includes("Flag Low-quality Items") ||
            buttonName.includes("标记低质题复核") ||
            buttonName.includes("Generate AI Feedback") ||
            buttonName.includes("生成智能反馈建议") ||
            buttonName.includes("Publish Invite Code") ||
            buttonName.includes("确认发布邀请码");
          const operationIdByWorkspace = {
            "course-settings": "course-settings",
            "knowledge-base": "knowledge-base",
            students: "students",
            dashboard: "dashboard",
            agents: "agents",
            content: "content",
            admins: "admins",
            "data-export": "data-export",
            "quiz-board": "quiz-board",
            grading: "grading",
            "invite-code": "invite-code",
          };
          const body = {
            operationId: operationIdByWorkspace[currentWorkspace] || "course-settings",
            actionSlot: isSecondaryAction ? "secondary" : "primary",
            courseId:
              currentSurface === "main-teaching" && currentWorkspace === "invite-code"
                ? "teacher-course-main-browser-smoke"
                : "research-methods",
            ...(currentSurface === "main-teaching" && currentWorkspace === "invite-code"
              ? { targetClassId: "teacher-course-main-browser-smoke-class-1" }
              : {}),
            ...(currentSourceAction ? { sourceAction: currentSourceAction } : {}),
            ...(
              currentSurface === "main-teaching" &&
              currentWorkspace === "course-settings" &&
              !isSecondaryAction
                ? {
                    courseSettingsPatch: {
                      courseName: "大学研究方法",
                      ...(pendingCourseSettingsName
                        ? { courseName: pendingCourseSettingsName }
                        : {}),
                      semester: "2026秋季学期",
                    },
                  }
                : {}
            ),
          };
          await apiHandler(createRouteRequest("/api/teaching/operations", "POST", body));
          const shouldStopAfterMainInlineFailureProbe =
            marker.mainInlineFailureProbeFulfilled &&
            currentSurface === "main-teaching" &&
            currentWorkspace === "course-settings" &&
            !isSecondaryAction;
          if (shouldStopAfterMainInlineFailureProbe) {
            return;
          }
          if (currentSourceAction !== "failure-alert-probe") {
            await apiHandler(createRouteRequest("/api/teaching/operations/audit", "GET"));
          }
          if (
            currentSourceAction !== "failure-alert-probe" &&
            currentSurface === "main-teaching" &&
            currentWorkspace === "invite-code" &&
            isSecondaryAction
          ) {
            await apiHandler(createRouteRequest("/api/teaching/courses", "GET"));
          }
          if (
            currentSourceAction !== "failure-alert-probe" &&
            currentSurface === "main-teaching" &&
            currentWorkspace === "course-settings" &&
            !isSecondaryAction &&
            pendingCourseSettingsName
          ) {
            currentCourseSettingsName = pendingCourseSettingsName;
            mainCourseCardPatched = true;
          }
          if (
            currentSourceAction !== "failure-alert-probe" &&
            currentSurface === "main-teaching" &&
            currentWorkspace !== "invite-code"
          ) {
            await apiHandler(createRouteRequest("/api/teaching/operations/audit/alerts", "GET"));
          }
        },
        evaluate: async () => true,
      };
    }
    return {
      click: async () => undefined,
      evaluate: async () => false,
      waitFor: async () => undefined,
    };
  },
  content: async () => "<html><body>operation browser smoke</body></html>",
};

module.exports = {
  chromium: {
    launch: async () => ({
      newContext: async () => ({
        addCookies: async () => {
          marker.cookiesAdded = true;
          writeMarker();
        },
        newPage: async () => page,
      }),
      close: async () => undefined,
    }),
  },
};
`,
  );
  if (!existsSync(input.markerPath)) {
    writeFileSync(
      input.markerPath,
      JSON.stringify({
        cookiesAdded: false,
        operationApiContinued: false,
        auditReadbackContinued: false,
        auditAlertReadbackContinued: false,
        alertNotificationPostContinued: false,
        alertNotificationReadbackContinued: false,
        rollbackApiContinued: false,
        failureProbeFulfilled: false,
        mainInlineFailureProbeFulfilled: false,
        mainCourseCoverGenerated: false,
        mainCourseCreateBoundGeneratedCoverAsset: false,
        mainCourseCreateSubmitted: false,
        mainCourseCreateReceiptAuthSessionReturned: false,
        mainCourseCreateReadbackVerified: false,
        mainClassCreateSubmitted: false,
        mainClassCreateReceiptAuthSessionReturned: false,
        mainClassCreateReadbackVerified: false,
        mainInlineCourseSettingsPatchSubmitted: false,
        mainInlineKnowledgeIndexSyncSubmitted: false,
        mainInlineStudentRosterSyncSubmitted: false,
        mainInlineDashboardRefreshSubmitted: false,
        mainInlineStudentPreviewSubmitted: false,
        mainInlineAgentPermissionPreflightSubmitted: false,
        mainInlineResourcePlaceholderSubmitted: false,
        mainInlineUnitDraftSubmitted: false,
        mainInlineCollaborationInviteSubmitted: false,
        mainInlineStudentGroupSuggestionSubmitted: false,
        mainInlineExportRedactionValidationSubmitted: false,
        mainInlineDashboardSnapshotSubmitted: false,
        mainInlineQuizItemReviewSubmitted: false,
        mainInlineGradingFeedbackDraftSubmitted: false,
        mainInlineAgentPlanSubmitted: false,
        mainInlineContentPublishSubmitted: false,
        mainInlineAdminSettingsSubmitted: false,
        mainInlineExportManifestSubmitted: false,
        mainInlineQuizBoardRefreshSubmitted: false,
        mainInlineGradingQueueSubmitted: false,
        mainInviteDraftSubmitted: false,
        mainInvitePublishSubmitted: false,
        mainInvitePublishClassReadbackVerified: false,
        operationInviteDraftSubmitted: false,
        secondaryOperationSubmitted: false,
        operationApiContinueCount: 0,
        operationApiFetched: false,
        operationApiFetchCount: 0,
        auditReadbackContinueCount: 0,
        auditAlertReadbackContinueCount: 0,
        alertNotificationPostContinueCount: 0,
        alertNotificationReadbackContinueCount: 0,
        rollbackApiContinueCount: 0,
        operationApiFulfilled: false,
        auditReadbackFulfilled: false,
        auditAlertReadbackFulfilled: false,
        alertNotificationPostFulfilled: false,
        alertNotificationReadbackFulfilled: false,
        rollbackApiFulfilled: false,
      }),
    );
  }
}

function listenForTest(server: Server) {
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(`http://127.0.0.1:${address.port}`);
        return;
      }
      reject(new Error("Test server did not expose a TCP address."));
    });
  });
}

function execFileForTest(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      timeout: 10_000,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function closeServerForTest(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.closeAllConnections?.();
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
