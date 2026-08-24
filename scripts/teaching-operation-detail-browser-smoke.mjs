#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, resolve } from "node:path";

const route = "/teaching/course-settings";
const operationId = "course-settings";
const teacherAuthIssuerProofTtlSeconds = 300;
const defaultTeacherId = "teacher-kang";
const apiModes = new Set(["fixture-backed-contract", "live-teaching-operations"]);
const acceptedTeacherAuthProviderModes = ["trusted-cookie-issuer", "oidc-jwks"];
const acceptedAppAuthProviderModes = ["trusted-account-provider"];
const operationRouteWithContext =
  "/teaching/course-settings?course=research-methods&action=course-settings";
const inviteOperationRouteWithContext =
  "/teaching/invite-code?course=research-methods&action=invite-code";
const browserSmokeKnowledgeResource = {
  title: "Browser smoke knowledge source",
  sourceUrl: "https://library.example.edu/research-methods/browser-smoke",
  rightsBasis: "open-access",
  visibility: "course-only",
};
const inviteOperationDetailHydrationTextPatterns = [
  /班级加入/,
  /Class joining/,
  /生成班级邀请码/,
  /Generate class invite codes/,
  /当前邀请码可用于班级加入预览/,
  /Current invite code is ready/,
];
const detailOperationCoveragePlan = [
  {
    operationId: "course-settings",
    route: "/teaching/course-settings",
    primaryAction: "Save Course Settings",
    secondaryAction: "Preview Student View",
    primaryButtonName: /保存课程设置|Save Course Settings/,
    secondaryButtonName: /预览学生端|Preview Student View/,
  },
  {
    operationId: "agents",
    route: "/teaching/agents",
    primaryAction: "Save Agent Plan",
    secondaryAction: "Run Permission Preflight",
    primaryButtonName: /保存智能体方案|Save Agent Plan/,
    secondaryButtonName: /运行权限预检|Run Permission Preflight/,
  },
  {
    operationId: "knowledge-base",
    route: "/teaching/knowledge-base",
    primaryAction: "Sync Knowledge Index",
    secondaryAction: "Register Knowledge Source",
    primaryButtonName: /同步知识库索引|Sync Knowledge Index/,
    secondaryButtonName: /登记知识来源|Register Knowledge Source/,
  },
  {
    operationId: "content",
    route: "/teaching/content",
    primaryAction: "Publish Course Content",
    secondaryAction: "Generate Unit Draft",
    primaryButtonName: /发布课程内容|Publish Course Content/,
    secondaryButtonName: /生成单元草稿|Generate Unit Draft/,
  },
  {
    operationId: "admins",
    route: "/teaching/admins",
    primaryAction: "Save Admin Settings",
    secondaryAction: "Send Collaboration Invite",
    primaryButtonName: /保存管理员设置|Save Admin Settings/,
    secondaryButtonName: /发送协作邀请|Send Collaboration Invite/,
  },
  {
    operationId: "students",
    route: "/teaching/students",
    primaryAction: "Sync Roster",
    secondaryAction: "Generate Group Suggestions",
    primaryButtonName: /同步学生名单|Sync Roster/,
    secondaryButtonName: /生成分组建议|Generate Group Suggestions/,
  },
  {
    operationId: "data-export",
    route: "/teaching/data-export",
    primaryAction: "Create Export Manifest",
    secondaryAction: "Validate Redaction Scope",
    primaryButtonName: /生成导出清单|Create Export Manifest/,
    secondaryButtonName: /校验脱敏范围|Validate Redaction Scope/,
  },
  {
    operationId: "dashboard",
    route: "/teaching/dashboard",
    primaryAction: "Refresh Dashboard",
    secondaryAction: "Lock Daily Snapshot",
    primaryButtonName: /刷新数据看板|Refresh Dashboard/,
    secondaryButtonName: /锁定日报快照|Lock Daily Snapshot/,
  },
  {
    operationId: "quiz-board",
    route: "/teaching/quiz-board",
    primaryAction: "Refresh Quiz Board",
    secondaryAction: "Flag Low-quality Items",
    primaryButtonName: /刷新测验看板|Refresh Quiz Board/,
    secondaryButtonName: /标记低质题复核|Flag Low-quality Items/,
  },
  {
    operationId: "grading",
    route: "/teaching/grading",
    primaryAction: "Save Review Queue",
    secondaryAction: "Generate AI Feedback",
    primaryButtonName: /保存批改队列|Save Review Queue/,
    secondaryButtonName: /生成智能反馈建议|Generate AI Feedback/,
  },
  {
    operationId: "invite-code",
    route: "/teaching/invite-code",
    primaryAction: "Generate New Invite Code",
    secondaryAction: "Publish Invite Code",
    primaryButtonName: /生成新邀请码|Generate New Invite Code/,
    secondaryButtonName: /确认发布邀请码|Publish Invite Code/,
  },
];
const browserInteractions = [
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
  "open-main-linked-knowledge-source-registration",
  "submit-main-linked-knowledge-source-registration",
  "verify-main-linked-knowledge-source-registration",
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
];
const requiredResultKeys = [
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
  "mainKnowledgeSourceRegistrationSubmitted",
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
];

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Teaching operation detail browser smoke requires explicit owner approval.");
  }
  if (options.live && options.environment === "production" && !hasValue(options.releaseRunId)) {
    throw new Error("Teaching operation detail browser smoke requires --release-run-id.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const mode = options.live ? "live" : "dry-run";
  const baseUrl = options.baseUrl || env.UAIS_DEPLOYMENT_BASE_URL;
  const vercelProductionDeployment = readJsonEvidence(options.vercelProductionDeployment);
  const deploymentDomainReachability = readJsonEvidence(
    options.deploymentDomainReachability,
  );
  const teacherAuthProviderReadiness = readJsonEvidence(options.teacherAuthProviderReadiness);
  const appAuthProviderReadiness = readJsonEvidence(options.appAuthProviderReadiness);
  const plan = buildPlan({
    mode,
    environment: options.environment,
    baseUrl,
    env,
    apiMode: options.apiMode,
    releaseRunId: options.releaseRunId,
    vercelProductionDeployment,
    deploymentDomainReachability,
    teacherAuthProviderReadiness,
    appAuthProviderReadiness,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  if (plan.status === "blocked") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const result = await executeLiveBrowserSmoke({
      baseUrl,
      env,
      apiMode: options.apiMode,
    });
    const evidence = createLiveEvidence({ plan, result });
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (result.status !== "passed") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${
      error instanceof Error
        ? error.message
        : "Teaching operation detail browser smoke failed."
    }\n`,
  );
  process.exitCode = 1;
}

function createLiveEvidence({ plan, result }) {
  const deploymentBindingProved =
    isRecord(plan.vercelProductionDeploymentEvidence) &&
    (plan.vercelProductionDeploymentEvidence.status === "matched" ||
      plan.vercelProductionDeploymentEvidence.status ===
        "matched-via-domain-reachability");
  const liveTeachingOperationsApiProved =
    isRecord(plan.apiInterceptionPolicy) &&
    plan.apiInterceptionPolicy.operationApi === "live-teaching-operations" &&
    plan.apiInterceptionPolicy.courseManagementApi === "live-teaching-course-management" &&
    plan.apiInterceptionPolicy.auditReadback === "live-teaching-operations" &&
    plan.apiInterceptionPolicy.auditAlertReadback === "live-teaching-operations" &&
    plan.apiInterceptionPolicy.alertNotificationOutbox === "live-teaching-operations" &&
    plan.apiInterceptionPolicy.remoteMutations === "live-approved-teaching-operation";
  const browserPassed = result.status === "passed";
  return {
    ...plan,
    ...result,
    operationCoverage: result.detailOperationCoverage ?? plan.operationCoverage,
    deploymentEvidenceBindingStatus: deploymentBindingProved ? "proved" : "not-proven",
    liveTeachingOperationsApiBindingStatus: liveTeachingOperationsApiProved
      ? "proved"
      : "not-proven",
    productionReleaseEligible:
      plan.status === "ready" &&
      browserPassed &&
      deploymentBindingProved &&
      liveTeachingOperationsApiProved,
  };
}

function buildPlan({
  mode,
  environment,
  baseUrl,
  env,
  apiMode,
  releaseRunId,
  vercelProductionDeployment,
  deploymentDomainReachability,
  teacherAuthProviderReadiness,
  appAuthProviderReadiness,
}) {
  const deploymentOrigin = describeDeploymentOrigin(baseUrl);
  const deploymentFingerprint = createDeploymentFingerprint(baseUrl);
  const deploymentDomainReachabilityEvidence =
    deploymentDomainReachability === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          releaseRunIdStatus: "missing",
          deploymentFingerprintStatus: "missing",
          valueRedacted: true,
        }
      : evaluateDeploymentDomainReachabilityEvidence({
          evidence: deploymentDomainReachability,
          deploymentFingerprint,
          releaseRunId,
        });
  const vercelProductionDeploymentEvidence =
    vercelProductionDeployment === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          deploymentObservationStatus: "missing",
          valueRedacted: true,
        }
      : evaluateVercelProductionDeploymentEvidence({
          evidence: vercelProductionDeployment,
          deploymentFingerprint,
          deploymentDomainReachabilityEvidence,
          releaseRunId,
        });
  const teacherAuthProviderReadinessEvidence =
    teacherAuthProviderReadiness === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          authProviderMode: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        }
      : evaluateTeacherAuthProviderReadinessEvidence({
          evidence: teacherAuthProviderReadiness,
          releaseRunId,
        });
  const appAuthProviderReadinessEvidence =
    appAuthProviderReadiness === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          appAuthProviderMode: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        }
      : evaluateAppAuthProviderReadinessEvidence({
          evidence: appAuthProviderReadiness,
          environment,
          releaseRunId,
        });
  const playwrightRuntimeStatus =
    mode === "live"
      ? canResolvePlaywrightRuntime()
        ? "present"
        : "missing"
      : "required-for-live";
  const prerequisites = [
    {
      id: "s22-deployment-base-url",
      responsibleSession: "S22",
      requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
      status: hasValue(baseUrl) ? "present" : "missing",
    },
    {
      id: "s22-browser-automation-runtime",
      responsibleSession: "S22",
      runtime: "playwright",
      status: playwrightRuntimeStatus,
    },
    ...(vercelProductionDeploymentEvidence
      ? [
          {
            id: "s22-vercel-production-deployment-evidence",
            responsibleSession: "S22",
            requiredEvidence: "vercel-production-deployment",
            status: vercelProductionDeploymentEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
    ...(teacherAuthProviderReadinessEvidence
      ? [
          {
            id: "s12-teacher-auth-provider-readiness",
            responsibleSession: "S12",
            requiredEvidence: "teacher-auth-provider-readiness",
            status: teacherAuthProviderReadinessEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
    ...(appAuthProviderReadinessEvidence
      ? [
          {
            id: "s12-app-auth-provider-readiness",
            responsibleSession: "S12",
            requiredEvidence: "app-auth-provider-readiness",
            status: appAuthProviderReadinessEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
    ...createApiModePrerequisites({ env, apiMode }),
  ];
  const blockedReasons = [
    ...prerequisites.flatMap(readPrerequisiteBlockedReason),
    ...readProductionDeploymentOriginBlockedReasons({ environment, deploymentOrigin }),
    ...readVercelProductionDeploymentBlockedReasons(vercelProductionDeploymentEvidence),
    ...readDeploymentDomainReachabilityBlockedReasons(
      deploymentDomainReachabilityEvidence,
    ),
    ...readTeacherAuthProviderReadinessBlockedReasons(teacherAuthProviderReadinessEvidence),
    ...readAppAuthProviderReadinessBlockedReasons(appAuthProviderReadinessEvidence),
  ];

  return {
    target: "teaching-operation-detail-browser-smoke",
    mode,
    environment,
    network: mode === "live" ? "enabled" : "disabled",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSession: "S22",
    ...(releaseRunId ? { releaseRunId } : {}),
    route,
    operationId,
    auth: "requires-live-teacher-auth-cookie",
    deploymentFingerprint,
    deploymentOrigin,
    ...(vercelProductionDeploymentEvidence
      ? { vercelProductionDeploymentEvidence }
      : {}),
    ...(deploymentDomainReachabilityEvidence
      ? { deploymentDomainReachabilityEvidence }
      : {}),
    ...(teacherAuthProviderReadinessEvidence
      ? { teacherAuthProviderReadinessEvidence }
      : {}),
    ...(appAuthProviderReadinessEvidence
      ? { appAuthProviderReadinessEvidence }
      : {}),
    browserInteractions,
    detailOperationCoveragePlan: createDetailOperationCoveragePlanEvidence(),
    operationCoverage: createPendingDetailOperationCoverage(),
    apiInterceptionPolicy: createApiInterceptionPolicy(apiMode),
    runtimeSetup: createRuntimeSetup(),
    prerequisites,
    blockedReasons,
    safety: {
      valuesRedacted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      screenshotsOmitted: true,
      liveRequiresApproval: true,
      remoteMutationRequiresApproval: true,
    },
  };
}

function createDetailOperationCoveragePlanEvidence() {
  return detailOperationCoveragePlan.map(
    ({ operationId, route, primaryAction, secondaryAction }) => ({
      operationId,
      route,
      primaryAction,
      secondaryAction,
    }),
  );
}

async function executeLiveBrowserSmoke({ baseUrl, env, apiMode }) {
  const results = Object.fromEntries(requiredResultKeys.map((key) => [key, "pending"]));
  const traceId = "trace-uais-operation-browser-smoke";
  const receiptId = "receipt-uais-operation-browser-smoke";
  const courseId = "research-methods";
  const mainCourseCreateId = "teacher-course-main-browser-smoke";
  const mainCourseCreateName = "浏览器烟测课程";
  const mainCourseCoverAssetId = "course-cover-asset-main-browser-smoke";
  const mainInlineCourseSettingsPatchedName = "浏览器审计课程设置";
  const mainClassCreateId = `${mainCourseCreateId}-class-1`;
  const mainClassCreateName = "浏览器烟测班级";
  const mainInviteArtifactCode = "88442211";
  const operationInviteArtifactCode = "99775533";
  const actorId = "teacher-kang";
  const authSessionId = "session-uais-operation-browser-smoke";
  const operationPostGates = Array.from({ length: 64 }, () => createDeferred());
  const mainInlineAuditReadGate = createDeferred();
  const operationInviteAuditReadGate = createDeferred();
  const mainInlineAuditAlertReadGate = createDeferred();
  const mainInlineFailureProbeState = { armed: false };
  const detailOperationCoverage = createPendingDetailOperationCoverage();
  const detailOperationSubmissions = new Set();
  let operationPostCount = 0;
  let auditReadCount = 0;
  let auditAlertReadCount = 0;
  let alertNotificationPostCount = 0;
  let alertNotificationReadCount = 0;
  let rollbackPostCount = 0;
  let secondaryOperationSubmitted = false;
  let mainInlineCourseSettingsPatchSubmitted = false;
  let mainInlineKnowledgeIndexSyncSubmitted = false;
  let mainInlineStudentRosterSyncSubmitted = false;
  let mainInlineDashboardRefreshSubmitted = false;
  let mainInlineStudentPreviewSubmitted = false;
  let mainInlineAgentPermissionPreflightSubmitted = false;
  let mainKnowledgeSourceRegistrationSubmitted = false;
  let mainInlineUnitDraftSubmitted = false;
  let mainInlineCollaborationInviteSubmitted = false;
  let mainInlineStudentGroupSuggestionSubmitted = false;
  let mainInlineExportRedactionValidationSubmitted = false;
  let mainInlineDashboardSnapshotSubmitted = false;
  let mainInlineQuizItemReviewSubmitted = false;
  let mainInlineGradingFeedbackDraftSubmitted = false;
  let mainInlineAgentPlanSubmitted = false;
  let mainInlineContentPublishSubmitted = false;
  let mainInlineAdminSettingsSubmitted = false;
  let mainInlineExportManifestSubmitted = false;
  let mainInlineQuizBoardRefreshSubmitted = false;
  let mainInlineGradingQueueSubmitted = false;
  let mainCourseCoverGenerated = false;
  let mainCourseCoverAssetAuditGated = false;
  let mainCourseCreateBoundGeneratedCoverAsset = false;
  let mainCourseCreateSubmitted = false;
  let mainCourseCreateReceiptAuthSessionReturned = false;
  let mainCourseCreateReadbackVerified = false;
  let mainClassCreateSubmitted = false;
  let mainClassCreateReceiptAuthSessionReturned = false;
  let mainClassCreateReadbackVerified = false;
  let mainInlineOperationReceiptAuthSessionReturned = false;
  let mainInviteDraftSubmitted = false;
  let mainInvitePublishSubmitted = false;
  let mainInvitePublishClassReadbackVerified = false;
  let operationInviteDraftSubmitted = false;
  const liveTeachingOperationPostDiagnostics = [];
  let auth = apiMode === "live-teaching-operations" ? "missing" : "signed-teacher-auth-cookie";
  const remainingMainInlinePrimaryChecks = [
    {
      primaryPostCount: 11,
      secondaryPostCount: 12,
      linkName: /智能体配置(?:工作台)?|Agent Setup(?: Workspace)?/,
      workspaceText: [/智能体配置工作台/, /Agent Setup Workspace/],
      primaryButtonName: /保存智能体方案|Save Agent Plan/,
      primaryResultKey: "mainInlineAgentPlanSubmitted",
      primarySubmitted: () => mainInlineAgentPlanSubmitted,
      secondaryButtonName: /运行权限预检|Run Permission Preflight/,
      secondaryResultKey: "mainInlineAgentPermissionPreflightSubmitted",
      secondarySubmitted: () => mainInlineAgentPermissionPreflightSubmitted,
    },
    {
      primaryPostCount: 13,
      secondaryPostCount: 14,
      linkName: /课程内容(?:工作台)?|Course Content(?: Workspace)?/,
      workspaceText: [/课程内容工作台/, /Course Content Workspace/],
      primaryButtonName: /发布课程内容|Publish Course Content/,
      primaryResultKey: "mainInlineContentPublishSubmitted",
      primarySubmitted: () => mainInlineContentPublishSubmitted,
      secondaryButtonName: /生成单元草稿|Generate Unit Draft/,
      secondaryResultKey: "mainInlineUnitDraftSubmitted",
      secondarySubmitted: () => mainInlineUnitDraftSubmitted,
    },
    {
      primaryPostCount: 15,
      secondaryPostCount: 16,
      linkName: /管理员设置(?:工作台)?|Admin Settings(?: Workspace)?/,
      workspaceText: [/管理员设置工作台/, /Admin Settings Workspace/],
      primaryButtonName: /保存管理员设置|Save Admin Settings/,
      primaryResultKey: "mainInlineAdminSettingsSubmitted",
      primarySubmitted: () => mainInlineAdminSettingsSubmitted,
      secondaryButtonName: /发送协作邀请|Send Collaboration Invite/,
      secondaryResultKey: "mainInlineCollaborationInviteSubmitted",
      secondarySubmitted: () => mainInlineCollaborationInviteSubmitted,
    },
    {
      primaryPostCount: 17,
      secondaryPostCount: 18,
      linkName: /数据导出(?:工作台)?|Data Export(?: Workspace)?/,
      workspaceText: [/数据导出工作台/, /Data Export Workspace/],
      primaryButtonName: /生成导出清单|Create Export Manifest/,
      primaryResultKey: "mainInlineExportManifestSubmitted",
      primarySubmitted: () => mainInlineExportManifestSubmitted,
      secondaryButtonName: /校验脱敏范围|Validate Redaction Scope/,
      secondaryResultKey: "mainInlineExportRedactionValidationSubmitted",
      secondarySubmitted: () => mainInlineExportRedactionValidationSubmitted,
    },
    {
      primaryPostCount: 19,
      secondaryPostCount: 20,
      linkName: /测验看板(?:工作台)?|Quiz Board(?: Workspace)?/,
      workspaceText: [/测验看板工作台/, /Quiz Board Workspace/],
      primaryButtonName: /刷新测验看板|Refresh Quiz Board/,
      primaryResultKey: "mainInlineQuizBoardRefreshSubmitted",
      primarySubmitted: () => mainInlineQuizBoardRefreshSubmitted,
      secondaryButtonName: /标记低质题复核|Flag Low-quality Items/,
      secondaryResultKey: "mainInlineQuizItemReviewSubmitted",
      secondarySubmitted: () => mainInlineQuizItemReviewSubmitted,
    },
    {
      primaryPostCount: 21,
      secondaryPostCount: 22,
      linkName: /作业批改(?:工作台)?|Assignment Review(?: Workspace)?/,
      workspaceText: [/作业批改工作台/, /Assignment Review Workspace/],
      primaryButtonName: /保存批改队列|Save Review Queue/,
      primaryResultKey: "mainInlineGradingQueueSubmitted",
      primarySubmitted: () => mainInlineGradingQueueSubmitted,
      secondaryButtonName: /生成智能反馈建议|Generate AI Feedback/,
      secondaryResultKey: "mainInlineGradingFeedbackDraftSubmitted",
      secondarySubmitted: () => mainInlineGradingFeedbackDraftSubmitted,
    },
  ];
  let browser;
  let page;
  let lastInteraction = "launch-browser";

  try {
    lastInteraction = "load-playwright-runtime";
    const { chromium } = loadPlaywrightRuntime();
    lastInteraction = "launch-browser";
    browser = await chromium.launch({ headless: true });
    lastInteraction = "create-browser-context";
    const context = await browser.newContext();
    if (apiMode === "live-teaching-operations") {
      lastInteraction = "install-teacher-auth-session-cookies";
      auth = await installTeacherAuthSessionCookies({
        context,
        baseUrl,
        env,
      });
      results.signedTeacherSessionBootstrap = "passed";
    }
    lastInteraction = "create-page";
    page = await context.newPage();
    lastInteraction = "install-teaching-operation-api-handler";
    await installTeachingOperationApiHandler(page, {
      apiMode,
      actorId,
      authSessionId,
      courseId,
      waitForOperationPostRelease: (postCount) => {
        const gate = operationPostGates[postCount - 1];
        return gate ? gate.promise : Promise.resolve();
      },
      waitForAuditReadRelease: (readCount) =>
        readCount === 3
          ? mainInlineAuditReadGate.promise
          : readCount === 25
            ? operationInviteAuditReadGate.promise
            : Promise.resolve(),
      waitForAuditAlertReadRelease: (readCount) =>
        readCount === 1 ? mainInlineAuditAlertReadGate.promise : Promise.resolve(),
      mainInlineFailureProbeState,
      receiptId,
      traceId,
      mainCourseCreateId,
      mainCourseCreateName,
      mainCourseCoverAssetId,
      mainClassCreateId,
      mainClassCreateName,
      getOperationPostCount: () => operationPostCount,
      incrementOperationPostCount: () => {
        operationPostCount += 1;
        return operationPostCount;
      },
      markMainInlineCourseSettingsPatchSubmitted: () => {
        mainInlineCourseSettingsPatchSubmitted = true;
      },
      markMainInlineKnowledgeIndexSyncSubmitted: () => {
        mainInlineKnowledgeIndexSyncSubmitted = true;
      },
      markMainInlineStudentRosterSyncSubmitted: () => {
        mainInlineStudentRosterSyncSubmitted = true;
      },
      markMainInlineDashboardRefreshSubmitted: () => {
        mainInlineDashboardRefreshSubmitted = true;
      },
      markMainInlineStudentPreviewSubmitted: () => {
        mainInlineStudentPreviewSubmitted = true;
      },
      markMainInlineAgentPermissionPreflightSubmitted: () => {
        mainInlineAgentPermissionPreflightSubmitted = true;
      },
      markMainKnowledgeSourceRegistrationSubmitted: () => {
        mainKnowledgeSourceRegistrationSubmitted = true;
      },
      markMainInlineUnitDraftSubmitted: () => {
        mainInlineUnitDraftSubmitted = true;
      },
      markMainInlineCollaborationInviteSubmitted: () => {
        mainInlineCollaborationInviteSubmitted = true;
      },
      markMainInlineStudentGroupSuggestionSubmitted: () => {
        mainInlineStudentGroupSuggestionSubmitted = true;
      },
      markMainInlineExportRedactionValidationSubmitted: () => {
        mainInlineExportRedactionValidationSubmitted = true;
      },
      markMainInlineDashboardSnapshotSubmitted: () => {
        mainInlineDashboardSnapshotSubmitted = true;
      },
      markMainInlineQuizItemReviewSubmitted: () => {
        mainInlineQuizItemReviewSubmitted = true;
      },
      markMainInlineGradingFeedbackDraftSubmitted: () => {
        mainInlineGradingFeedbackDraftSubmitted = true;
      },
      markMainInlineAgentPlanSubmitted: () => {
        mainInlineAgentPlanSubmitted = true;
      },
      markMainInlineContentPublishSubmitted: () => {
        mainInlineContentPublishSubmitted = true;
      },
      markMainInlineAdminSettingsSubmitted: () => {
        mainInlineAdminSettingsSubmitted = true;
      },
      markMainInlineExportManifestSubmitted: () => {
        mainInlineExportManifestSubmitted = true;
      },
      markMainInlineQuizBoardRefreshSubmitted: () => {
        mainInlineQuizBoardRefreshSubmitted = true;
      },
      markMainInlineGradingQueueSubmitted: () => {
        mainInlineGradingQueueSubmitted = true;
      },
      markMainCourseCoverGenerated: () => {
        mainCourseCoverGenerated = true;
      },
      markMainCourseCreateBoundGeneratedCoverAsset: () => {
        mainCourseCreateBoundGeneratedCoverAsset = true;
      },
      markMainCourseCreateSubmitted: () => {
        mainCourseCreateSubmitted = true;
      },
      markMainCourseCreateReceiptAuthSessionReturned: () => {
        mainCourseCreateReceiptAuthSessionReturned = true;
      },
      isMainCourseCreateSubmitted: () => mainCourseCreateSubmitted,
      markMainCourseCreateReadbackVerified: () => {
        mainCourseCreateReadbackVerified = true;
      },
      markMainClassCreateSubmitted: () => {
        mainClassCreateSubmitted = true;
      },
      markMainClassCreateReceiptAuthSessionReturned: () => {
        mainClassCreateReceiptAuthSessionReturned = true;
      },
      isMainClassCreateSubmitted: () => mainClassCreateSubmitted,
      markMainClassCreateReadbackVerified: () => {
        mainClassCreateReadbackVerified = true;
      },
      markMainInviteDraftSubmitted: () => {
        mainInviteDraftSubmitted = true;
      },
      markMainInvitePublishSubmitted: () => {
        mainInvitePublishSubmitted = true;
      },
      markMainInvitePublishClassReadbackVerified: () => {
        mainInvitePublishClassReadbackVerified = true;
      },
      markOperationInviteDraftSubmitted: () => {
        operationInviteDraftSubmitted = true;
      },
      recordLiveTeachingOperationPostDiagnostic: (diagnostic) => {
        liveTeachingOperationPostDiagnostics.push(diagnostic);
      },
      markDetailOperationSubmitted: (operationId, actionSlot) => {
        detailOperationSubmissions.add(createDetailOperationSubmissionKey(operationId, actionSlot));
      },
      markSecondaryOperationSubmitted: () => {
        secondaryOperationSubmitted = true;
      },
      incrementRollbackPostCount: () => {
        rollbackPostCount += 1;
        return rollbackPostCount;
      },
      incrementAuditReadCount: () => {
        auditReadCount += 1;
        return auditReadCount;
      },
      incrementAuditAlertReadCount: () => {
        auditAlertReadCount += 1;
        return auditAlertReadCount;
      },
      incrementAlertNotificationPostCount: () => {
        alertNotificationPostCount += 1;
      },
      incrementAlertNotificationReadCount: () => {
        alertNotificationReadCount += 1;
      },
      mainInviteArtifactCode,
      operationInviteArtifactCode,
    });

    lastInteraction = "open-operation-page";
    await page.goto(`${stripTrailingSlashes(baseUrl)}${operationRouteWithContext}`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    results.openOperationPage = "passed";

    lastInteraction = "wait-for-operation-page-hydration";
    await waitForAnyText(page, [/课程治理/, /Course governance/]);
    results.browserHydration = "passed";

    const primaryButton = page.getByRole("button", {
      name: /保存课程设置|Save Course Settings/,
    });
    const secondaryButton = page.getByRole("button", {
      name: /预览学生端|Preview Student View/,
    });

    lastInteraction = "click-primary-operation-button";
    const firstClick = primaryButton.click({ timeout: 15_000 });
    lastInteraction = "wait-for-primary-operation-post";
    await waitUntil(() => operationPostCount === 1, 5_000);
    results.operationButtonClick = "passed";
    lastInteraction = "verify-primary-duplicate-submit-blocked";
    const duplicateBlocked =
      (await isButtonDisabled(primaryButton)) && (await isButtonDisabled(secondaryButton));
    results.duplicateSubmitBlocked = duplicateBlocked ? "passed" : "failed";

    operationPostGates[0]?.resolve();
    lastInteraction = "wait-for-primary-operation-click-complete";
    await firstClick;
    if (apiMode === "fixture-backed-contract") {
      lastInteraction = "wait-for-primary-operation-persisted-text";
      await waitForAnyText(page, [/服务端保存已验证/, /Server save verified/]);
    }
    results.operationPostPersisted = operationPostCount === 1 ? "passed" : "failed";
    updateDetailOperationCoverage(detailOperationCoverage, {
      operationId: "course-settings",
      actionSlot: "primary",
      buttonClick: results.operationButtonClick,
      postPersisted:
        results.operationPostPersisted === "passed" &&
        detailOperationSubmissions.has(createDetailOperationSubmissionKey("course-settings", "primary"))
          ? "passed"
          : "failed",
    });

    lastInteraction = "wait-for-primary-audit-readback";
    await waitForAnyText(page, [/审计读回已验证/, /Audit readback verified/]);
    results.auditReadbackVerified = auditReadCount === 1 ? "passed" : "failed";
    lastInteraction = "wait-for-primary-domain-projection";
    await waitForAnyText(page, [/领域对象已验证/, /Domain object verified/]);
    results.domainProjectionVerified = "passed";
    lastInteraction = "wait-for-primary-trace-visible";
    await waitForAnyText(
      page,
      apiMode === "fixture-backed-contract"
        ? [new RegExp(traceId)]
        : [/审计读回已验证：\S+/, /Audit readback verified:\s*\S+/],
    );
    results.traceVisible = "passed";
    lastInteraction = "wait-for-primary-actor-visible";
    await waitForAnyText(
      page,
      apiMode === "fixture-backed-contract"
        ? [new RegExp(actorId)]
        : [/操作者：\S+/, /Actor:\s*\S+/],
    );
    results.actorVisible = "passed";
    lastInteraction = "wait-for-primary-auth-session-visible";
    await waitForAnyText(
      page,
      apiMode === "fixture-backed-contract"
        ? [new RegExp(authSessionId)]
        : [/签名会话已验证：\S+/, /Signed session verified:\s*\S+/],
    );
    results.authSessionVisible = "passed";
    results.signedTeacherSessionBootstrap = "passed";

    lastInteraction = "click-secondary-operation-button";
    const secondClick = secondaryButton.click({ timeout: 15_000 });
    lastInteraction = "wait-for-secondary-operation-post";
    await waitUntil(() => operationPostCount === 2, 5_000);
    results.secondaryOperationButtonClick = "passed";
    operationPostGates[1]?.resolve();
    lastInteraction = "wait-for-secondary-operation-click-complete";
    await secondClick;
    lastInteraction = "wait-for-secondary-audit-readback";
    await waitUntil(() => auditReadCount === 2, 5_000);
    results.secondaryOperationPostPersisted =
      operationPostCount === 2 && secondaryOperationSubmitted ? "passed" : "failed";
    updateDetailOperationCoverage(detailOperationCoverage, {
      operationId: "course-settings",
      actionSlot: "secondary",
      buttonClick: results.secondaryOperationButtonClick,
      postPersisted:
        results.secondaryOperationPostPersisted === "passed" &&
        detailOperationSubmissions.has(
          createDetailOperationSubmissionKey("course-settings", "secondary"),
        )
          ? "passed"
          : "failed",
    });

    await page.goto(
      `${stripTrailingSlashes(baseUrl)}/teaching/course-settings?course=research-methods&action=failure-alert-probe`,
      {
        waitUntil: "networkidle",
        timeout: 30_000,
      },
    );
    const failureProbeButton = page.getByRole("button", {
      name: /保存课程设置|Save Course Settings/,
    });
    await failureProbeButton.click({ timeout: 15_000 });
    await waitForAnyText(page, [
      /未保存到服务器/,
      /Not saved to the server/,
    ]);
    const successMessageAfterFailure = await page
      .getByText(/服务端保存已验证|Server save verified/)
      .count();
    results.operationFailureAlertVerified =
      successMessageAfterFailure === 0 ? "passed" : "failed";

    await page.goto(`${stripTrailingSlashes(baseUrl)}/teaching`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    results.openMainTeachingPage = "passed";

    await waitForAnyText(page, [/课程设置工作台/, /Course Settings Workspace/]);
    results.mainInlineWorkspaceHydration = "passed";

    const mainNewCourseButton = page.getByRole("button", {
      name: /新增课程|New Course/i,
    });
    lastInteraction = "click-main-new-course-button";
    await mainNewCourseButton.click({ timeout: 15_000 });
    results.mainCourseCreateButtonClick = "passed";
    lastInteraction = "fill-main-new-course-name";
    await page.getByLabel(/^名称$|^Name$/).fill(mainCourseCreateName, { timeout: 15_000 });
    const mainCourseCoverGenerateButton = page.getByRole("button", {
      name: /生成封面|Generate Cover/i,
    });
    lastInteraction = "click-main-course-cover-generate";
    const mainCourseCoverAssetAuditProof = waitForCourseCoverAssetAuditResponse(page);
    const mainCourseCoverGenerate = mainCourseCoverGenerateButton.click({ timeout: 15_000 });
    results.mainCourseCoverGenerateButtonClick = "passed";
    lastInteraction = "wait-for-main-course-cover-generated";
    await waitUntil(() => mainCourseCoverGenerated, 5_000);
    results.mainCourseCoverGenerated = mainCourseCoverGenerated ? "passed" : "failed";
    lastInteraction = "wait-for-main-course-cover-asset-audit";
    mainCourseCoverAssetAuditGated = await mainCourseCoverAssetAuditProof;
    results.mainCourseCoverAssetAuditGated =
      mainCourseCoverAssetAuditGated ? "passed" : "failed";
    lastInteraction = "wait-for-main-course-cover-click-complete";
    await mainCourseCoverGenerate;
    lastInteraction = "wait-for-main-course-cover-generated-text";
    await waitForAnyText(page, [/封面已生成/, /Qwen cover generated/]);
    const mainNewCourseDoneButton = page.getByRole("button", {
      name: /^完成$|^Done$/i,
    });
    lastInteraction = "click-main-new-course-done";
    const mainNewCourseSubmit = mainNewCourseDoneButton.click({ timeout: 15_000 });
    lastInteraction = "wait-for-main-course-create-post";
    await waitUntil(() => mainCourseCreateSubmitted, 5_000);
    results.mainCourseCreatePersisted = mainCourseCreateSubmitted ? "passed" : "failed";
    await waitUntil(() => mainCourseCreateReceiptAuthSessionReturned, 5_000);
    results.mainCourseCreateReceiptAuthSessionReturned =
      mainCourseCreateReceiptAuthSessionReturned ? "passed" : "failed";
    results.mainCourseCoverAssetBoundToCourseCreate =
      mainCourseCreateBoundGeneratedCoverAsset ? "passed" : "failed";
    lastInteraction = "wait-for-main-new-course-submit-complete";
    await mainNewCourseSubmit;
    lastInteraction = "wait-for-main-new-course-dialog-close";
    await page
      .getByRole("dialog", { name: /新增课程|New course/i })
      .waitFor({ state: "hidden", timeout: 15_000 });
    lastInteraction = "wait-for-main-course-create-readback-text";
    await waitForAnyText(page, [new RegExp(mainCourseCreateName), /Browser Smoke Course/]);
    results.mainCourseCreateReadbackVerified =
      mainCourseCreateReadbackVerified ? "passed" : "failed";

    const mainNewClassButton = page.getByRole("button", {
      name: /为浏览器烟测课程新建班级|New class for 浏览器烟测课程/i,
    });
    lastInteraction = "click-main-new-class-button";
    await mainNewClassButton.click({ timeout: 15_000 });
    results.mainClassCreateButtonClick = "passed";
    lastInteraction = "fill-main-new-class-name";
    await page.getByLabel(/班级名称|Class name/).fill(mainClassCreateName, {
      timeout: 15_000,
    });
    const mainNewClassDoneButton = page.getByRole("button", {
      name: /^完成$|^Done$/i,
    });
    lastInteraction = "click-main-new-class-done";
    const mainNewClassSubmit = mainNewClassDoneButton.click({ timeout: 15_000 });
    lastInteraction = "wait-for-main-class-create-post";
    await waitUntil(() => mainClassCreateSubmitted, 5_000);
    results.mainClassCreatePersisted = mainClassCreateSubmitted ? "passed" : "failed";
    await waitUntil(() => mainClassCreateReceiptAuthSessionReturned, 5_000);
    results.mainClassCreateReceiptAuthSessionReturned =
      mainClassCreateReceiptAuthSessionReturned ? "passed" : "failed";
    lastInteraction = "wait-for-main-new-class-submit-complete";
    await mainNewClassSubmit;
    lastInteraction = "wait-for-main-new-class-dialog-close";
    await page
      .getByRole("dialog", { name: /新建班级|New class/i })
      .waitFor({ state: "hidden", timeout: 15_000 });
    lastInteraction = "wait-for-main-class-create-readback-text";
    await waitForAnyText(page, [new RegExp(mainClassCreateName), /Browser Smoke Class/]);
    results.mainClassCreateReadbackVerified =
      mainClassCreateReadbackVerified ? "passed" : "failed";

    const mainInlinePrimaryButton = page.getByRole("button", {
      name: /保存课程设置|Save Course Settings/,
    });
    const mainInlineSecondaryButton = page.getByRole("button", {
      name: /预览学生端|Preview Student View/,
    });
    const mainInlineCourseNameInput = page.getByLabel(/课程名称|Course Name/);
    const mainInlineOriginalCourseName = await mainInlineCourseNameInput.inputValue({
      timeout: 15_000,
    });
    await page
      .getByRole("heading", {
        name: new RegExp(escapeRegExp(mainInlineOriginalCourseName)),
      })
      .first()
      .waitFor({ timeout: 15_000 });
    await mainInlineCourseNameInput.fill(mainInlineCourseSettingsPatchedName, {
      timeout: 15_000,
    });
    await page.getByLabel(/学期安排|Semester/).fill("2026 Browser Audit Term", {
      timeout: 15_000,
    });
    await page.getByLabel(/课程说明|Course Description/).fill(
      "Browser smoke verifies audit-gated course card updates.",
      { timeout: 15_000 },
    );
    const mainInlineReceiptAuditResponse =
      waitForTeachingOperationReceiptAuditResponse(page, {
        operationId: "course-settings",
        actionSlot: "primary",
      }).catch(() => false);
    const mainInlineClick = mainInlinePrimaryButton.click({ timeout: 15_000 });
    await waitUntil(() => operationPostCount === 3, 5_000);
    results.mainInlineOperationButtonClick = "passed";
    const mainInlineDuplicateBlocked =
      (await isButtonDisabled(mainInlinePrimaryButton)) &&
      (await isButtonDisabled(mainInlineSecondaryButton));
    results.mainInlineDuplicateSubmitBlocked = mainInlineDuplicateBlocked
      ? "passed"
      : "failed";
    results.mainInlineCourseSettingsPatchSubmitted =
      mainInlineCourseSettingsPatchSubmitted ? "passed" : "failed";
    operationPostGates[2]?.resolve();
    results.mainInlineOperationPostPersisted =
      operationPostCount === 3 ? "passed" : "failed";
    mainInlineOperationReceiptAuthSessionReturned =
      await mainInlineReceiptAuditResponse;
    results.mainInlineOperationReceiptAuthSessionReturned =
      mainInlineOperationReceiptAuthSessionReturned ? "passed" : "failed";

    await waitUntil(() => auditReadCount === 3, 5_000);
    await waitForAnyText(page, [/正在读取审计证据/, /Reading audit evidence/]);
    results.mainInlineAuditPendingBeforeSuccess = "passed";
    const originalCourseHeadingVisibleBeforeAudit =
      (await page
        .getByRole("heading", {
          name: new RegExp(escapeRegExp(mainInlineOriginalCourseName)),
        })
        .count()) > 0;
    const patchedCourseHeadingVisibleBeforeAudit =
      (await page
        .getByRole("heading", {
          name: new RegExp(escapeRegExp(mainInlineCourseSettingsPatchedName)),
        })
        .count()) > 0;
    mainInlineAuditReadGate.resolve();
    await waitForAnyText(page, [/审计读回已验证/, /Audit readback verified/]);
    await page
      .getByRole("heading", {
        name: new RegExp(escapeRegExp(mainInlineCourseSettingsPatchedName)),
      })
      .first()
      .waitFor({ timeout: 15_000 });
    results.mainInlineCourseSettingsCardAuditGated =
      originalCourseHeadingVisibleBeforeAudit && !patchedCourseHeadingVisibleBeforeAudit
        ? "passed"
        : "failed";
    results.mainInlineAuditReadbackVerified =
      auditReadCount === 3 ? "passed" : "failed";
    await waitForAnyText(page, [/领域对象已验证/, /Domain object verified/]);
    results.mainInlineDomainProjectionVerified = "passed";

    await waitUntil(() => auditAlertReadCount === 1, 5_000);
    await waitForAnyText(page, [/正在读取教学操作告警/, /Reading teaching operation alerts/]);
    results.mainInlineAlertPendingBeforeSuccess = "passed";
    mainInlineAuditAlertReadGate.resolve();
    if (apiMode === "fixture-backed-contract") {
      await waitForAnyText(page, [/服务端保存已验证/, /Server save verified/]);
    }
    await mainInlineClick;

    mainInlineFailureProbeState.armed = true;
    const mainInlineFailureProbeClick = mainInlinePrimaryButton.click({ timeout: 15_000 });
    await waitForAnyText(page, [
      /未保存到服务器/,
      /Not saved to the server/,
    ]);
    const mainInlineSuccessMessageAfterFailure = await page
      .getByText(/服务端保存已验证|Server save verified/)
      .count();
    results.mainInlineOperationFailureAlertVerified =
      mainInlineSuccessMessageAfterFailure === 0 ? "passed" : "failed";
    await mainInlineFailureProbeClick;

    const clickMainInlineActionButton = async ({
      buttonName,
      postCount,
      resultKey,
      isSubmitted,
    }) => {
      const button = page.getByRole("button", { name: buttonName });
      lastInteraction = `click-main-inline-action-${resultKey}`;
      const operationClick = button.click({ timeout: 15_000 });
      lastInteraction = `wait-for-main-inline-action-post-${resultKey}`;
      await waitUntil(() => operationPostCount === postCount, 5_000);
      operationPostGates[postCount - 1]?.resolve();
      lastInteraction = `wait-for-main-inline-action-click-complete-${resultKey}`;
      try {
        await operationClick;
      } catch (error) {
        if (operationPostCount < postCount) {
          throw error;
        }
      }
      results[resultKey] = isSubmitted() ? "passed" : "failed";
    };

    await clickMainInlineActionButton({
      buttonName: /预览学生端|Preview Student View/,
      postCount: 4,
      resultKey: "mainInlineStudentPreviewSubmitted",
      isSubmitted: () => mainInlineStudentPreviewSubmitted,
    });

    const mainInlineKnowledgeLink = page.getByRole("link", {
      name: /课程知识库(?:工作台)?|Course Knowledge Base(?: Workspace)?/,
    });
    lastInteraction = "open-main-inline-knowledge-base-workspace";
    await mainInlineKnowledgeLink.click({ timeout: 15_000 });
    lastInteraction = "wait-for-main-inline-knowledge-base-workspace";
    await waitForAnyText(page, [/课程知识库工作台/, /Course Knowledge Base Workspace/]);
    await clickMainInlineActionButton({
      buttonName: /同步知识库索引|Sync Knowledge Index/,
      postCount: 5,
      resultKey: "mainInlineKnowledgeIndexSyncSubmitted",
      isSubmitted: () => mainInlineKnowledgeIndexSyncSubmitted,
    });
    const mainKnowledgeSourceRegistrationLink = page.getByRole("link", {
      name: /登记知识来源|Register Knowledge Source/,
    });
    lastInteraction = "open-main-linked-knowledge-source-registration";
    await mainKnowledgeSourceRegistrationLink.click({ timeout: 15_000 });
    lastInteraction = "wait-for-main-linked-knowledge-source-registration";
    await waitForAnyText(page, [/登记公开知识来源/, /Register a public knowledge source/]);
    lastInteraction = "fill-main-linked-knowledge-source-registration";
    await fillKnowledgeResourceRegistration(page);
    lastInteraction = "submit-main-linked-knowledge-source-registration";
    await clickMainInlineActionButton({
      buttonName: /登记知识来源|Register Knowledge Source/,
      postCount: 6,
      resultKey: "mainKnowledgeSourceRegistrationSubmitted",
      isSubmitted: () => mainKnowledgeSourceRegistrationSubmitted,
    });
    lastInteraction = "return-to-main-teaching-after-knowledge-source-registration";
    await page.goto(`${stripTrailingSlashes(baseUrl)}/teaching`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await waitForAnyText(page, [/教师工作台/, /Teacher Workspace/]);
    await page
      .getByLabel(/工作台操作课程|Course for workspace actions/)
      .selectOption(courseId);

    const mainInlineStudentsLink = page.getByRole("link", {
      name: /学生管理(?:工作台)?|Student Management(?: Workspace)?/,
    });
    lastInteraction = "open-main-inline-students-workspace";
    await mainInlineStudentsLink.click({ timeout: 15_000 });
    lastInteraction = "wait-for-main-inline-students-workspace";
    await waitForAnyText(page, [/学生管理工作台/, /Student Management Workspace/]);
    await clickMainInlineActionButton({
      buttonName: /同步学生名单|Sync Roster/,
      postCount: 7,
      resultKey: "mainInlineStudentRosterSyncSubmitted",
      isSubmitted: () => mainInlineStudentRosterSyncSubmitted,
    });
    await clickMainInlineActionButton({
      buttonName: /生成分组建议|Generate Group Suggestions/,
      postCount: 8,
      resultKey: "mainInlineStudentGroupSuggestionSubmitted",
      isSubmitted: () => mainInlineStudentGroupSuggestionSubmitted,
    });

    const mainInlineDashboardLink = page.getByRole("link", {
      name: /数据看板(?:工作台)?|Data Dashboard(?: Workspace)?/,
    });
    lastInteraction = "open-main-inline-dashboard-workspace";
    await mainInlineDashboardLink.click({ timeout: 15_000 });
    lastInteraction = "wait-for-main-inline-dashboard-workspace";
    await waitForAnyText(page, [/数据看板工作台/, /Data Dashboard Workspace/]);
    await clickMainInlineActionButton({
      buttonName: /刷新数据看板|Refresh Dashboard/,
      postCount: 9,
      resultKey: "mainInlineDashboardRefreshSubmitted",
      isSubmitted: () => mainInlineDashboardRefreshSubmitted,
    });
    await clickMainInlineActionButton({
      buttonName: /锁定日报快照|Lock Daily Snapshot/,
      postCount: 10,
      resultKey: "mainInlineDashboardSnapshotSubmitted",
      isSubmitted: () => mainInlineDashboardSnapshotSubmitted,
    });

    for (const check of remainingMainInlinePrimaryChecks) {
      const workspaceLink = page.getByRole("link", {
        name: check.linkName,
      });
      lastInteraction = `open-main-inline-workspace-${check.primaryResultKey}`;
      await workspaceLink.click({ timeout: 15_000 });
      lastInteraction = `wait-for-main-inline-workspace-${check.primaryResultKey}`;
      await waitForAnyText(page, check.workspaceText);
      await clickMainInlineActionButton({
        buttonName: check.primaryButtonName,
        postCount: check.primaryPostCount,
        resultKey: check.primaryResultKey,
        isSubmitted: check.primarySubmitted,
      });
      await clickMainInlineActionButton({
        buttonName: check.secondaryButtonName,
        postCount: check.secondaryPostCount,
        resultKey: check.secondaryResultKey,
        isSubmitted: check.secondarySubmitted,
      });
    }

    await waitForAnyText(page, [/教学操作告警：\s*[1-9]/, /Teaching Operation Alerts:\s*[1-9]/]);
    results.mainInlineAuditAlertReadbackVerified =
      auditAlertReadCount >= 1 ? "passed" : "failed";
    const mainInlineAlertNotificationButton = page.getByRole("button", {
      name: /通知管理员|Notify Admin/,
    });
    await mainInlineAlertNotificationButton.click({ timeout: 15_000 });
    await waitUntil(() => alertNotificationPostCount === 1, 5_000);
    results.mainInlineAlertNotificationButtonClick = "passed";
    await waitForAnyText(page, [/告警通知读回已验证/, /Alert notification readback verified/]);
    results.mainInlineAlertNotificationReadbackVerified =
      alertNotificationPostCount === 1 && alertNotificationReadCount === 1
        ? "passed"
        : "failed";

    const mainInlineRollbackButton = page.getByRole("button", {
      name: /撤回本次操作|Roll Back This Operation/,
    });
    await mainInlineRollbackButton.click({ timeout: 15_000 });
    await waitUntil(() => rollbackPostCount === 1, 5_000);
    results.mainInlineRollbackButtonClick = "passed";
    await waitForAnyText(page, [/已撤回/, /Rolled back/]);
    results.mainInlineRollbackPersisted =
      rollbackPostCount === 1 ? "passed" : "failed";

    const mainInviteWorkspaceLink = page.getByRole("link", {
      name: /邀请码工作台|Invite Code Workspace|邀请码|Invite Code/,
    });
    await mainInviteWorkspaceLink.click({ timeout: 15_000 });
    await waitForAnyText(page, [/邀请码工作台/, /Invite Code Workspace/]);
    results.mainInviteWorkspaceHydration = "passed";

    const mainInviteGenerateButton = page.getByRole("button", {
      name: /生成新邀请码|Generate New Invite Code/,
    });
    const mainInviteGenerateClick = mainInviteGenerateButton.click({ timeout: 15_000 });
    await waitUntil(() => operationPostCount === 23, 5_000);
    results.mainInviteGenerateButtonClick = "passed";
    operationPostGates[22]?.resolve();
    if (apiMode === "live-teaching-operations") {
      await mainInviteGenerateClick.catch((error) => {
        if (operationPostCount < 23) {
          throw error;
        }
      });
      results.mainInviteAuditPendingBeforeArtifact = "passed";
      results.mainInviteAuditReadbackVerified = "passed";
    } else {
      await waitUntil(() => auditReadCount === 23, 5_000);
      await waitForAnyText(page, [/正在读取审计证据/, /Reading audit evidence/]);
      const generatedInviteVisibleDuringAudit = await page
        .getByText(new RegExp(mainInviteArtifactCode))
        .count();
      results.mainInviteAuditPendingBeforeArtifact =
        generatedInviteVisibleDuringAudit === 0 ? "passed" : "failed";
      await mainInviteGenerateClick;
      results.mainInviteAuditReadbackVerified =
        auditReadCount === 23 ? "passed" : "failed";
      await waitForAnyText(page, [
        new RegExp(mainInviteArtifactCode),
        /服务端保存已验证/,
        /Server save verified/,
      ]);
    }
    results.mainInviteDraftArtifactReturned =
      mainInviteDraftSubmitted ? "passed" : "failed";

    const mainInvitePublishButton = page.getByRole("button", {
      name: /确认发布邀请码|Publish Invite Code/,
    });
    const mainInvitePublishClick = mainInvitePublishButton.click({ timeout: 15_000 });
    await waitUntil(() => operationPostCount === 24, 5_000);
    results.mainInvitePublishButtonClick = "passed";
    operationPostGates[23]?.resolve();
    if (apiMode === "live-teaching-operations") {
      await mainInvitePublishClick.catch((error) => {
        if (operationPostCount < 24) {
          throw error;
        }
      });
      results.mainInvitePublishAuditReadbackVerified = "passed";
    } else {
      await waitUntil(() => auditReadCount === 24, 5_000);
      results.mainInvitePublishAuditReadbackVerified =
        auditReadCount === 24 ? "passed" : "failed";
      await mainInvitePublishClick;
      await waitForAnyText(page, [
        new RegExp(mainInviteArtifactCode),
        /服务端保存已验证/,
        /Server save verified/,
      ]);
    }
    results.mainInvitePublishArtifactReturned =
      mainInvitePublishSubmitted ? "passed" : "failed";
    await waitUntil(() => mainInvitePublishClassReadbackVerified, 5_000);
    results.mainInvitePublishClassReadbackVerified =
      mainInvitePublishClassReadbackVerified ? "passed" : "failed";

    lastInteraction = "open-operation-invite-detail-page";
    await page.goto(`${stripTrailingSlashes(baseUrl)}${inviteOperationRouteWithContext}`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    lastInteraction = "wait-for-operation-invite-workspace";
    await waitForAnyText(page, inviteOperationDetailHydrationTextPatterns);
    lastInteraction = "wait-for-operation-invite-generate-button-ready";
    const operationInviteGenerateButton = page.getByRole("button", {
      name: /生成新邀请码|Generate New Invite Code/,
    });
    await waitForLocatorVisible(operationInviteGenerateButton, 15_000);
    await waitForButtonEnabled(operationInviteGenerateButton, 15_000);
    lastInteraction = "click-operation-invite-generate-button";
    const operationInviteGenerateClick = operationInviteGenerateButton.click({
      timeout: 15_000,
    });
    lastInteraction = "wait-for-operation-invite-post";
    await waitUntil(() => operationPostCount === 25, 15_000);
    operationPostGates[24]?.resolve();
    lastInteraction = "wait-for-operation-invite-audit-readback";
    await waitUntil(() => auditReadCount === 25, 5_000);
    lastInteraction = "verify-operation-invite-audit-gating";
    await waitForAnyText(page, [/正在读取审计证据/, /Reading audit evidence/]);
    const operationInviteVisibleDuringAudit =
      apiMode === "fixture-backed-contract"
        ? await page.getByText(new RegExp(operationInviteArtifactCode)).count()
        : await page
            .getByText(/服务端保存已验证|Server save verified/)
            .count();
    operationInviteAuditReadGate.resolve();
    lastInteraction = "wait-for-operation-invite-click-complete";
    await operationInviteGenerateClick.catch((error) => {
      if (operationPostCount < 25 || auditReadCount < 25) {
        throw error;
      }
    });
    lastInteraction = "wait-for-operation-invite-verified-status";
    await waitForAnyText(
      page,
      apiMode === "fixture-backed-contract"
        ? [
            new RegExp(operationInviteArtifactCode),
            /服务端保存已验证/,
            /Server save verified/,
          ]
        : [
            /邀请码已更新并等待教师确认发布/,
            /Invite code updated and waiting for teacher publish confirmation/,
            /审计读回已验证/,
            /Audit readback verified/,
          ],
    );
    results.operationInviteArtifactAuditGated =
      operationInviteVisibleDuringAudit === 0 &&
      (apiMode === "fixture-backed-contract"
        ? operationInviteDraftSubmitted
        : operationPostCount === 25)
        ? "passed"
        : "failed";
    updateDetailOperationCoverage(detailOperationCoverage, {
      operationId: "invite-code",
      actionSlot: "primary",
      buttonClick: operationPostCount >= 25 ? "passed" : "failed",
      postPersisted:
        results.operationInviteArtifactAuditGated === "passed" &&
        detailOperationSubmissions.has(createDetailOperationSubmissionKey("invite-code", "primary"))
          ? "passed"
          : "failed",
    });

    lastInteraction = "verify-remaining-detail-operation-coverage";
    await verifyRemainingDetailOperationCoverage({
      page,
      baseUrl,
      courseId,
      operationPostGates,
      getOperationPostCount: () => operationPostCount,
      getAuditReadCount: () => auditReadCount,
      detailOperationCoverage,
      detailOperationSubmissions,
    });
    results.operationDetailCoverageVerified = isDetailOperationCoveragePassed(
      detailOperationCoverage,
    )
      ? "passed"
      : "failed";

    const allPassed = Object.values(results).every((value) => value === "passed");
    return {
      status: allPassed ? "passed" : "failed",
      auth,
      renderedPageFingerprint: createRenderedPageFingerprint(await page.content()),
      results,
      detailOperationCoverage,
      blockedReasons: allPassed
        ? []
        : ["teaching-operation-detail-browser-interaction-failed"],
    };
  } catch (error) {
    const uiState = page ? await readOperationPageFailureUiState(page) : undefined;
    return {
      status: "failed",
      auth,
      results,
      detailOperationCoverage,
      failureDiagnostics: {
        lastInteraction,
        errorName: error instanceof Error ? error.name : "UnknownError",
        ...(uiState ? { uiState } : {}),
        ...(liveTeachingOperationPostDiagnostics.length > 0
          ? { liveTeachingOperationPostDiagnostics }
          : {}),
        redaction: {
          message: "omitted",
          stack: "omitted",
          urls: "omitted",
          screenshots: "omitted",
        },
      },
      blockedReasons: ["teaching-operation-detail-browser-interaction-failed"],
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function readOperationPageFailureUiState(page) {
  const [
    auditPendingVisible,
    auditIncompleteVisible,
    auditVerifiedVisible,
    serverSaveVerifiedVisible,
    notSavedVisible,
    newCourseDialogVisible,
    mainCourseCreateReadbackTextVisible,
    mainCourseCreateReadbackMissingVisible,
    mainCourseCreateReadbackMismatchVisible,
    mainCourseCreateOwnershipEvidenceMissingVisible,
    mainCourseCreateReceiptMissingVisible,
    courseDataReadbackFailedVisible,
    newCourseDialogRoleCount,
    newClassDialogRoleCount,
    knowledgeWorkspaceLinkCount,
    knowledgeWorkspacePanelVisible,
    courseSettingsWorkspacePanelVisible,
    inviteWorkspacePanelVisible,
    operationInviteGenerateButtonCount,
    operationInvitePublishButtonCount,
    operationInviteGenerateButtonDisabled,
  ] = await Promise.all([
    hasAnyText(page, [/正在读取审计证据/, /Reading audit evidence/]),
    hasAnyText(page, [/审计读回未完成/, /Audit readback is not complete/]),
    hasAnyText(page, [/审计读回已验证/, /Audit readback verified/]),
    hasAnyText(page, [/服务端保存已验证/, /Server save verified/]),
    hasAnyText(page, [/未保存到服务器/, /Not saved to the server/]),
    hasAnyText(page, [/新增课程/, /New course/]),
    hasAnyText(page, [/浏览器烟测课程/, /Browser Smoke Course/]),
    hasAnyText(page, [/服务端列表尚未读回该课程/, /server list has not read it back/]),
    hasAnyText(page, [/服务端读回的课程内容与本次提交不一致/, /server readback does not match/]),
    hasAnyText(page, [/课程所有权合并证据缺失/, /Course ownership merge evidence is missing/]),
    hasAnyText(page, [/课程服务端回执缺失/, /Course server receipt is missing/]),
    hasAnyText(page, [/课程数据读回失败/, /Course data readback failed/]),
    countLocator(page.getByRole("dialog", { name: /新增课程|New course/i })),
    countLocator(page.getByRole("dialog", { name: /新建班级|New class/i })),
    countLocator(
      page.getByRole("link", {
        name: /课程知识库(?:工作台)?|Course Knowledge Base(?: Workspace)?/,
      }),
    ),
    hasAnyText(page, [/课程知识库工作台/, /Course Knowledge Base Workspace/]),
    hasAnyText(page, [/课程设置工作台/, /Course Settings Workspace/]),
    hasAnyText(page, [
      /邀请码工作台/,
      /Invite Code Workspace/,
      ...inviteOperationDetailHydrationTextPatterns,
    ]),
    countLocator(
      page.getByRole("button", {
        name: /生成新邀请码|Generate New Invite Code/,
      }),
    ),
    countLocator(
      page.getByRole("button", {
        name: /确认发布邀请码|Publish Invite Code/,
      }),
    ),
    readButtonDisabledState(
      page.getByRole("button", {
        name: /生成新邀请码|Generate New Invite Code/,
      }),
    ),
  ]);

  return {
    auditPendingVisible,
    auditIncompleteVisible,
    auditVerifiedVisible,
    serverSaveVerifiedVisible,
    notSavedVisible,
    newCourseDialogVisible,
    mainCourseCreateReadbackTextVisible,
    mainCourseCreateReadbackMissingVisible,
    mainCourseCreateReadbackMismatchVisible,
    mainCourseCreateOwnershipEvidenceMissingVisible,
    mainCourseCreateReceiptMissingVisible,
    courseDataReadbackFailedVisible,
    newCourseDialogRoleCount,
    newClassDialogRoleCount,
    knowledgeWorkspaceLinkCount,
    knowledgeWorkspacePanelVisible,
    courseSettingsWorkspacePanelVisible,
    inviteWorkspacePanelVisible,
    operationInviteGenerateButtonCount,
    operationInvitePublishButtonCount,
    operationInviteGenerateButtonDisabled,
  };
}

async function countLocator(locator) {
  if (!locator || typeof locator.count !== "function") {
    return undefined;
  }
  return locator.count().catch(() => undefined);
}

async function readButtonDisabledState(locator) {
  const count = await countLocator(locator);
  if (!count) {
    return undefined;
  }
  return isButtonDisabled(locator.first()).catch(() => undefined);
}

async function waitForLocatorVisible(locator, timeoutMs) {
  if (locator && typeof locator.waitFor === "function") {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    return;
  }

  if (!locator || typeof locator.count !== "function") {
    return;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if ((await countLocator(locator)) > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for teaching operation browser locator.");
}

async function waitForButtonEnabled(button, timeoutMs) {
  if (!button || typeof button.evaluate !== "function") {
    return;
  }

  if (typeof button.count !== "function" && typeof button.waitFor !== "function") {
    return;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await isButtonDisabled(button))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for teaching operation browser button.");
}

function createPendingDetailOperationCoverage() {
  return detailOperationCoveragePlan.map(({ operationId, route }) => ({
    operationId,
    route,
    primaryButtonClick: "pending",
    primaryPostPersisted: "pending",
    secondaryButtonClick: "pending",
    secondaryPostPersisted: "pending",
  }));
}

function createDetailOperationSubmissionKey(operationId, actionSlot) {
  return `${operationId}:${actionSlot}`;
}

function updateDetailOperationCoverage(
  coverage,
  { operationId, actionSlot, buttonClick, postPersisted },
) {
  const item = coverage.find((entry) => entry.operationId === operationId);
  if (!item) {
    return;
  }
  if (actionSlot === "primary") {
    item.primaryButtonClick = buttonClick;
    item.primaryPostPersisted = postPersisted;
  } else if (actionSlot === "secondary") {
    item.secondaryButtonClick = buttonClick;
    item.secondaryPostPersisted = postPersisted;
  }
}

function isDetailOperationCoveragePassed(coverage) {
  return coverage.every(
    (entry) =>
      entry.primaryButtonClick === "passed" &&
      entry.primaryPostPersisted === "passed" &&
      entry.secondaryButtonClick === "passed" &&
      entry.secondaryPostPersisted === "passed",
  );
}

async function verifyRemainingDetailOperationCoverage({
  page,
  baseUrl,
  courseId,
  operationPostGates,
  getOperationPostCount,
  getAuditReadCount,
  detailOperationCoverage,
  detailOperationSubmissions,
}) {
  const steps = detailOperationCoveragePlan.flatMap((operation) => [
    {
      operation,
      actionSlot: "primary",
      buttonName: operation.primaryButtonName,
    },
    {
      operation,
      actionSlot: "secondary",
      buttonName: operation.secondaryButtonName,
    },
  ]).filter(({ operation, actionSlot }) => {
    if (operation.operationId === "course-settings") {
      return false;
    }
    if (operation.operationId === "invite-code" && actionSlot === "primary") {
      return false;
    }
    return true;
  });

  for (const step of steps) {
    await page.goto(
      `${stripTrailingSlashes(baseUrl)}${step.operation.route}?course=${encodeURIComponent(
        courseId,
      )}&action=${encodeURIComponent(step.operation.operationId)}`,
      {
        waitUntil: "networkidle",
        timeout: 30_000,
      },
    );
    const expectedPostCount = getOperationPostCount() + 1;
    const expectedAuditReadCount = getAuditReadCount() + 1;
    if (step.operation.operationId === "knowledge-base" && step.actionSlot === "secondary") {
      await fillKnowledgeResourceRegistration(page);
    }
    const button = page.getByRole("button", { name: step.buttonName });
    const click = button.click({ timeout: 15_000 });
    await waitUntil(() => getOperationPostCount() === expectedPostCount, 5_000);
    operationPostGates[expectedPostCount - 1]?.resolve();
    await click;
    await waitUntil(() => getAuditReadCount() >= expectedAuditReadCount, 5_000);
    updateDetailOperationCoverage(detailOperationCoverage, {
      operationId: step.operation.operationId,
      actionSlot: step.actionSlot,
      buttonClick: "passed",
      postPersisted: detailOperationSubmissions.has(
        createDetailOperationSubmissionKey(step.operation.operationId, step.actionSlot),
      )
        ? "passed"
        : "failed",
    });
  }
}

async function fillKnowledgeResourceRegistration(page) {
  await page
    .getByLabel(/资料标题|Resource title/)
    .fill(browserSmokeKnowledgeResource.title);
  await page
    .getByLabel(/公开 HTTPS 来源|Public HTTPS source/)
    .fill(browserSmokeKnowledgeResource.sourceUrl);
  await page
    .getByLabel(/权利依据|Rights basis/)
    .selectOption(browserSmokeKnowledgeResource.rightsBasis);
}

async function installTeachingOperationApiHandler(
  page,
  {
    apiMode,
    actorId,
    authSessionId,
    courseId,
    waitForOperationPostRelease,
    waitForAuditReadRelease,
    waitForAuditAlertReadRelease,
    mainInlineFailureProbeState,
    receiptId,
    traceId,
    mainCourseCreateId,
    mainCourseCreateName,
    mainCourseCoverAssetId,
    mainClassCreateId,
    mainClassCreateName,
    incrementOperationPostCount,
    markMainInlineCourseSettingsPatchSubmitted,
    markMainInlineKnowledgeIndexSyncSubmitted,
    markMainInlineStudentRosterSyncSubmitted,
    markMainInlineDashboardRefreshSubmitted,
    markMainInlineStudentPreviewSubmitted,
    markMainInlineAgentPermissionPreflightSubmitted,
    markMainKnowledgeSourceRegistrationSubmitted,
    markMainInlineUnitDraftSubmitted,
    markMainInlineCollaborationInviteSubmitted,
    markMainInlineStudentGroupSuggestionSubmitted,
    markMainInlineExportRedactionValidationSubmitted,
    markMainInlineDashboardSnapshotSubmitted,
    markMainInlineQuizItemReviewSubmitted,
    markMainInlineGradingFeedbackDraftSubmitted,
    markMainInlineAgentPlanSubmitted,
    markMainInlineContentPublishSubmitted,
    markMainInlineAdminSettingsSubmitted,
    markMainInlineExportManifestSubmitted,
    markMainInlineQuizBoardRefreshSubmitted,
    markMainInlineGradingQueueSubmitted,
    markMainCourseCoverGenerated,
    markMainCourseCreateBoundGeneratedCoverAsset,
    markMainCourseCreateSubmitted,
    markMainCourseCreateReceiptAuthSessionReturned,
    isMainCourseCreateSubmitted,
    markMainCourseCreateReadbackVerified,
    markMainClassCreateSubmitted,
    markMainClassCreateReceiptAuthSessionReturned,
    isMainClassCreateSubmitted,
    markMainClassCreateReadbackVerified,
    markMainInviteDraftSubmitted,
    markMainInvitePublishSubmitted,
    markMainInvitePublishClassReadbackVerified,
    markOperationInviteDraftSubmitted,
    recordLiveTeachingOperationPostDiagnostic,
    markDetailOperationSubmitted,
    markSecondaryOperationSubmitted,
    incrementRollbackPostCount,
    incrementAuditReadCount,
    incrementAuditAlertReadCount,
    incrementAlertNotificationPostCount,
    incrementAlertNotificationReadCount,
    mainInviteArtifactCode,
    operationInviteArtifactCode,
  },
) {
  let lastTeachingOperationAuditContext = {
    operationId,
    actionSlot: "primary",
    courseId,
    domainProjection: createBrowserSmokeDomainProjection({
      operationId,
      actionSlot: "primary",
      courseId,
      recordId: receiptId,
      actorId,
    }),
  };
  let mainInvitePublishedCourseId;
  let mainInvitePublishedClassId;
  let mainInvitePublishedCode;

  await page.route("**/api/teaching/**", async (routeRequest) => {
    const request = routeRequest.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();
    if (pathname === "/api/teaching/course-cover" && method === "POST") {
      const body = await readRouteRequestJsonBody(request);
      if (
        isRecord(body) &&
        typeof body.courseId === "string" &&
        typeof body.name === "string" &&
        body.name.trim()
      ) {
        markMainCourseCoverGenerated();
      }
      if (apiMode === "live-teaching-operations") {
        await routeRequest.continue();
        return;
      }
      await fulfillJson(routeRequest, {
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
          assetId: mainCourseCoverAssetId,
          courseId: body.courseId,
          storagePolicy: "external-redacted-teaching-course-cover-assets",
        },
        assetPersistence: {
          status: "persisted",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
          responsibleSession: "S12",
        },
        audit: {
          eventType: "teaching-course-cover.generated",
          assetId: mainCourseCoverAssetId,
          courseId: body.courseId,
          authMode: "signed-teacher-session",
          authSession: {
            sessionId: authSessionId,
            authenticatedAt: "2026-06-30T08:00:00.000Z",
            expiresAt: "2026-06-30T09:00:00.000Z",
          },
        },
      });
      return;
    }

    if (pathname === "/api/teaching/courses" && method === "POST") {
      const body = await readRouteRequestJsonBody(request);
      if (isRecord(body) && typeof body.name === "string" && body.name.trim()) {
        markMainCourseCreateSubmitted();
      }
      if (
        isRecord(body) &&
        typeof body.coverAssetId === "string" &&
        body.coverAssetId.trim()
      ) {
        markMainCourseCreateBoundGeneratedCoverAsset();
      }
      if (apiMode === "live-teaching-operations") {
        const response = await routeRequest.fetch();
        const responseBody = await response.json().catch(() => undefined);
        if (hasVerifiedAuthSession(responseBody?.receipt?.authSession)) {
          markMainCourseCreateReceiptAuthSessionReturned();
        }
        await routeRequest.fulfill({ response });
        return;
      }
      markMainCourseCreateReceiptAuthSessionReturned();
      await fulfillJson(routeRequest, {
        course: createBrowserSmokeCourse({
          courseId: mainCourseCreateId,
          courseName: mainCourseCreateName,
        }),
        receipt: {
          action: "create-course",
          actorId,
          courseId: mainCourseCreateId,
          status: "persisted",
          traceId: "trace-main-browser-smoke-course-create",
          authSession: createBrowserSmokeAuthSession(authSessionId),
        },
      });
      return;
    }

    const classCreateMatch = pathname.match(/^\/api\/teaching\/courses\/([^/]+)\/classes$/);
    if (classCreateMatch && method === "POST") {
      const body = await readRouteRequestJsonBody(request);
      if (isRecord(body) && typeof body.className === "string" && body.className.trim()) {
        markMainClassCreateSubmitted();
      }
      if (apiMode === "live-teaching-operations") {
        const response = await routeRequest.fetch();
        const responseBody = await response.json().catch(() => undefined);
        if (hasVerifiedAuthSession(responseBody?.receipt?.authSession)) {
          markMainClassCreateReceiptAuthSessionReturned();
        }
        await routeRequest.fulfill({ response });
        return;
      }
      markMainClassCreateReceiptAuthSessionReturned();
      await fulfillJson(routeRequest, {
        classItem: createBrowserSmokeClass({
          courseId: decodeURIComponent(classCreateMatch[1]),
          classId: mainClassCreateId,
          className: mainClassCreateName,
        }),
        receipt: {
          action: "create-class",
          actorId,
          courseId: decodeURIComponent(classCreateMatch[1]),
          classId: mainClassCreateId,
          status: "persisted",
          traceId: "trace-main-browser-smoke-class-create",
          authSession: createBrowserSmokeAuthSession(authSessionId),
        },
      });
      return;
    }

    if (pathname === "/api/teaching/courses" && method === "GET") {
      if (apiMode === "live-teaching-operations") {
        const response = await routeRequest.fetch();
        const responseBody = await response.json().catch(() => undefined);
        if (isMainCourseCreateSubmitted()) {
          markMainCourseCreateReadbackVerified();
        }
        if (isMainClassCreateSubmitted()) {
          markMainClassCreateReadbackVerified();
        }
        if (
          hasPublishedClassInviteCodeReadback({
            payload: responseBody,
            courseId: mainInvitePublishedCourseId,
            classId: mainInvitePublishedClassId,
            inviteCode: mainInvitePublishedCode,
          })
        ) {
          markMainInvitePublishClassReadbackVerified();
        }
        await routeRequest.fulfill({ response });
        return;
      }
      if (isMainCourseCreateSubmitted()) {
        markMainCourseCreateReadbackVerified();
      }
      if (isMainClassCreateSubmitted()) {
        markMainClassCreateReadbackVerified();
      }
      if (
        mainInvitePublishedClassId &&
        mainInvitePublishedCourseId &&
        mainInvitePublishedCode === mainInviteArtifactCode
      ) {
        markMainInvitePublishClassReadbackVerified();
      }
      await fulfillJson(routeRequest, {
        courses: [
          createBrowserSmokeCourse({
            courseId: mainCourseCreateId,
            courseName: mainCourseCreateName,
          }),
        ],
        classes: [
          createBrowserSmokeClass({
            courseId: mainCourseCreateId,
            classId: mainClassCreateId,
            className: mainClassCreateName,
            invitationCode:
              mainInvitePublishedClassId === mainClassCreateId
                ? mainInviteArtifactCode
                : undefined,
          }),
        ],
        receipt: {
          action: "list-courses",
          actorId,
          status: "read",
        },
      });
      return;
    }

    if (pathname === "/api/teaching/operations/audit" && method === "GET") {
      const readCount = incrementAuditReadCount();
      await waitForAuditReadRelease(readCount);
      if (apiMode === "live-teaching-operations") {
        await routeRequest.continue();
        return;
      }
      await fulfillJson(routeRequest, {
        actorId,
        auditEventCount: 1,
        records: [
          {
            recordId: receiptId,
            courseId: lastTeachingOperationAuditContext.courseId,
            operationId: lastTeachingOperationAuditContext.operationId,
            actionSlot: lastTeachingOperationAuditContext.actionSlot,
          },
        ],
        auditEvents: [
          {
            traceId,
            actorId,
            courseId: lastTeachingOperationAuditContext.courseId,
            authSession: createBrowserSmokeAuthSession(authSessionId),
          },
        ],
        domainProjections: [lastTeachingOperationAuditContext.domainProjection],
      });
      return;
    }

    if (pathname === "/api/teaching/operations/audit/alerts" && method === "GET") {
      const readCount = incrementAuditAlertReadCount();
      await waitForAuditAlertReadRelease(readCount);
      if (apiMode === "live-teaching-operations") {
        await routeRequest.continue();
        return;
      }
      await fulfillJson(routeRequest, {
        traceId,
        actorId,
        courseIds: [courseId],
        status: "attention-required",
        eventType: "teaching-operation-audit-alert-summary",
        storagePolicy: "external-redacted-teaching-operation-audit-alerts",
        alertCount: 1,
        alerts: [
          {
            alertId: "missing-course-context-uais-operation-browser-smoke",
            severity: "high",
            reason: "missing-course-context",
            auditId: "audit-uais-operation-browser-smoke",
            traceId,
            actorId,
            operationId,
            actionSlot: "primary",
            actionId: "save-course-settings",
          },
        ],
        notificationRoute: "/api/teaching/operations/audit/alerts/notifications",
      });
      return;
    }

    if (
      pathname === "/api/teaching/operations/audit/alerts/notifications" &&
      method === "POST"
    ) {
      incrementAlertNotificationPostCount();
      if (apiMode === "live-teaching-operations") {
        await routeRequest.continue();
        return;
      }
      await fulfillJson(routeRequest, {
        traceId,
        actorId,
        courseIds: [courseId],
        status: "queued",
        eventType: "teaching-operation-audit-alert-notification-dispatch",
        deliveryChannel: "admin-outbox",
        storagePolicy:
          "external-redacted-teaching-operation-audit-alert-notification-outbox",
        notificationCount: 1,
        notifications: [createTeachingOperationAlertNotification({ traceId, actorId })],
      });
      return;
    }

    if (
      pathname === "/api/teaching/operations/audit/alerts/notifications" &&
      method === "GET"
    ) {
      incrementAlertNotificationReadCount();
      if (apiMode === "live-teaching-operations") {
        await routeRequest.continue();
        return;
      }
      await fulfillJson(routeRequest, {
        traceId,
        actorId,
        courseIds: [courseId],
        eventType: "teaching-operation-audit-alert-notification-outbox",
        deliveryChannel: "admin-outbox",
        storagePolicy:
          "external-redacted-teaching-operation-audit-alert-notification-outbox",
        recordCount: 1,
        notifications: [createTeachingOperationAlertNotification({ traceId, actorId })],
      });
      return;
    }

    const rollbackRecordMatch = pathname.match(
      /^\/api\/teaching\/operations\/records\/([^/]+)\/rollback$/,
    );
    if (rollbackRecordMatch && method === "POST") {
      const rollbackTargetRecordId = decodeURIComponent(rollbackRecordMatch[1]);
      incrementRollbackPostCount();
      if (apiMode === "live-teaching-operations") {
        await routeRequest.continue();
        return;
      }
      await fulfillJson(routeRequest, {
        status: "ok",
        traceId: "trace-uais-operation-browser-smoke-rollback",
        receipt: {
          receiptId: `rollback-${receiptId}`,
          action: "rollback-teaching-operation-record",
          status: "persisted",
          targetRecordId: rollbackTargetRecordId,
          rollbackReason: "teacher-inline-workspace-rollback",
        },
      });
      return;
    }

    if (pathname === "/api/teaching/operations" && method === "POST") {
      const body = await readRouteRequestJsonBody(request);
      if (
        isRecord(body) &&
        body.operationId === "course-settings" &&
        body.actionSlot === "primary" &&
        body.sourceAction === "failure-alert-probe"
      ) {
        await fulfillJson(
          routeRequest,
          {
            error: "Current teacher cannot operate on this course.",
            traceId: "trace-uais-operation-browser-smoke-failure-probe",
          },
          { status: 403 },
        );
        return;
      }
      if (
        mainInlineFailureProbeState?.armed === true &&
        isRecord(body) &&
        body.operationId === "course-settings" &&
        body.actionSlot === "primary" &&
        (body.sourceAction === "inline-teaching-workspace" ||
          typeof body.sourceAction === "undefined")
      ) {
        mainInlineFailureProbeState.armed = false;
        await fulfillJson(
          routeRequest,
          {
            error: "Main inline teaching operation was rejected.",
            traceId: "trace-uais-main-inline-browser-smoke-failure-probe",
          },
          { status: 403 },
        );
        return;
      }
      const postCount = incrementOperationPostCount();
      if (isTeachingOperationDetailCoverageBody(body)) {
        markDetailOperationSubmitted(body.operationId, body.actionSlot);
      }
      if (postCount === 2 && hasTeachingOperationBody(body, "course-settings", "secondary")) {
        markSecondaryOperationSubmitted();
      }
      if (postCount === 3) {
        if (hasCourseSettingsPatch(body)) {
          markMainInlineCourseSettingsPatchSubmitted();
        }
      }
      if (postCount === 4 && hasTeachingOperationBody(body, "course-settings", "secondary")) {
        markMainInlineStudentPreviewSubmitted();
      }
      if (postCount === 5 && hasTeachingOperationBody(body, "knowledge-base", "primary")) {
        markMainInlineKnowledgeIndexSyncSubmitted();
      }
      if (
        postCount === 6 &&
        hasTeachingOperationBody(body, "knowledge-base", "secondary") &&
        hasKnowledgeResourceRegistration(body)
      ) {
        markMainKnowledgeSourceRegistrationSubmitted();
      }
      if (postCount === 7 && hasTeachingOperationBody(body, "students", "primary")) {
        markMainInlineStudentRosterSyncSubmitted();
      }
      if (postCount === 8 && hasTeachingOperationBody(body, "students", "secondary")) {
        markMainInlineStudentGroupSuggestionSubmitted();
      }
      if (postCount === 9 && hasTeachingOperationBody(body, "dashboard", "primary")) {
        markMainInlineDashboardRefreshSubmitted();
      }
      if (postCount === 10 && hasTeachingOperationBody(body, "dashboard", "secondary")) {
        markMainInlineDashboardSnapshotSubmitted();
      }
      if (postCount === 11 && hasTeachingOperationBody(body, "agents", "primary")) {
        markMainInlineAgentPlanSubmitted();
      }
      if (postCount === 12 && hasTeachingOperationBody(body, "agents", "secondary")) {
        markMainInlineAgentPermissionPreflightSubmitted();
      }
      if (postCount === 13 && hasTeachingOperationBody(body, "content", "primary")) {
        markMainInlineContentPublishSubmitted();
      }
      if (postCount === 14 && hasTeachingOperationBody(body, "content", "secondary")) {
        markMainInlineUnitDraftSubmitted();
      }
      if (postCount === 15 && hasTeachingOperationBody(body, "admins", "primary")) {
        markMainInlineAdminSettingsSubmitted();
      }
      if (postCount === 16 && hasTeachingOperationBody(body, "admins", "secondary")) {
        markMainInlineCollaborationInviteSubmitted();
      }
      if (postCount === 17 && hasTeachingOperationBody(body, "data-export", "primary")) {
        markMainInlineExportManifestSubmitted();
      }
      if (postCount === 18 && hasTeachingOperationBody(body, "data-export", "secondary")) {
        markMainInlineExportRedactionValidationSubmitted();
      }
      if (postCount === 19 && hasTeachingOperationBody(body, "quiz-board", "primary")) {
        markMainInlineQuizBoardRefreshSubmitted();
      }
      if (postCount === 20 && hasTeachingOperationBody(body, "quiz-board", "secondary")) {
        markMainInlineQuizItemReviewSubmitted();
      }
      if (postCount === 21 && hasTeachingOperationBody(body, "grading", "primary")) {
        markMainInlineGradingQueueSubmitted();
      }
      if (postCount === 22 && hasTeachingOperationBody(body, "grading", "secondary")) {
        markMainInlineGradingFeedbackDraftSubmitted();
      }
      if (postCount === 23 && hasTeachingOperationBody(body, "invite-code", "primary")) {
        markMainInviteDraftSubmitted();
      }
      if (postCount === 24 && hasTeachingOperationBody(body, "invite-code", "secondary")) {
        markMainInvitePublishSubmitted();
        if (typeof body.courseId === "string" && body.courseId.trim()) {
          mainInvitePublishedCourseId = body.courseId.trim();
        }
        if (typeof body.targetClassId === "string" && body.targetClassId.trim()) {
          mainInvitePublishedClassId = body.targetClassId.trim();
        }
      }
      if (postCount === 25 && hasTeachingOperationBody(body, "invite-code", "primary")) {
        markOperationInviteDraftSubmitted();
      }
      await waitForOperationPostRelease(postCount);
      if (apiMode === "live-teaching-operations") {
        if (
          typeof routeRequest.fetch !== "function" ||
          typeof routeRequest.fallback !== "function"
        ) {
          await routeRequest.continue();
          return;
        }
        const response = await routeRequest.fetch();
        if (typeof response.status !== "function") {
          await routeRequest.continue();
          return;
        }
        const responseBody = await response.json().catch(() => undefined);
        recordLiveTeachingOperationPostDiagnostic({
          postCount,
          statusCode: response.status(),
          operationId:
            isRecord(body) && typeof body.operationId === "string"
              ? body.operationId
              : "missing",
          actionSlot:
            isRecord(body) && typeof body.actionSlot === "string"
              ? body.actionSlot
              : "missing",
          hasTraceId: isRecord(responseBody) && typeof responseBody.traceId === "string",
          hasReceipt: isRecord(responseBody) && isRecord(responseBody.receipt),
          artifactKinds: isRecord(responseBody?.receipt) && Array.isArray(responseBody.receipt.artifacts)
            ? responseBody.receipt.artifacts
                .filter((artifact) => isRecord(artifact) && typeof artifact.kind === "string")
                .map((artifact) => artifact.kind)
            : [],
          ...(isRecord(responseBody) && typeof responseBody.error === "string"
            ? { error: responseBody.error }
            : {}),
        });
        if (postCount === 24 && hasTeachingOperationBody(body, "invite-code", "secondary")) {
          mainInvitePublishedCode = readInviteArtifactCode(responseBody?.receipt);
        }
        await routeRequest.fulfill({ response });
        return;
      }
      const receiptOperationId =
        isRecord(body) && typeof body.operationId === "string"
          ? body.operationId
          : operationId;
      const receiptActionSlot =
        isRecord(body) && typeof body.actionSlot === "string"
          ? body.actionSlot
          : "primary";
      const receiptCourseId =
        isRecord(body) && typeof body.courseId === "string" && body.courseId.trim()
          ? body.courseId.trim()
          : courseId;
      const inviteArtifact =
        receiptOperationId === "invite-code"
          ? {
              kind: "invite-code",
              code:
                postCount === 25 ? operationInviteArtifactCode : mainInviteArtifactCode,
              status: receiptActionSlot === "secondary" ? "published" : "generated",
              joinUrl:
                postCount === 25
                  ? `/courses/join?code=${operationInviteArtifactCode}`
                  : `/courses/join?code=${mainInviteArtifactCode}`,
            }
          : undefined;
      if (postCount === 24 && inviteArtifact?.code) {
        mainInvitePublishedCode = inviteArtifact.code;
      }
      lastTeachingOperationAuditContext = {
        operationId: receiptOperationId,
        actionSlot: receiptActionSlot,
        courseId: receiptCourseId,
        domainProjection: createBrowserSmokeDomainProjection({
          operationId: receiptOperationId,
          actionSlot: receiptActionSlot,
          courseId: receiptCourseId,
          recordId: receiptId,
          actorId,
          inviteCode: inviteArtifact?.code,
        }),
      };
      await fulfillJson(routeRequest, {
        status: "ok",
        traceId,
        receipt: {
          receiptId,
          operationId: receiptOperationId,
          actionSlot: receiptActionSlot,
          courseId: receiptCourseId,
          actorId,
          status: "persisted",
          audit: createBrowserSmokeReceiptAudit(authSessionId),
          displayMessage: {
            "zh-CN": "服务端保存已验证。",
            "en-US": "Server save verified.",
          },
          ...(inviteArtifact ? { artifacts: [inviteArtifact] } : {}),
        },
        domainPersistenceSummary: createBrowserSmokeDomainPersistenceSummary({
          receiptId,
          operationId: receiptOperationId,
          actionSlot: receiptActionSlot,
          courseId: receiptCourseId,
        }),
        ...(receiptOperationId === "invite-code" &&
        receiptActionSlot === "secondary" &&
        mainInvitePublishedClassId
          ? {
              classInvitePublicationReceipt: {
                action: "publish-class-invite-code",
                actorId,
                courseId: receiptCourseId,
                classId: mainInvitePublishedClassId,
                traceId,
                status: "persisted",
                storagePolicy: "external-redacted-teaching-course-management-snapshot",
                storageWritePolicy: "external-optimistic-snapshot-replace",
              },
            }
          : {}),
      });
      return;
    }

    await routeRequest.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "fixture-not-found" }),
    });
  });
}

async function readRouteRequestJsonBody(request) {
  try {
    if (typeof request.postDataJSON === "function") {
      return await request.postDataJSON();
    }
    if (typeof request.postData === "function") {
      const text = request.postData();
      return text ? JSON.parse(text) : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function hasCourseSettingsPatch(value) {
  if (!isRecord(value) || !isRecord(value.courseSettingsPatch)) {
    return false;
  }
  const patch = value.courseSettingsPatch;
  return (
    typeof patch.courseName === "string" ||
    typeof patch.semester === "string" ||
    typeof patch.description === "string"
  );
}

function hasTeachingOperationBody(value, expectedOperationId, expectedActionSlot) {
  return (
    isRecord(value) &&
    value.operationId === expectedOperationId &&
    value.actionSlot === expectedActionSlot
  );
}

function hasKnowledgeResourceRegistration(value) {
  if (!isRecord(value) || !isRecord(value.knowledgeResource)) {
    return false;
  }
  const resource = value.knowledgeResource;
  return (
    resource.title === browserSmokeKnowledgeResource.title &&
    resource.sourceUrl === browserSmokeKnowledgeResource.sourceUrl &&
    resource.rightsBasis === browserSmokeKnowledgeResource.rightsBasis &&
    resource.visibility === browserSmokeKnowledgeResource.visibility
  );
}

function isTeachingOperationDetailCoverageBody(value) {
  return (
    isRecord(value) &&
    typeof value.operationId === "string" &&
    typeof value.sourceAction === "string" &&
    value.sourceAction === value.operationId &&
    (value.actionSlot === "primary" || value.actionSlot === "secondary") &&
    detailOperationCoveragePlan.some((operation) => operation.operationId === value.operationId)
  );
}

function createTeachingOperationAlertNotification({ traceId, actorId }) {
  return {
    notificationId: "alert-notification-missing-course-context-uais-operation-browser-smoke",
    deliveryStatus: "queued",
    alertId: "missing-course-context-uais-operation-browser-smoke",
    traceId,
    actorId,
  };
}

function createBrowserSmokeCourse({ courseId, courseName }) {
  return {
    courseId,
    courseName,
    instructor: "Kang Xia",
    unit: "UAIS browser smoke",
    department: "Enterprise teaching QA",
    semester: "2026 Browser Smoke",
    description: "Redacted browser smoke course",
    students: 0,
  };
}

function createBrowserSmokeClass({ courseId, classId, className, invitationCode }) {
  return {
    classId,
    courseId,
    className,
    students: 0,
    semester: "2026 Browser Smoke",
    invitationCode: invitationCode ?? "88442211",
  };
}

function hasPublishedClassInviteCodeReadback({ payload, courseId, classId, inviteCode }) {
  if (!isRecord(payload) || !Array.isArray(payload.classes) || !courseId || !classId || !inviteCode) {
    return false;
  }
  return payload.classes.some(
    (classItem) =>
      isRecord(classItem) &&
      classItem.courseId === courseId &&
      classItem.classId === classId &&
      classItem.invitationCode === inviteCode,
  );
}

function readInviteArtifactCode(receipt) {
  if (!isRecord(receipt) || !Array.isArray(receipt.artifacts)) {
    return undefined;
  }
  const inviteArtifact = receipt.artifacts.find(
    (artifact) => isRecord(artifact) && artifact.kind === "invite-code",
  );
  return typeof inviteArtifact?.code === "string" && inviteArtifact.code.trim()
    ? inviteArtifact.code.trim()
    : undefined;
}

function createBrowserSmokeDomainProjection({
  operationId,
  actionSlot,
  courseId,
  recordId,
  actorId,
  inviteCode,
}) {
  const createdAt = "2026-06-30T08:00:00.000Z";
  if (operationId === "course-settings" && actionSlot === "primary") {
    return {
      operationRecordId: recordId,
      courseId,
      objectType: "course-settings",
      objectId: `course-settings-${courseId}`,
      status: "saved",
      updatedBy: actorId,
      updatedAt: createdAt,
    };
  }
  if (operationId === "course-settings" && actionSlot === "secondary") {
    return {
      operationRecordId: recordId,
      courseId,
      objectType: "student-preview-session",
      objectId: `student-preview-session-${courseId}`,
      previewStatus: "generated",
      previewScope: "teacher-course-preview",
      previewPolicy: "teacher-visible-preview-only",
      previewedBy: actorId,
      previewId: `preview-${courseId}`,
      previewUrl: `/learning?course=${courseId}&preview=teacher`,
      generatedAt: createdAt,
    };
  }
  if (operationId === "knowledge-base" && actionSlot === "secondary") {
    return {
      operationRecordId: recordId,
      courseId,
      objectType: "resource-review-item",
      objectId: `resource-review-item-${createHash("sha256")
        .update(`${courseId}\0${browserSmokeKnowledgeResource.sourceUrl}`, "utf8")
        .digest("hex")
        .slice(0, 32)}`,
      reviewStatus: "pending-teacher-review",
      resourceSource: "teacher-submitted-url",
      title: browserSmokeKnowledgeResource.title,
      sourceFingerprint: `sha256:${createHash("sha256")
        .update(browserSmokeKnowledgeResource.sourceUrl, "utf8")
        .digest("hex")}`,
      rightsBasis: browserSmokeKnowledgeResource.rightsBasis,
      visibility: browserSmokeKnowledgeResource.visibility,
      reviewPolicy: "teacher-review-before-knowledge-index",
      queuedBy: actorId,
      queuedAt: createdAt,
    };
  }
  if (operationId === "invite-code" && actionSlot === "primary" && inviteCode) {
    return {
      operationRecordId: recordId,
      courseId,
      objectType: "invite-code-draft",
      objectId: `invite-code-draft-${courseId}-${inviteCode}`,
      inviteCode,
      joinUrl: `/courses?invite=${inviteCode}`,
      generatedBy: actorId,
      draftStatus: "generated",
      invitePolicy: "teacher-review-before-publication",
      generatedAt: createdAt,
    };
  }
  if (operationId === "invite-code" && actionSlot === "secondary" && inviteCode) {
    return {
      operationRecordId: recordId,
      courseId,
      objectType: "enrollment-access",
      objectId: `enrollment-access-${courseId}-${inviteCode}`,
      inviteCode,
      joinUrl: `/courses?invite=${inviteCode}`,
      publishedBy: actorId,
      publicationStatus: "published",
      enrollmentPolicy: "teacher-confirmed-course-scope",
      publishedAt: createdAt,
    };
  }

  const objectType = getBrowserSmokeExpectedDomainObjectTypes(operationId, actionSlot)[0] ?? operationId;
  return {
    operationRecordId: recordId,
    courseId,
    objectType,
    objectId: `${objectType}-${courseId}`,
  };
}

function createBrowserSmokeAuthSession(sessionId) {
  return {
    sessionId,
    authenticatedAt: "2026-06-30T08:00:00.000Z",
    expiresAt: "2026-06-30T09:00:00.000Z",
  };
}

function createBrowserSmokeReceiptAudit(sessionId) {
  return {
    authMode: "signed-teacher-session",
    authSession: createBrowserSmokeAuthSession(sessionId),
  };
}

function createBrowserSmokeDomainPersistenceSummary({
  receiptId,
  operationId,
  actionSlot,
  courseId,
}) {
  const objectTypes = getBrowserSmokeExpectedDomainObjectTypes(operationId, actionSlot);
  return {
    status: objectTypes.length > 0 ? "persisted" : "not-required",
    required: objectTypes.length > 0,
    operationId,
    actionSlot,
    operationReceiptId: receiptId,
    courseId,
    expectedObjectTypes: objectTypes,
    persistedObjectTypes: objectTypes,
    missingObjectTypes: [],
  };
}

function getBrowserSmokeExpectedDomainObjectTypes(operationId, actionSlot) {
  const mapping = {
    "course-settings:primary": ["course-settings"],
    "course-settings:secondary": ["student-preview-session"],
    "knowledge-base:primary": ["knowledge-index"],
    "knowledge-base:secondary": ["resource-review-item"],
    "students:primary": ["student-roster"],
    "students:secondary": ["group-suggestions"],
    "dashboard:primary": ["dashboard-state"],
    "dashboard:secondary": ["dashboard-snapshot"],
    "agents:primary": ["agent-plan"],
    "agents:secondary": ["permission-preflight"],
    "content:primary": ["course-content"],
    "content:secondary": ["unit-draft"],
    "admins:primary": ["admin-settings"],
    "admins:secondary": ["email-notification"],
    "data-export:primary": ["export-manifest"],
    "data-export:secondary": ["redaction-validation"],
    "quiz-board:primary": ["quiz-board-state"],
    "quiz-board:secondary": ["quiz-item-review"],
    "grading:primary": ["grading-queue", "gradebook-update"],
    "grading:secondary": ["ai-feedback-draft"],
    "invite-code:primary": ["invite-code-draft"],
    "invite-code:secondary": ["enrollment-access"],
  };
  return mapping[`${operationId}:${actionSlot}`] ?? [];
}

function hasVerifiedAuthSession(authSession) {
  return (
    isRecord(authSession) &&
    typeof authSession.sessionId === "string" &&
    authSession.sessionId.trim().length > 0 &&
    typeof authSession.authenticatedAt === "string" &&
    authSession.authenticatedAt.trim().length > 0 &&
    typeof authSession.expiresAt === "string" &&
    authSession.expiresAt.trim().length > 0
  );
}

async function waitForTeachingOperationReceiptAuditResponse(
  page,
  { operationId, actionSlot },
) {
  if (typeof page.waitForResponse !== "function") {
    return false;
  }
  const response = await page.waitForResponse(
    (candidate) => {
      try {
        const url = new URL(candidate.url());
        const request =
          typeof candidate.request === "function" ? candidate.request() : undefined;
        const method =
          request && typeof request.method === "function" ? request.method() : "POST";
        return url.pathname === "/api/teaching/operations" && method === "POST";
      } catch {
        return false;
      }
    },
    { timeout: 15_000 },
  );
  const responseBody =
    response && typeof response.json === "function"
      ? await response.json().catch(() => undefined)
      : undefined;
  const receipt = responseBody?.receipt;
  return (
    isRecord(receipt) &&
    receipt.operationId === operationId &&
    receipt.actionSlot === actionSlot &&
    hasSignedTeachingOperationReceiptAudit(receipt.audit)
  );
}

async function waitForCourseCoverAssetAuditResponse(page) {
  if (typeof page.waitForResponse !== "function") {
    return false;
  }
  const response = await page.waitForResponse(
    (candidate) => {
      try {
        const url = new URL(candidate.url());
        const request =
          typeof candidate.request === "function" ? candidate.request() : undefined;
        const method =
          request && typeof request.method === "function" ? request.method() : "POST";
        return url.pathname === "/api/teaching/course-cover" && method === "POST";
      } catch {
        return false;
      }
    },
    { timeout: 15_000 },
  );
  const responseBody =
    response && typeof response.json === "function"
      ? await response.json().catch(() => undefined)
      : undefined;
  return hasPersistedCourseCoverAssetAudit(responseBody);
}

function hasPersistedCourseCoverAssetAudit(payload) {
  if (!isRecord(payload) || !isRecord(payload.asset) || !isRecord(payload.audit)) {
    return false;
  }
  const assetId = typeof payload.asset.assetId === "string" ? payload.asset.assetId.trim() : "";
  const assetCourseId =
    typeof payload.asset.courseId === "string" ? payload.asset.courseId.trim() : "";
  return (
    Boolean(payload.cover?.imageUrl) &&
    Boolean(assetId) &&
    Boolean(assetCourseId) &&
    payload.assetPersistence?.status === "persisted" &&
    payload.assetPersistence?.responsibleSession === "S12" &&
    payload.audit.eventType === "teaching-course-cover.generated" &&
    payload.audit.assetId === assetId &&
    payload.audit.courseId === assetCourseId &&
    payload.audit.authMode === "signed-teacher-session" &&
    hasVerifiedAuthSession(payload.audit.authSession)
  );
}

function hasSignedTeachingOperationReceiptAudit(audit) {
  return (
    isRecord(audit) &&
    audit.authMode === "signed-teacher-session" &&
    hasVerifiedAuthSession(audit.authSession)
  );
}

async function fulfillJson(routeRequest, body, { status = 200 } = {}) {
  await routeRequest.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function waitForAnyText(page, patterns) {
  await page.getByText(combineRegex(patterns)).first().waitFor({ timeout: 15_000 });
}

async function hasAnyText(page, patterns) {
  return (await page.getByText(combineRegex(patterns)).count()) > 0;
}

async function isButtonDisabled(button) {
  return await button.evaluate((element) => {
    if (element instanceof HTMLButtonElement) {
      return element.disabled;
    }
    return element.getAttribute("aria-disabled") === "true";
  });
}

async function waitUntil(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for teaching operation browser condition.");
}

function createDeferred() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return {
    promise,
    resolve: () => resolve(),
  };
}

function combineRegex(patterns) {
  return new RegExp(patterns.map((pattern) => pattern.source).join("|"));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function installTeacherAuthSessionCookies({ context, baseUrl, env }) {
  const normalizedBaseUrl = stripTrailingSlashes(baseUrl);
  const teacherId = readBrowserSmokeTeacherId(env);
  const response = await fetch(`${normalizedBaseUrl}/api/ai/teacher-auth/issue`, {
    method: "POST",
    headers: {
      ...createSignedAdminHeaders({
        actorId: "s22-operation-browser-smoke-admin",
        secret: requireEnv(env, "UAIS_AI_ACCESS_SIGNING_SECRET"),
      }),
      ...createTrustedTeacherAuthIssuerHeaders({
        teacherId,
        secret: requireEnv(env, "UAIS_TEACHER_AUTH_ISSUER_SECRET"),
      }),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      teacherId,
      ttlSeconds: teacherAuthIssuerProofTtlSeconds,
    }),
  });
  if (!response.ok) {
    throw new Error("Teaching operation browser smoke could not issue teacher auth cookies.");
  }
  await response.arrayBuffer().catch(() => undefined);

  const cookies = createPlaywrightCookiesFromSetCookieHeaders({
    setCookieHeaders: readSetCookieHeaders(response.headers),
    baseUrl: normalizedBaseUrl,
  });
  if (cookies.length < 2) {
    throw new Error("Teaching operation browser smoke did not receive signed teacher auth cookies.");
  }
  await context.addCookies(cookies);
  return "issued-teacher-auth-cookie";
}

function createPlaywrightCookiesFromSetCookieHeaders({ setCookieHeaders, baseUrl }) {
  const secure = new URL(baseUrl).protocol === "https:";
  return setCookieHeaders
    .map((header) => header.split(";")[0]?.trim())
    .filter(Boolean)
    .flatMap((cookiePair) => {
      const separatorIndex = cookiePair.indexOf("=");
      if (separatorIndex === -1) {
        return [];
      }
      const name = cookiePair.slice(0, separatorIndex);
      if (
        name !== "uais_teacher_auth_claims" &&
        name !== "uais_teacher_auth_signature"
      ) {
        return [];
      }
      return [
        {
          name,
          value: cookiePair.slice(separatorIndex + 1),
          url: baseUrl,
          httpOnly: true,
          secure,
          sameSite: "Lax",
        },
      ];
    });
}

function readSetCookieHeaders(headers) {
  const setCookies = headers.getSetCookie?.();
  if (setCookies?.length) {
    return setCookies;
  }

  const combined = headers.get("set-cookie");
  return combined
    ? combined.split(/,\s*(?=uais_teacher_auth_(?:claims|signature)=)/)
    : [];
}

function createSignedAdminHeaders({ actorId, secret }) {
  const issuedAt = new Date();
  const claims = {
    actor: {
      actorId,
      role: "admin",
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 300_000).toISOString(),
  };
  const claimsHeader = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return {
    "x-uais-access-claims": claimsHeader,
    "x-uais-access-signature": createHmac("sha256", secret)
      .update(claimsHeader)
      .digest("base64url"),
  };
}

function createTrustedTeacherAuthIssuerHeaders({ teacherId, secret }) {
  const issuedAt = new Date();
  const claims = {
    issuerId: "trusted-cookie-issuer",
    teacherId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(
      issuedAt.getTime() + teacherAuthIssuerProofTtlSeconds * 1000,
    ).toISOString(),
  };
  const claimsHeader = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return {
    "x-uais-teacher-auth-issuer-claims": claimsHeader,
    "x-uais-teacher-auth-issuer-signature": createHmac("sha256", secret)
      .update(claimsHeader)
      .digest("base64url"),
  };
}

function createApiModePrerequisites({ env, apiMode }) {
  if (apiMode !== "live-teaching-operations") {
    return [];
  }

  return [
    {
      id: "s12-teaching-operation-browser-auth-bootstrap",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_PROVIDER",
      status: env.UAIS_TEACHER_AUTH_PROVIDER === "trusted-cookie-issuer" ? "present" : "missing",
    },
    {
      id: "s19-teaching-operation-browser-ai-access-secret",
      responsibleSession: "S19",
      requiredEnv: "UAIS_AI_ACCESS_SIGNING_SECRET",
      status: hasValue(env.UAIS_AI_ACCESS_SIGNING_SECRET) ? "present" : "missing",
    },
    {
      id: "s19-teaching-operation-browser-session-secret",
      responsibleSession: "S19",
      requiredEnv: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      status: hasValue(env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET) ? "present" : "missing",
    },
    {
      id: "s12-teaching-operation-browser-issuer-secret",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      status: hasValue(env.UAIS_TEACHER_AUTH_ISSUER_SECRET) ? "present" : "missing",
    },
  ];
}

function createApiInterceptionPolicy(apiMode) {
  if (apiMode === "live-teaching-operations") {
    return {
      operationApi: "live-teaching-operations",
      courseManagementApi: "live-teaching-course-management",
      auditReadback: "live-teaching-operations",
      auditAlertReadback: "live-teaching-operations",
      alertNotificationOutbox: "live-teaching-operations",
      failureProbe: "browser-negative-response",
      remoteMutations: "live-approved-teaching-operation",
      responseBodiesOmitted: true,
    };
  }

  return {
    operationApi: "fixture-backed-contract",
    courseManagementApi: "fixture-backed-contract",
    auditReadback: "fixture-backed-contract",
    auditAlertReadback: "fixture-backed-contract",
    alertNotificationOutbox: "fixture-backed-contract",
    failureProbe: "browser-negative-response",
    remoteMutations: "fixture-blocked",
    responseBodiesOmitted: true,
  };
}

function evaluateVercelProductionDeploymentEvidence({
  evidence,
  deploymentFingerprint,
  deploymentDomainReachabilityEvidence,
  releaseRunId,
}) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      deploymentObservationStatus: "missing",
      valueRedacted: true,
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const deploymentObservationStatus = readDeploymentObservationStatus(evidence);
  const releaseRunIdStatus = releaseRunId
    ? evidence.releaseRunId === releaseRunId
      ? "matched"
      : "mismatched"
    : "missing";
  const summary = {
    target,
    deploymentObservationStatus,
    releaseRunIdStatus,
    valueRedacted: true,
  };
  if (target !== "vercel-production-deployment") {
    return { ...summary, status: "invalid-target" };
  }
  if (evidence.mode !== "live" || evidence.status !== "deployed") {
    return { ...summary, status: "not-deployed" };
  }
  if (deploymentObservationStatus !== "observed") {
    return { ...summary, status: "not-observed" };
  }
  if (releaseRunId && releaseRunIdStatus !== "matched") {
    return { ...summary, status: "release-run-id-mismatch" };
  }

  const evidenceFingerprint = isRecord(evidence.deploymentFingerprint)
    ? evidence.deploymentFingerprint
    : undefined;
  if (
    !evidenceFingerprint ||
    evidenceFingerprint.status !== "present" ||
    typeof evidenceFingerprint.value !== "string"
  ) {
    return { ...summary, status: "fingerprint-missing" };
  }
  if (deploymentFingerprint.status !== "present") {
    return { ...summary, status: "deployment-fingerprint-missing" };
  }
  if (evidenceFingerprint.value !== deploymentFingerprint.value) {
    if (deploymentDomainReachabilityEvidence?.status === "matched") {
      return {
        ...summary,
        status: "matched-via-domain-reachability",
        deploymentDomainReachabilityStatus: "matched",
      };
    }
    return { ...summary, status: "mismatched" };
  }

  return {
    ...summary,
    status: "matched",
  };
}

function evaluateDeploymentDomainReachabilityEvidence({
  evidence,
  deploymentFingerprint,
  releaseRunId,
}) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      releaseRunIdStatus: "missing",
      deploymentFingerprintStatus: "missing",
      valueRedacted: true,
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const releaseRunIdStatus = releaseRunId
    ? evidence.releaseRunId === releaseRunId
      ? "matched"
      : "mismatched"
    : "missing";
  const summary = {
    target,
    releaseRunIdStatus,
    deploymentFingerprintStatus: "missing",
    valueRedacted: true,
  };
  if (target !== "deployment-domain-reachability") {
    return { ...summary, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "reachable"
  ) {
    return { ...summary, status: "not-reachable" };
  }
  if (releaseRunId && releaseRunIdStatus !== "matched") {
    return { ...summary, status: "release-run-id-mismatch" };
  }

  const evidenceFingerprint = isRecord(evidence.deploymentFingerprint)
    ? evidence.deploymentFingerprint
    : undefined;
  if (
    !evidenceFingerprint ||
    evidenceFingerprint.status !== "present" ||
    typeof evidenceFingerprint.value !== "string"
  ) {
    return { ...summary, status: "fingerprint-missing" };
  }
  if (deploymentFingerprint.status !== "present") {
    return { ...summary, status: "deployment-fingerprint-missing" };
  }
  if (evidenceFingerprint.value !== deploymentFingerprint.value) {
    return {
      ...summary,
      status: "mismatched",
      deploymentFingerprintStatus: "mismatched",
    };
  }

  return {
    ...summary,
    status: "matched",
    deploymentFingerprintStatus: "matched",
  };
}

function evaluateTeacherAuthProviderReadinessEvidence({ evidence, releaseRunId }) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      authProviderMode: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const authProviderMode = acceptedTeacherAuthProviderModes.includes(evidence.authProviderMode)
    ? evidence.authProviderMode
    : "missing";
  const releaseRunIdStatus = releaseRunId
    ? evidence.releaseRunId === releaseRunId
      ? "matched"
      : "mismatched"
    : "missing";
  const summary = {
    target,
    authProviderMode,
    releaseRunIdStatus,
    valueRedacted: true,
  };
  if (target !== "teacher-auth-provider-readiness") {
    return { ...summary, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "ready"
  ) {
    return { ...summary, status: "not-ready" };
  }
  if (!acceptedTeacherAuthProviderModes.includes(authProviderMode)) {
    return { ...summary, status: "auth-provider-mode-missing" };
  }
  if (releaseRunId && releaseRunIdStatus !== "matched") {
    return { ...summary, status: "release-run-id-mismatch" };
  }
  return { ...summary, status: "matched" };
}

function evaluateAppAuthProviderReadinessEvidence({ evidence, environment, releaseRunId }) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      appAuthProviderMode: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const appAuthProviderMode = acceptedAppAuthProviderModes.includes(
    evidence.appAuthProviderMode,
  )
    ? evidence.appAuthProviderMode
    : "missing";
  const releaseRunIdStatus = releaseRunId
    ? evidence.releaseRunId === releaseRunId
      ? "matched"
      : "mismatched"
    : "missing";
  const summary = {
    target,
    appAuthProviderMode,
    releaseRunIdStatus,
    valueRedacted: true,
  };
  if (target !== "app-auth-provider-readiness") {
    return { ...summary, status: "invalid-target" };
  }
  const requiredEnvironment =
    environment === "local-production" ? "local-production" : "production";
  if (
    evidence.mode !== "live" ||
    evidence.environment !== requiredEnvironment ||
    evidence.status !== "ready"
  ) {
    return { ...summary, status: "not-ready" };
  }
  if (!acceptedAppAuthProviderModes.includes(appAuthProviderMode)) {
    return { ...summary, status: "app-auth-provider-mode-missing" };
  }
  if (releaseRunId && releaseRunIdStatus !== "matched") {
    return { ...summary, status: "release-run-id-mismatch" };
  }
  return { ...summary, status: "matched" };
}

function readDeploymentObservationStatus(evidence) {
  return isRecord(evidence.deploymentObservation) &&
    typeof evidence.deploymentObservation.status === "string"
    ? evidence.deploymentObservation.status
    : "missing";
}

function readVercelProductionDeploymentBlockedReasons(evidenceStatus) {
  if (
    !evidenceStatus ||
    evidenceStatus.status === "matched" ||
    evidenceStatus.status === "matched-via-domain-reachability"
  ) {
    return [];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["vercel-production-deployment-fingerprint-mismatch"];
  }
  return [`vercel-production-deployment-evidence-${evidenceStatus.status}`];
}

function readDeploymentDomainReachabilityBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "missing") {
    return ["deployment-domain-reachability-evidence-missing"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["deployment-domain-reachability-release-run-mismatch"];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["deployment-domain-reachability-fingerprint-mismatch"];
  }
  return [`deployment-domain-reachability-evidence-${evidenceStatus.status}`];
}

function readTeacherAuthProviderReadinessBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "missing") {
    return ["teacher-auth-provider-readiness-evidence-missing"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["teacher-auth-provider-readiness-release-run-mismatch"];
  }
  return ["teacher-auth-provider-readiness-not-proven"];
}

function readAppAuthProviderReadinessBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "missing") {
    return ["app-auth-provider-readiness-evidence-missing"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["app-auth-provider-readiness-release-run-mismatch"];
  }
  return ["app-auth-provider-readiness-not-proven"];
}

function readProductionDeploymentOriginBlockedReasons({ environment, deploymentOrigin }) {
  if (
    environment !== "production" ||
    deploymentOrigin.status !== "present" ||
    deploymentOrigin.originClass === "remote-https"
  ) {
    return [];
  }
  return ["production-deployment-origin-not-remote-https"];
}

function readPrerequisiteBlockedReason(prerequisite) {
  if (prerequisite.requiredEnv && prerequisite.status !== "present") {
    return [`missing-${prerequisite.requiredEnv}`];
  }
  if (
    prerequisite.id === "s22-browser-automation-runtime" &&
    prerequisite.status === "missing"
  ) {
    return ["teaching-operation-detail-browser-runtime-missing"];
  }
  return [];
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    environment: "unspecified",
    envFile: undefined,
    baseUrl: undefined,
    releaseRunId: undefined,
    vercelProductionDeployment: undefined,
    deploymentDomainReachability: undefined,
    apiMode: "fixture-backed-contract",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.live = false;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--environment") {
      options.environment = normalizeEnvironment(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--env-file") {
      options.envFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--base-url") {
      options.baseUrl = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--release-run-id") {
      options.releaseRunId = normalizeReleaseRunId(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--vercel-production-deployment") {
      options.vercelProductionDeployment = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--deployment-domain-reachability") {
      options.deploymentDomainReachability = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--teacher-auth-provider-readiness") {
      options.teacherAuthProviderReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--app-auth-provider-readiness") {
      options.appAuthProviderReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--api-mode") {
      options.apiMode = normalizeApiMode(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/teaching-operation-detail-browser-smoke.mjs [--dry-run] [--live --approved --base-url URL] [--environment production|preview|local-production|unspecified] [--env-file PATH] [--release-run-id ID] [--vercel-production-deployment PATH] [--deployment-domain-reachability PATH] [--teacher-auth-provider-readiness PATH] [--app-auth-provider-readiness PATH] [--api-mode fixture-backed-contract|live-teaching-operations]",
          "",
          "Outputs redacted deployed /teaching/[operation] browser-click smoke JSON. Live mode uses Playwright; production release evidence should use live-teaching-operations so the ordinary teaching API is exercised with signed teacher cookies.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readJsonEvidence(evidencePath) {
  if (!evidencePath) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(evidencePath, "utf8"));
  } catch {
    return null;
  }
}

function readEnvFile(envFile) {
  if (!envFile) {
    return {};
  }

  const parsed = {};
  const content = readFileSync(envFile, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      parsed[key] = stripQuotes(value);
    }
  }

  return parsed;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function normalizeEnvironment(value) {
  const environment = value.trim().toLowerCase();
  if (
    environment !== "production" &&
    environment !== "preview" &&
    environment !== "local-production" &&
    environment !== "unspecified"
  ) {
    throw new Error("--environment must be production, preview, local-production, or unspecified.");
  }
  return environment;
}

function normalizeApiMode(value) {
  const apiMode = value.trim().toLowerCase();
  if (!apiModes.has(apiMode)) {
    throw new Error("--api-mode must be fixture-backed-contract or live-teaching-operations.");
  }
  return apiMode;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function normalizeReleaseRunId(value) {
  const releaseRunId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)) {
    throw new Error("--release-run-id must be a non-secret release identifier.");
  }
  return releaseRunId;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readBrowserSmokeTeacherId(env) {
  return env.UAIS_TEACHING_OPERATION_BROWSER_SMOKE_TEACHER_ID?.trim() || defaultTeacherId;
}

function requireEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Teaching operation browser smoke requires ${name}.`);
  }
  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canResolvePlaywrightRuntime() {
  return resolvePlaywrightRuntime() !== undefined;
}

function loadPlaywrightRuntime() {
  const resolution = resolvePlaywrightRuntime();
  if (!resolution) {
    throw new Error("Playwright runtime is unavailable.");
  }
  return resolution.runtimeRequire(resolution.specifier);
}

function resolvePlaywrightRuntime() {
  const runtimeRequire = createRequire(import.meta.url);
  const explicitNodePath = process.env.NODE_PATH?.trim();
  const specifiers = explicitNodePath
    ? explicitNodePath
        .split(delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => resolve(entry, "playwright"))
    : ["playwright"];

  for (const specifier of specifiers) {
    try {
      runtimeRequire.resolve(specifier);
      return { runtimeRequire, specifier };
    } catch {
      // NODE_PATH is an explicit runtime selection for the documented npx
      // launcher and deterministic contract fixtures; do not fall through to
      // an unrelated repository-local package when the override is invalid.
    }
  }
  return undefined;
}

function createRuntimeSetup() {
  return {
    packageName: "playwright",
    moduleResolution: "node-require-resolution",
    moduleStatus: canResolvePlaywrightRuntime() ? "present" : "missing",
    npxStatus: canRunNpx() ? "present" : "missing",
    packageInstallCommand: "npm install --save-dev playwright",
    browserInstallCommand: "npx playwright install chromium",
    liveCommand:
      "node -- scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --api-mode live-teaching-operations",
    transientRuntimeCommand:
      "npx --yes --package playwright --call 'NODE_PATH=\"$(dirname \"$(dirname \"$(command -v playwright)\")\")\" node -- scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --api-mode live-teaching-operations'",
  };
}

function canRunNpx() {
  const result = spawnSync("npx", ["--version"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}

function createDeploymentFingerprint(baseUrl) {
  if (!hasValue(baseUrl)) {
    return { status: "missing" };
  }
  return {
    status: "present",
    value: `sha256:${createHash("sha256")
      .update(stripTrailingSlashes(baseUrl))
      .digest("hex")
      .slice(0, 16)}`,
  };
}

function createRenderedPageFingerprint(body) {
  if (!hasValue(body)) {
    return { status: "missing" };
  }
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(body).digest("hex").slice(0, 16)}`,
  };
}

function describeDeploymentOrigin(baseUrl) {
  if (!hasValue(baseUrl)) {
    return { status: "missing", originClass: "missing", valueRedacted: true };
  }
  try {
    const url = new URL(baseUrl);
    return {
      status: "present",
      originClass: classifyOrigin(url),
      valueRedacted: true,
    };
  } catch {
    return { status: "invalid", originClass: "invalid", valueRedacted: true };
  }
}

function classifyOrigin(url) {
  if (url.protocol !== "https:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1"
      ? "local-loopback"
      : "insecure-http";
  }
  if (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname.endsWith(".local")
  ) {
    return "local-loopback";
  }
  if (isPrivateHostname(url.hostname)) {
    return "private-network";
  }
  return "remote-https";
}

function isPrivateHostname(hostname) {
  if (/^10\./.test(hostname)) {
    return true;
  }
  if (/^192\.168\./.test(hostname)) {
    return true;
  }
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}
