#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const route = "/api/teaching/operations";
const auditRoute = "/api/teaching/operations/audit";
const auditAlertsRoute = "/api/teaching/operations/audit/alerts";
const auditAlertNotificationsRoute = "/api/teaching/operations/audit/alerts/notifications";
const collaborationInviteDeliveryCallbackRoute =
  "/api/teaching/operations/collaboration-invite-deliveries";
const collaborationInviteDeliveryCallbackAuditProbeUserAgent =
  "UAIS teaching operations route smoke /Users/redacted/secret-token callback";
const inviteJoinRouteTemplate = "/api/teaching/invite-codes/{code}/join";
const rollbackRouteTemplate = "/api/teaching/operations/records/{recordId}/rollback";
const exportManifestRouteTemplate = "/api/teaching/operations/export/{manifestId}";
const gradebookUpdateActionRouteTemplate =
  "/api/teaching/gradebook-updates/{gradebookUpdateId}/{action}";
const backupRestoreRouteTemplate = "/api/teaching/operations/backups/{backupId}/restore";
const routes = [
  route,
  auditRoute,
  auditAlertsRoute,
  auditAlertNotificationsRoute,
  collaborationInviteDeliveryCallbackRoute,
  inviteJoinRouteTemplate,
  rollbackRouteTemplate,
  exportManifestRouteTemplate,
  gradebookUpdateActionRouteTemplate,
  backupRestoreRouteTemplate,
];
const unsafeExportManifestId = "../unsafe-export-manifest-id";
const unsafeGradebookUpdateId = "../unsafe-gradebook-object-id";
const unsafeBackupId = "../unsafe-backup-id";
const teachingOperationsSchema = {
  schemaVersion: "uais-teaching-operations-v1",
  backupSchemaVersion: "uais-teaching-operations-backup-v1",
  supportedSchemaVersions: ["uais-teaching-operations-v1"],
  migrationPolicy: "explicit-versioned-schema-normalization",
  unsupportedSchemaVersionPolicy: "fail-closed",
  responsibleSession: "S12",
};
const acceptedTeacherAuthProviderModes = ["trusted-cookie-issuer", "oidc-jwks"];
const acceptedAppAuthProviderModes = ["trusted-account-provider"];
let expectedSmokeTeacherId = "teacher-kang";
const proves = [
  "unauthenticated-post-denied",
  "unauthenticated-post-no-write-side-effects",
  "signed-teacher-cookie-required",
  "signed-student-post-denied",
  "signed-student-post-no-write-side-effects",
  "unsafe-app-session-post-denied",
  "unsafe-app-session-post-trace-header-returned",
  "unsafe-app-session-post-no-write-side-effects",
  "signed-teacher-course-id-required",
  "signed-teacher-course-id-required-no-write-side-effects",
  "signed-teacher-course-scope-denied",
  "signed-teacher-course-scope-no-write-side-effects",
  "course-ownership-bound-operation-persisted",
  "durable-external-persistence-returned",
  "domain-persistence-summary-returned",
  "operations-schema-migration-policy-returned",
  "append-ledger-sequence-returned",
  "append-ledger-sequence-readback-returned",
  "audit-trace-returned",
  "audit-auth-session-returned",
  "audit-request-source-provenance-returned",
  "unauthenticated-response-trace-header-returned",
  "signed-student-response-trace-header-returned",
  "unauthenticated-audit-readback-denied",
  "unauthenticated-audit-readback-trace-header-returned",
  "signed-student-audit-readback-denied",
  "signed-student-audit-readback-trace-header-returned",
  "unsafe-app-session-audit-readback-denied",
  "unsafe-app-session-audit-readback-trace-header-returned",
  "unauthenticated-alert-notification-enqueue-denied",
  "unauthenticated-alert-notification-trace-header-returned",
  "signed-student-alert-notification-enqueue-denied",
  "signed-student-alert-notification-trace-header-returned",
  "unauthenticated-alert-notification-readback-denied",
  "unauthenticated-alert-notification-readback-trace-header-returned",
  "signed-student-alert-notification-readback-denied",
  "signed-student-alert-notification-readback-trace-header-returned",
  "authorized-response-trace-header-returned",
  "audit-readback-returned",
  "audit-auth-session-readback-returned",
  "audit-readback-response-trace-header-returned",
  "domain-projection-readback-returned",
  "external-domain-projection-readback-returned",
  "course-settings-domain-object-returned",
  "course-settings-patch-readback-returned",
  "student-preview-session-domain-object-returned",
  "student-preview-session-audit-source-returned",
  "student-roster-domain-object-returned",
  "student-roster-domain-persistence-summary-returned",
  "student-roster-provider-sync-returned",
  "student-roster-provider-sync-audit-source-returned",
  "student-group-suggestion-domain-object-returned",
  "student-group-suggestion-audit-source-returned",
  "knowledge-index-domain-object-returned",
  "knowledge-index-domain-persistence-summary-returned",
  "knowledge-index-provider-sync-returned",
  "knowledge-index-provider-sync-audit-source-returned",
  "resource-review-item-domain-object-returned",
  "resource-review-item-audit-source-returned",
  "course-content-domain-object-returned",
  "course-content-domain-persistence-summary-returned",
  "course-content-provider-publish-returned",
  "course-content-provider-publish-audit-source-returned",
  "course-unit-draft-domain-object-returned",
  "course-unit-draft-audit-source-returned",
  "dashboard-state-domain-object-returned",
  "dashboard-state-domain-persistence-summary-returned",
  "dashboard-state-audit-source-returned",
  "dashboard-snapshot-domain-object-returned",
  "dashboard-snapshot-audit-source-returned",
  "quiz-assessment-domain-object-returned",
  "quiz-assessment-domain-persistence-summary-returned",
  "quiz-item-review-domain-object-returned",
  "quiz-item-review-domain-persistence-summary-returned",
  "quiz-item-review-audit-source-returned",
  "agent-settings-domain-object-returned",
  "agent-settings-audit-source-returned",
  "agent-permission-preflight-domain-object-returned",
  "agent-permission-preflight-audit-source-returned",
  "admin-settings-domain-object-returned",
  "admin-settings-audit-source-returned",
  "collaboration-invite-notification-domain-object-returned",
  "collaboration-invite-domain-persistence-summary-returned",
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
  "course-export-provider-audit-source-returned",
  "course-export-manifest-audit-source-returned",
  "unauthenticated-export-manifest-download-denied",
  "unauthenticated-export-manifest-download-trace-header-returned",
  "signed-student-export-manifest-download-denied",
  "signed-student-export-manifest-download-trace-header-returned",
  "export-manifest-download-readback-returned",
  "unsafe-export-manifest-id-denied",
  "export-redaction-validation-domain-object-returned",
  "export-redaction-validation-audit-source-returned",
  "grading-queue-domain-object-returned",
  "gradebook-update-domain-object-returned",
  "grading-domain-persistence-summary-returned",
  "grading-feedback-draft-domain-object-returned",
  "grading-feedback-provider-returned",
  "grading-feedback-provider-audit-source-returned",
  "idempotent-retry-returned",
  "idempotent-retry-append-sequence-stable-returned",
  "concurrent-idempotent-retry-append-sequence-stable-returned",
  "idempotency-conflict-denied",
  "unauthenticated-rollback-denied",
  "unauthenticated-rollback-trace-header-returned",
  "unauthenticated-rollback-no-write-side-effects",
  "signed-student-rollback-denied",
  "signed-student-rollback-trace-header-returned",
  "signed-student-rollback-no-write-side-effects",
  "rollback-record-persisted",
  "rollback-production-database-adapter-returned",
  "rollback-response-trace-header-returned",
  "rollback-trace-closure-returned",
  "rollback-readback-returned",
  "rollback-readback-response-trace-header-returned",
  "unauthenticated-alert-summary-readback-denied",
  "unauthenticated-alert-summary-readback-trace-header-returned",
  "signed-student-alert-summary-readback-denied",
  "signed-student-alert-summary-readback-trace-header-returned",
  "alert-summary-readback-returned",
  "unauthenticated-alert-notification-no-write-side-effects",
  "signed-student-alert-notification-no-write-side-effects",
  "alert-notification-queued-returned",
  "alert-notification-readback-returned",
  "invite-code-draft-domain-object-returned",
  "invite-code-draft-audit-source-returned",
  "invite-publish-class-join-entry-returned",
  "invite-publish-domain-persistence-summary-returned",
  "invite-code-publish-audit-source-returned",
  "student-invite-join-returned",
  "unauthenticated-gradebook-release-denied",
  "unauthenticated-gradebook-release-trace-header-returned",
  "unauthenticated-gradebook-rollback-denied",
  "unauthenticated-gradebook-rollback-trace-header-returned",
  "signed-student-gradebook-release-denied",
  "signed-student-gradebook-release-trace-header-returned",
  "signed-student-gradebook-rollback-denied",
  "signed-student-gradebook-rollback-trace-header-returned",
  "unauthenticated-gradebook-release-no-write-side-effects",
  "unauthenticated-gradebook-rollback-no-write-side-effects",
  "signed-student-gradebook-release-no-write-side-effects",
  "signed-student-gradebook-rollback-no-write-side-effects",
  "unsafe-gradebook-release-object-id-denied",
  "unsafe-gradebook-rollback-object-id-denied",
  "gradebook-release-trace-closure-returned",
  "gradebook-release-audit-source-returned",
  "gradebook-release-external-storage-returned",
  "gradebook-provider-release-returned",
  "gradebook-rollback-trace-closure-returned",
  "gradebook-rollback-audit-source-returned",
  "gradebook-rollback-external-storage-returned",
  "gradebook-provider-rollback-returned",
  "external-backup-created-returned",
  "unauthenticated-backup-restore-denied",
  "unauthenticated-backup-restore-trace-header-returned",
  "unauthenticated-backup-restore-no-write-side-effects",
  "signed-student-backup-restore-denied",
  "signed-student-backup-restore-trace-header-returned",
  "signed-student-backup-restore-no-write-side-effects",
  "direct-backup-restore-disabled-returned",
  "direct-backup-restore-trace-closure-returned",
  "direct-backup-restore-no-write-side-effects",
  "unsafe-backup-restore-id-denied",
  "unsafe-backup-restore-no-write-side-effects",
  "external-restore-drill-verified-returned",
  "response-values-redacted",
  "release-run-id-bound",
  "same-vercel-production-deployment-bound",
  "same-teacher-auth-provider-readiness-bound",
  "same-app-auth-provider-readiness-bound",
  "same-external-storage-service-readiness-bound",
];

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Teaching operations route smoke requires explicit owner approval.");
  }
  if (options.live && options.environment === "production" && !hasValue(options.releaseRunId)) {
    throw new Error("Teaching operations route smoke requires --release-run-id.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const mode = options.live ? "live" : "dry-run";
  const baseUrl = options.baseUrl || env.UAIS_DEPLOYMENT_BASE_URL;
  const cookie = options.cookie || env.UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE;
  const studentCookie =
    options.studentCookie || env.UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE;
  const teacherId =
    options.teacherId || env.UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID;
  const courseId = options.courseId || env.UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID;
  const classId = options.classId || env.UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID;
  const teachingOperationsBackend =
    options.teachingOperationsBackend || env.UAIS_TEACHING_OPERATIONS_BACKEND;
  const teachingCourseManagementBackend =
    options.teachingCourseManagementBackend || env.UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND;
  const externalStorageBaseUrl =
    options.externalStorageBaseUrl || env.UAIS_EXTERNAL_STORAGE_BASE_URL;
  const externalStorageAccessToken =
    options.externalStorageAccessToken || env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN;
  const collaborationInviteEmailProvider =
    options.collaborationInviteEmailProvider || env.UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER;
  const collaborationInviteEmailProviderUrl =
    options.collaborationInviteEmailProviderUrl ||
    env.UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL;
  const collaborationInviteEmailProviderToken =
    options.collaborationInviteEmailProviderToken ||
    env.UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN;
  const collaborationInviteEmailCallbackToken =
    options.collaborationInviteEmailCallbackToken ||
    env.UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN;
  const studentRosterSyncProvider =
    options.studentRosterSyncProvider || env.UAIS_STUDENT_ROSTER_SYNC_PROVIDER;
  const studentRosterSyncProviderUrl =
    options.studentRosterSyncProviderUrl || env.UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL;
  const studentRosterSyncProviderToken =
    options.studentRosterSyncProviderToken || env.UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN;
  const knowledgeIndexSyncProvider =
    options.knowledgeIndexSyncProvider || env.UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER;
  const knowledgeIndexSyncProviderUrl =
    options.knowledgeIndexSyncProviderUrl || env.UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL;
  const knowledgeIndexSyncProviderToken =
    options.knowledgeIndexSyncProviderToken ||
    env.UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN;
  const gradebookReleaseProvider =
    options.gradebookReleaseProvider || env.UAIS_GRADEBOOK_RELEASE_PROVIDER;
  const gradebookReleaseProviderUrl =
    options.gradebookReleaseProviderUrl || env.UAIS_GRADEBOOK_RELEASE_PROVIDER_URL;
  const gradebookReleaseProviderToken =
    options.gradebookReleaseProviderToken || env.UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN;
  const courseContentPublishProvider =
    options.courseContentPublishProvider || env.UAIS_COURSE_CONTENT_PUBLISH_PROVIDER;
  const courseContentPublishProviderUrl =
    options.courseContentPublishProviderUrl ||
    env.UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL;
  const courseContentPublishProviderToken =
    options.courseContentPublishProviderToken ||
    env.UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN;
  const courseExportProvider =
    options.courseExportProvider || env.UAIS_COURSE_EXPORT_PROVIDER;
  const courseExportProviderUrl =
    options.courseExportProviderUrl || env.UAIS_COURSE_EXPORT_PROVIDER_URL;
  const courseExportProviderToken =
    options.courseExportProviderToken || env.UAIS_COURSE_EXPORT_PROVIDER_TOKEN;
  const gradingFeedbackProvider =
    options.gradingFeedbackProvider || env.UAIS_GRADING_FEEDBACK_PROVIDER;
  const gradingFeedbackProviderUrl =
    options.gradingFeedbackProviderUrl || env.UAIS_GRADING_FEEDBACK_PROVIDER_URL;
  const gradingFeedbackProviderToken =
    options.gradingFeedbackProviderToken || env.UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN;
  const vercelProductionDeployment = readJsonEvidence(options.vercelProductionDeployment);
  const deploymentDomainReachability = readJsonEvidence(options.deploymentDomainReachability);
  const teacherAuthProviderReadiness = readJsonEvidence(options.teacherAuthProviderReadiness);
  const appAuthProviderReadiness = readJsonEvidence(options.appAuthProviderReadiness);
  const externalStorageServiceReadiness = readJsonEvidence(
    options.externalStorageServiceReadiness,
  );
  const plan = buildPlan({
    mode,
    environment: options.environment,
    releaseRunId: options.releaseRunId,
    baseUrl,
    cookie,
    studentCookie,
    teacherId,
    courseId,
    classId,
    teachingOperationsBackend,
    teachingCourseManagementBackend,
    externalStorageBaseUrl,
    externalStorageAccessToken,
    collaborationInviteEmailProvider,
    collaborationInviteEmailProviderUrl,
    collaborationInviteEmailProviderToken,
    collaborationInviteEmailCallbackToken,
    studentRosterSyncProvider,
    studentRosterSyncProviderUrl,
    studentRosterSyncProviderToken,
    knowledgeIndexSyncProvider,
    knowledgeIndexSyncProviderUrl,
    knowledgeIndexSyncProviderToken,
    gradebookReleaseProvider,
    gradebookReleaseProviderUrl,
    gradebookReleaseProviderToken,
    courseContentPublishProvider,
    courseContentPublishProviderUrl,
    courseContentPublishProviderToken,
    courseExportProvider,
    courseExportProviderUrl,
    courseExportProviderToken,
    gradingFeedbackProvider,
    gradingFeedbackProviderUrl,
    gradingFeedbackProviderToken,
    vercelProductionDeployment,
    deploymentDomainReachability,
    teacherAuthProviderReadiness,
    appAuthProviderReadiness,
    externalStorageServiceReadiness,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  if (plan.status === "blocked") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const evidence = await executeLiveSmoke({
      plan,
      baseUrl,
      cookie,
      studentCookie,
      teacherId,
      courseId,
      classId,
      externalStorageBaseUrl,
      externalStorageAccessToken,
      collaborationInviteEmailCallbackToken,
    });
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (evidence.status !== "passed") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Teaching operations route smoke failed."}\n`,
  );
  process.exitCode = 1;
}

function buildPlan({
  mode,
  environment,
  releaseRunId,
  baseUrl,
  cookie,
  studentCookie,
  teacherId,
  courseId,
  classId,
  teachingOperationsBackend,
  teachingCourseManagementBackend,
  externalStorageBaseUrl,
  externalStorageAccessToken,
  collaborationInviteEmailProvider,
  collaborationInviteEmailProviderUrl,
  collaborationInviteEmailProviderToken,
  collaborationInviteEmailCallbackToken,
  studentRosterSyncProvider,
  studentRosterSyncProviderUrl,
  studentRosterSyncProviderToken,
  knowledgeIndexSyncProvider,
  knowledgeIndexSyncProviderUrl,
  knowledgeIndexSyncProviderToken,
  gradebookReleaseProvider,
  gradebookReleaseProviderUrl,
  gradebookReleaseProviderToken,
  courseContentPublishProvider,
  courseContentPublishProviderUrl,
  courseContentPublishProviderToken,
  courseExportProvider,
  courseExportProviderUrl,
  courseExportProviderToken,
  gradingFeedbackProvider,
  gradingFeedbackProviderUrl,
  gradingFeedbackProviderToken,
  vercelProductionDeployment,
  deploymentDomainReachability,
  teacherAuthProviderReadiness,
  appAuthProviderReadiness,
  externalStorageServiceReadiness,
}) {
  const deploymentFingerprint = createDeploymentFingerprint(baseUrl);
  const deploymentOrigin = describeDeploymentOrigin(baseUrl);
  const storageServiceFingerprint = createStorageServiceFingerprint(externalStorageBaseUrl);
  const deploymentDomainReachabilityEvidence = evaluateDeploymentDomainReachabilityEvidence({
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
          releaseRunIdStatus: "missing",
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
  const auth = describeTeachingOperationsRouteSmokeAuth({
    cookie,
    teacherAuthProviderReadinessEvidence,
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
  const externalStorageServiceReadinessEvidence =
    externalStorageServiceReadiness === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          releaseRunIdStatus: "missing",
        }
      : evaluateExternalStorageServiceReadinessEvidence({
          evidence: externalStorageServiceReadiness,
          releaseRunId,
          storageServiceFingerprint,
        });
  const requiredEnv = [
    {
      name: "UAIS_DEPLOYMENT_BASE_URL",
      status: hasValue(baseUrl) ? "present" : "missing",
    },
    {
      name: "UAIS_TEACHING_OPERATIONS_BACKEND",
      status:
        hasValue(teachingOperationsBackend) && teachingOperationsBackend === "external"
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      requiredValue: "external",
    },
    {
      name: "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
      status:
        hasValue(teachingCourseManagementBackend) &&
        teachingCourseManagementBackend === "external"
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      requiredValue: "external",
    },
    {
      name: "UAIS_EXTERNAL_STORAGE_BASE_URL",
      status:
        teachingOperationsBackend === "external" && hasValue(externalStorageBaseUrl)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
      status:
        teachingOperationsBackend === "external" &&
        isStrongExternalStorageToken(externalStorageAccessToken)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
      status:
        hasValue(collaborationInviteEmailProvider) &&
        collaborationInviteEmailProvider === "external"
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      requiredValue: "external",
    },
    {
      name: "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL",
      status:
        collaborationInviteEmailProvider === "external" &&
        hasValue(collaborationInviteEmailProviderUrl)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
      status:
        collaborationInviteEmailProvider === "external" &&
        isStrongExternalStorageToken(collaborationInviteEmailProviderToken)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
      status:
        collaborationInviteEmailProvider === "external" &&
        isStrongExternalStorageToken(collaborationInviteEmailCallbackToken)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
      status:
        hasValue(studentRosterSyncProvider) && studentRosterSyncProvider === "external"
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      requiredValue: "external",
    },
    {
      name: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL",
      status:
        studentRosterSyncProvider === "external" && hasValue(studentRosterSyncProviderUrl)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
      status:
        studentRosterSyncProvider === "external" &&
        isStrongExternalStorageToken(studentRosterSyncProviderToken)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
      status:
        hasValue(knowledgeIndexSyncProvider) &&
        knowledgeIndexSyncProvider === "external"
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      requiredValue: "external",
    },
    {
      name: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL",
      status:
        knowledgeIndexSyncProvider === "external" &&
        hasValue(knowledgeIndexSyncProviderUrl)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
      status:
        knowledgeIndexSyncProvider === "external" &&
        isStrongExternalStorageToken(knowledgeIndexSyncProviderToken)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_GRADEBOOK_RELEASE_PROVIDER",
      status:
        hasValue(gradebookReleaseProvider) && gradebookReleaseProvider === "external"
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      requiredValue: "external",
    },
    {
      name: "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL",
      status:
        gradebookReleaseProvider === "external" && hasValue(gradebookReleaseProviderUrl)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
      status:
        gradebookReleaseProvider === "external" &&
        isStrongExternalStorageToken(gradebookReleaseProviderToken)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
      status:
        hasValue(courseContentPublishProvider) &&
        courseContentPublishProvider === "external"
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      requiredValue: "external",
    },
    {
      name: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL",
      status:
        courseContentPublishProvider === "external" &&
        hasValue(courseContentPublishProviderUrl)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
      status:
        courseContentPublishProvider === "external" &&
        isStrongExternalStorageToken(courseContentPublishProviderToken)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_COURSE_EXPORT_PROVIDER",
      status:
        hasValue(courseExportProvider) && courseExportProvider === "external"
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      requiredValue: "external",
    },
    {
      name: "UAIS_COURSE_EXPORT_PROVIDER_URL",
      status:
        courseExportProvider === "external" && hasValue(courseExportProviderUrl)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
      status:
        courseExportProvider === "external" &&
        isStrongExternalStorageToken(courseExportProviderToken)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_GRADING_FEEDBACK_PROVIDER",
      status:
        hasValue(gradingFeedbackProvider) && gradingFeedbackProvider === "external"
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      requiredValue: "external",
    },
    {
      name: "UAIS_GRADING_FEEDBACK_PROVIDER_URL",
      status:
        gradingFeedbackProvider === "external" && hasValue(gradingFeedbackProviderUrl)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
      status:
        gradingFeedbackProvider === "external" &&
        isStrongExternalStorageToken(gradingFeedbackProviderToken)
          ? "present"
          : environment === "production"
            ? "missing"
            : "optional",
      valueRedacted: true,
    },
    {
      name: "UAIS_TEACHING_OPERATIONS_SMOKE_COOKIE",
      status: hasValue(cookie) ? "present" : "missing",
      valueRedacted: true,
    },
    {
      name: "UAIS_TEACHING_OPERATIONS_SMOKE_STUDENT_COOKIE",
      status: hasValue(studentCookie) ? "present" : "missing",
      valueRedacted: true,
    },
    {
      name: "UAIS_TEACHING_OPERATIONS_SMOKE_TEACHER_ID",
      status: hasValue(teacherId)
        ? "present"
        : environment === "production"
          ? "missing"
          : "optional",
    },
    {
      name: "UAIS_TEACHING_OPERATIONS_SMOKE_COURSE_ID",
      status: hasValue(courseId) ? "present" : "missing",
    },
    {
      name: "UAIS_TEACHING_OPERATIONS_SMOKE_CLASS_ID",
      status: hasValue(classId) ? "present" : "missing",
    },
  ];
  const blockedReasons = requiredEnv
    .filter((entry) => entry.status !== "present" && entry.status !== "optional")
    .map((entry) => `missing-${entry.name}`)
    .concat(readVercelProductionDeploymentBlockedReasons(vercelProductionDeploymentEvidence))
    .concat(readTeacherAuthProviderReadinessBlockedReasons(teacherAuthProviderReadinessEvidence))
    .concat(readAppAuthProviderReadinessBlockedReasons(appAuthProviderReadinessEvidence))
    .concat(readExternalStorageServiceReadinessBlockedReasons(externalStorageServiceReadinessEvidence))
    .concat(readProductionDeploymentOriginBlockedReasons({ environment, deploymentOrigin }));

  return {
    target: "teaching-operations-route-smoke",
    mode,
    environment,
    network: mode === "live" ? "enabled" : "disabled",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSessions: ["S12", "S22"],
    ...(releaseRunId ? { releaseRunId } : {}),
    route,
    routes,
    auditRoute,
    inviteJoinRoute: inviteJoinRouteTemplate,
    collaborationInviteDeliveryCallbackRoute,
    rollbackRoute: rollbackRouteTemplate,
    deploymentFingerprint,
    deploymentOrigin,
    ...(deploymentDomainReachabilityEvidence
      ? { deploymentDomainReachabilityEvidence }
      : {}),
    externalStorageFingerprint: createDeploymentFingerprint(externalStorageBaseUrl),
    storageServiceFingerprint,
    teachingOperationsSchema,
    ...(vercelProductionDeploymentEvidence
      ? { vercelProductionDeploymentEvidence }
      : {}),
    ...(teacherAuthProviderReadinessEvidence
      ? { teacherAuthProviderReadinessEvidence }
      : {}),
    auth,
    ...(appAuthProviderReadinessEvidence
      ? { appAuthProviderReadinessEvidence }
      : {}),
    ...(externalStorageServiceReadinessEvidence
      ? { externalStorageServiceReadinessEvidence }
      : {}),
    teachingOperationsBackend:
      teachingOperationsBackend === "external" ? "external" : "not-proven",
    teachingCourseManagementBackend:
      teachingCourseManagementBackend === "external" ? "external" : "not-proven",
    teacherId: hasValue(teacherId) ? teacherId : "not-proven",
    requiredEnv,
    proves,
    blockedReasons,
    safety: createSafety(),
  };
}

function describeTeachingOperationsRouteSmokeAuth({
  cookie,
  teacherAuthProviderReadinessEvidence,
}) {
  if (!hasValue(cookie)) {
    return "missing";
  }
  if (
    teacherAuthProviderReadinessEvidence?.target === "teacher-auth-provider-readiness" &&
    teacherAuthProviderReadinessEvidence?.status === "matched" &&
    teacherAuthProviderReadinessEvidence?.authProviderMode === "trusted-cookie-issuer" &&
    teacherAuthProviderReadinessEvidence?.releaseRunIdStatus === "matched" &&
    teacherAuthProviderReadinessEvidence?.valueRedacted === true
  ) {
    return "issued-teacher-auth-cookie";
  }
  return "signed-teacher-auth-cookie";
}

async function executeLiveSmoke({
  plan,
  baseUrl,
  cookie,
  studentCookie,
  teacherId,
  courseId,
  classId,
  externalStorageBaseUrl,
  externalStorageAccessToken,
  collaborationInviteEmailCallbackToken,
}) {
  const idempotencyKey = createSmokeIdempotencyKey({
    courseId,
    environment: plan.environment,
    releaseRunId: plan.releaseRunId,
  });
  const body = {
    operationId: "course-settings",
    actionSlot: "primary",
    courseId,
    sourceAction: "route-smoke",
    idempotencyKey,
    courseSettingsPatch: {
      courseName: "Route Smoke Applied Course Settings",
      semester: "2026 Fall",
      description: "Route smoke verifies persisted course settings patch readback.",
    },
  };
  const unauthenticatedBody = {
    ...body,
    sourceAction: "route-smoke-unauthenticated-denial",
    idempotencyKey: createSmokeUnauthenticatedDeniedIdempotencyKey({
      courseId,
      environment: plan.environment,
      releaseRunId: plan.releaseRunId,
    }),
  };
  const signedStudentBody = {
    ...body,
    sourceAction: "route-smoke-student-role-denial",
    idempotencyKey: createSmokeStudentDeniedIdempotencyKey({
      courseId,
      environment: plan.environment,
      releaseRunId: plan.releaseRunId,
    }),
  };
  const unsafeAppSessionCookie = createUnsafeStudentAppSessionCookie({
    environment: plan.environment,
    releaseRunId: plan.releaseRunId,
  });
  const unsafeAppSessionBody = {
    ...body,
    sourceAction: "route-smoke-unsafe-app-session-denial",
    idempotencyKey: createSmokeUnsafeAppSessionDeniedIdempotencyKey({
      courseId,
      environment: plan.environment,
      releaseRunId: plan.releaseRunId,
    }),
  };
  const unauthenticated = await postTeachingOperation({
    baseUrl,
    body: unauthenticatedBody,
  });
  const signedStudent = studentCookie
    ? await postTeachingOperation({
        baseUrl,
        body: signedStudentBody,
        cookie: studentCookie,
        traceId: "trace-teaching-operations-route-smoke-student-denied",
      })
    : createSkippedSmokeResponse();
  const unsafeAppSession = await postTeachingOperation({
    baseUrl,
    body: unsafeAppSessionBody,
    cookie: unsafeAppSessionCookie,
    traceId: "trace-teaching-operations-route-smoke-unsafe-app-session-denied",
  });
  const unauthenticatedAuditReadback = await getTeachingOperationAudit({ baseUrl });
  const signedStudentAuditReadback = studentCookie
    ? await getTeachingOperationAudit({ baseUrl, cookie: studentCookie })
    : createSkippedSmokeResponse();
  const unsafeAppSessionAuditReadback = await getTeachingOperationAudit({
    baseUrl,
    cookie: unsafeAppSessionCookie,
    traceId: "trace-teaching-operations-route-smoke-unsafe-app-session-audit-denied",
  });
  const missingCourseIdBody = {
    operationId: "course-settings",
    actionSlot: "primary",
    sourceAction: "route-smoke-course-id-required-denial",
    idempotencyKey: createSmokeMissingCourseIdIdempotencyKey({
      courseId,
      environment: plan.environment,
      releaseRunId: plan.releaseRunId,
    }),
  };
  const missingCourseId = await postTeachingOperation({
    baseUrl,
    body: missingCourseIdBody,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-course-id-required",
  });
  const forbiddenCourseBody = {
    ...body,
    courseId: "route-smoke-foreign-course",
    sourceAction: "route-smoke-course-scope-denial",
    idempotencyKey: createSmokeDeniedIdempotencyKey({
      courseId,
      environment: plan.environment,
      releaseRunId: plan.releaseRunId,
    }),
  };
  const forbiddenCourse = await postTeachingOperation({
    baseUrl,
    body: forbiddenCourseBody,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-course-denied",
  });
  const authorized = await postTeachingOperation({
    baseUrl,
    body,
    cookie,
    traceId: "trace-teaching-operations-route-smoke",
  });
  const idempotentRetry = await postTeachingOperation({
    baseUrl,
    body,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-idempotent-retry",
  });
  const [
    concurrentIdempotentRetryA,
    concurrentIdempotentRetryB,
  ] = await Promise.all([
    postTeachingOperation({
      baseUrl,
      body,
      cookie,
      traceId: "trace-teaching-operations-route-smoke-concurrent-idempotent-retry-a",
    }),
    postTeachingOperation({
      baseUrl,
      body,
      cookie,
      traceId: "trace-teaching-operations-route-smoke-concurrent-idempotent-retry-b",
    }),
  ]);
  const idempotencyConflict = await postTeachingOperation({
    baseUrl,
    body: {
      ...body,
      actionSlot: "secondary",
    },
    cookie,
    traceId: "trace-teaching-operations-route-smoke-idempotency-conflict",
  });
  const studentPreviewSession = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-student-preview",
    body: {
      operationId: "course-settings",
      actionSlot: "secondary",
      courseId,
      sourceAction: "route-smoke-student-preview",
      idempotencyKey: createSmokeStudentPreviewIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const studentRosterSync = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-student-roster",
    body: {
      operationId: "students",
      actionSlot: "primary",
      courseId,
      sourceAction: "route-smoke-student-roster",
      idempotencyKey: createSmokeStudentRosterIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const studentGroupSuggestion = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-student-group-suggestion",
    body: {
      operationId: "students",
      actionSlot: "secondary",
      courseId,
      sourceAction: "route-smoke-student-group-suggestion",
      idempotencyKey: createSmokeStudentGroupSuggestionIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const knowledgeIndexSync = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-knowledge-index",
    body: {
      operationId: "knowledge-base",
      actionSlot: "primary",
      courseId,
      sourceAction: "route-smoke-knowledge-index",
      idempotencyKey: createSmokeKnowledgeIndexIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const resourceReviewItem = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-resource-review",
    body: {
      operationId: "knowledge-base",
      actionSlot: "secondary",
      courseId,
      sourceAction: "route-smoke-resource-review",
      idempotencyKey: createSmokeResourceReviewItemIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const courseContentPublish = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-course-content",
    body: {
      operationId: "content",
      actionSlot: "primary",
      courseId,
      sourceAction: "route-smoke-course-content",
      idempotencyKey: createSmokeCourseContentIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const courseUnitDraft = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-course-unit-draft",
    body: {
      operationId: "content",
      actionSlot: "secondary",
      courseId,
      sourceAction: "route-smoke-course-unit-draft",
      idempotencyKey: createSmokeCourseUnitDraftIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const dashboardRefresh = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-dashboard-state",
    body: {
      operationId: "dashboard",
      actionSlot: "primary",
      courseId,
      sourceAction: "route-smoke-dashboard-state",
      idempotencyKey: createSmokeDashboardStateIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const dashboardSnapshot = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-dashboard-snapshot",
    body: {
      operationId: "dashboard",
      actionSlot: "secondary",
      courseId,
      sourceAction: "route-smoke-dashboard-snapshot",
      idempotencyKey: createSmokeDashboardSnapshotIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const quizAssessment = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-quiz-assessment",
    body: {
      operationId: "quiz-board",
      actionSlot: "primary",
      courseId,
      sourceAction: "route-smoke-quiz-assessment",
      idempotencyKey: createSmokeQuizAssessmentIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const quizItemReview = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-quiz-item-review",
    body: {
      operationId: "quiz-board",
      actionSlot: "secondary",
      courseId,
      sourceAction: "route-smoke-quiz-item-review",
      idempotencyKey: createSmokeQuizItemReviewIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const agentSettings = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-agent-settings",
    body: {
      operationId: "agents",
      actionSlot: "primary",
      courseId,
      sourceAction: "route-smoke-agent-settings",
      idempotencyKey: createSmokeAgentSettingsIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const agentPermissionPreflight = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-agent-permission-preflight",
    body: {
      operationId: "agents",
      actionSlot: "secondary",
      courseId,
      sourceAction: "route-smoke-agent-permission-preflight",
      idempotencyKey: createSmokeAgentPermissionPreflightIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const adminSettings = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-admin-settings",
    body: {
      operationId: "admins",
      actionSlot: "primary",
      courseId,
      sourceAction: "route-smoke-admin-settings",
      idempotencyKey: createSmokeAdminSettingsIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const collaborationInviteNotification = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-collaboration-invite",
    body: {
      operationId: "admins",
      actionSlot: "secondary",
      courseId,
      sourceAction: "route-smoke-collaboration-invite",
      idempotencyKey: createSmokeCollaborationInviteIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const courseExportManifest = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-export-manifest",
    body: {
      operationId: "data-export",
      actionSlot: "primary",
      courseId,
      sourceAction: "route-smoke-export-manifest",
      idempotencyKey: createSmokeCourseExportManifestIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const courseExportRedactionValidation = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-export-redaction",
    body: {
      operationId: "data-export",
      actionSlot: "secondary",
      courseId,
      sourceAction: "route-smoke-export-redaction",
      idempotencyKey: createSmokeCourseExportRedactionIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const gradebookUpdateId = createGradebookUpdateId(courseId);
  const gradebookSeed = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-gradebook-seed",
    body: {
      operationId: "grading",
      actionSlot: "primary",
      courseId,
      sourceAction: "route-smoke-gradebook-release",
      idempotencyKey: createSmokeGradebookIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const gradingFeedbackDraft = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-grading-feedback",
    body: {
      operationId: "grading",
      actionSlot: "secondary",
      courseId,
      sourceAction: "route-smoke-grading-feedback",
      idempotencyKey: createSmokeGradingFeedbackDraftIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const auditReadback = await getTeachingOperationAudit({ baseUrl, cookie });
  const receipt = isRecord(authorized.body) && isRecord(authorized.body.receipt)
    ? authorized.body.receipt
    : undefined;
  const retryReceipt = isRecord(idempotentRetry.body) && isRecord(idempotentRetry.body.receipt)
    ? idempotentRetry.body.receipt
    : undefined;
  const concurrentIdempotentRetryReceipts = [
    concurrentIdempotentRetryA,
    concurrentIdempotentRetryB,
  ].map((response) =>
    isRecord(response.body) && isRecord(response.body.receipt)
      ? response.body.receipt
      : undefined,
  );
  const studentRosterOperationReceipt =
    isRecord(studentRosterSync.body) && isRecord(studentRosterSync.body.receipt)
      ? studentRosterSync.body.receipt
      : undefined;
  const studentPreviewSessionOperationReceipt =
    isRecord(studentPreviewSession.body) && isRecord(studentPreviewSession.body.receipt)
      ? studentPreviewSession.body.receipt
      : undefined;
  const studentPreviewSessionReceipt =
    isRecord(studentPreviewSession.body) &&
    isRecord(studentPreviewSession.body.studentPreviewSessionReceipt)
      ? studentPreviewSession.body.studentPreviewSessionReceipt
      : undefined;
  const studentRosterSyncReceipt =
    isRecord(studentRosterSync.body) && isRecord(studentRosterSync.body.studentRosterSyncReceipt)
      ? studentRosterSync.body.studentRosterSyncReceipt
      : undefined;
  const studentRosterProviderSyncReceipt =
    isRecord(studentRosterSync.body) &&
    isRecord(studentRosterSync.body.studentRosterProviderSyncReceipt)
      ? studentRosterSync.body.studentRosterProviderSyncReceipt
      : undefined;
  const studentGroupSuggestionOperationReceipt =
    isRecord(studentGroupSuggestion.body) && isRecord(studentGroupSuggestion.body.receipt)
      ? studentGroupSuggestion.body.receipt
      : undefined;
  const studentGroupSuggestionReceipt =
    isRecord(studentGroupSuggestion.body) &&
    isRecord(studentGroupSuggestion.body.studentGroupSuggestionReceipt)
      ? studentGroupSuggestion.body.studentGroupSuggestionReceipt
      : undefined;
  const knowledgeIndexOperationReceipt =
    isRecord(knowledgeIndexSync.body) && isRecord(knowledgeIndexSync.body.receipt)
      ? knowledgeIndexSync.body.receipt
      : undefined;
  const knowledgeIndexSyncReceipt =
    isRecord(knowledgeIndexSync.body) && isRecord(knowledgeIndexSync.body.knowledgeIndexSyncReceipt)
      ? knowledgeIndexSync.body.knowledgeIndexSyncReceipt
      : undefined;
  const knowledgeIndexProviderSyncReceipt =
    isRecord(knowledgeIndexSync.body) &&
    isRecord(knowledgeIndexSync.body.knowledgeIndexProviderSyncReceipt)
      ? knowledgeIndexSync.body.knowledgeIndexProviderSyncReceipt
      : undefined;
  const resourceReviewItemOperationReceipt =
    isRecord(resourceReviewItem.body) && isRecord(resourceReviewItem.body.receipt)
      ? resourceReviewItem.body.receipt
      : undefined;
  const resourceReviewItemReceipt =
    isRecord(resourceReviewItem.body) && isRecord(resourceReviewItem.body.resourceReviewItemReceipt)
      ? resourceReviewItem.body.resourceReviewItemReceipt
      : undefined;
  const courseContentOperationReceipt =
    isRecord(courseContentPublish.body) && isRecord(courseContentPublish.body.receipt)
      ? courseContentPublish.body.receipt
      : undefined;
  const courseContentPublishReceipt =
    isRecord(courseContentPublish.body) &&
    isRecord(courseContentPublish.body.courseContentPublishReceipt)
      ? courseContentPublish.body.courseContentPublishReceipt
      : undefined;
  const courseContentProviderPublishReceipt =
    isRecord(courseContentPublish.body) &&
    isRecord(courseContentPublish.body.courseContentProviderPublishReceipt)
      ? courseContentPublish.body.courseContentProviderPublishReceipt
      : undefined;
  const courseUnitDraftOperationReceipt =
    isRecord(courseUnitDraft.body) && isRecord(courseUnitDraft.body.receipt)
      ? courseUnitDraft.body.receipt
      : undefined;
  const courseUnitDraftReceipt =
    isRecord(courseUnitDraft.body) && isRecord(courseUnitDraft.body.courseUnitDraftReceipt)
      ? courseUnitDraft.body.courseUnitDraftReceipt
      : undefined;
  const dashboardOperationReceipt =
    isRecord(dashboardRefresh.body) && isRecord(dashboardRefresh.body.receipt)
      ? dashboardRefresh.body.receipt
      : undefined;
  const dashboardRefreshReceipt =
    isRecord(dashboardRefresh.body) && isRecord(dashboardRefresh.body.dashboardRefreshReceipt)
      ? dashboardRefresh.body.dashboardRefreshReceipt
      : undefined;
  const dashboardSnapshotOperationReceipt =
    isRecord(dashboardSnapshot.body) && isRecord(dashboardSnapshot.body.receipt)
      ? dashboardSnapshot.body.receipt
      : undefined;
  const dashboardSnapshotReceipt =
    isRecord(dashboardSnapshot.body) && isRecord(dashboardSnapshot.body.dashboardSnapshotReceipt)
      ? dashboardSnapshot.body.dashboardSnapshotReceipt
      : undefined;
  const quizAssessmentOperationReceipt =
    isRecord(quizAssessment.body) && isRecord(quizAssessment.body.receipt)
      ? quizAssessment.body.receipt
      : undefined;
  const quizAssessmentReceipt =
    isRecord(quizAssessment.body) && isRecord(quizAssessment.body.quizAssessmentReceipt)
      ? quizAssessment.body.quizAssessmentReceipt
      : undefined;
  const quizItemReviewOperationReceipt =
    isRecord(quizItemReview.body) && isRecord(quizItemReview.body.receipt)
      ? quizItemReview.body.receipt
      : undefined;
  const quizItemReviewReceipt =
    isRecord(quizItemReview.body) && isRecord(quizItemReview.body.quizItemReviewReceipt)
      ? quizItemReview.body.quizItemReviewReceipt
      : undefined;
  const agentSettingsOperationReceipt =
    isRecord(agentSettings.body) && isRecord(agentSettings.body.receipt)
      ? agentSettings.body.receipt
      : undefined;
  const agentSettingsReceipt =
    isRecord(agentSettings.body) && isRecord(agentSettings.body.agentSettingsReceipt)
      ? agentSettings.body.agentSettingsReceipt
      : undefined;
  const agentPermissionPreflightOperationReceipt =
    isRecord(agentPermissionPreflight.body) && isRecord(agentPermissionPreflight.body.receipt)
      ? agentPermissionPreflight.body.receipt
      : undefined;
  const agentPermissionPreflightReceipt =
    isRecord(agentPermissionPreflight.body) &&
    isRecord(agentPermissionPreflight.body.agentPermissionPreflightReceipt)
      ? agentPermissionPreflight.body.agentPermissionPreflightReceipt
      : undefined;
  const adminSettingsOperationReceipt =
    isRecord(adminSettings.body) && isRecord(adminSettings.body.receipt)
      ? adminSettings.body.receipt
      : undefined;
  const adminSettingsReceipt =
    isRecord(adminSettings.body) && isRecord(adminSettings.body.adminSettingsReceipt)
      ? adminSettings.body.adminSettingsReceipt
      : undefined;
  const collaborationInviteOperationReceipt =
    isRecord(collaborationInviteNotification.body) &&
    isRecord(collaborationInviteNotification.body.receipt)
      ? collaborationInviteNotification.body.receipt
      : undefined;
  const collaborationInviteNotificationReceipt =
    isRecord(collaborationInviteNotification.body) &&
    isRecord(collaborationInviteNotification.body.collaborationInviteNotificationReceipt)
      ? collaborationInviteNotification.body.collaborationInviteNotificationReceipt
      : undefined;
  const collaborationInviteEmailDeliveryReceipt =
    isRecord(collaborationInviteNotification.body) &&
    isRecord(collaborationInviteNotification.body.collaborationInviteEmailDeliveryReceipt)
      ? collaborationInviteNotification.body.collaborationInviteEmailDeliveryReceipt
      : undefined;
  const unauthenticatedCollaborationInviteEmailBounceCallback =
    collaborationInviteEmailDeliveryReceipt
      ? await postTeachingCollaborationInviteDeliveryCallback({
          baseUrl,
          authorized: false,
          courseId,
          operationRecordId:
            typeof collaborationInviteOperationReceipt?.receiptId === "string"
              ? collaborationInviteOperationReceipt.receiptId
              : undefined,
          outboxId:
            typeof collaborationInviteEmailDeliveryReceipt.outboxId === "string"
              ? collaborationInviteEmailDeliveryReceipt.outboxId
              : undefined,
          deliveryId:
            typeof collaborationInviteEmailDeliveryReceipt.deliveryId === "string"
              ? collaborationInviteEmailDeliveryReceipt.deliveryId
              : undefined,
        })
      : createSkippedSmokeResponse();
  const signedStudentCollaborationInviteEmailBounceCallback =
    collaborationInviteEmailDeliveryReceipt && studentCookie
      ? await postTeachingCollaborationInviteDeliveryCallback({
          baseUrl,
          authorized: false,
          cookie: studentCookie,
          traceId:
            "trace-teaching-operations-route-smoke-collaboration-invite-bounce-student-denied",
          courseId,
          operationRecordId:
            typeof collaborationInviteOperationReceipt?.receiptId === "string"
              ? collaborationInviteOperationReceipt.receiptId
              : undefined,
          outboxId:
            typeof collaborationInviteEmailDeliveryReceipt.outboxId === "string"
              ? collaborationInviteEmailDeliveryReceipt.outboxId
              : undefined,
          deliveryId:
            typeof collaborationInviteEmailDeliveryReceipt.deliveryId === "string"
              ? collaborationInviteEmailDeliveryReceipt.deliveryId
              : undefined,
        })
      : createSkippedSmokeResponse();
  const invalidTokenCollaborationInviteEmailBounceCallback =
    collaborationInviteEmailDeliveryReceipt
      ? await postTeachingCollaborationInviteDeliveryCallback({
          baseUrl,
          authorized: true,
          collaborationInviteEmailCallbackToken,
          authorizationToken: "invalid-email-callback-token-with-32-chars",
          traceId:
            "trace-teaching-operations-route-smoke-collaboration-invite-bounce-invalid-token-denied",
          courseId,
          operationRecordId:
            typeof collaborationInviteOperationReceipt?.receiptId === "string"
              ? collaborationInviteOperationReceipt.receiptId
              : undefined,
          outboxId:
            typeof collaborationInviteEmailDeliveryReceipt.outboxId === "string"
              ? collaborationInviteEmailDeliveryReceipt.outboxId
              : undefined,
          deliveryId:
            typeof collaborationInviteEmailDeliveryReceipt.deliveryId === "string"
              ? collaborationInviteEmailDeliveryReceipt.deliveryId
              : undefined,
        })
      : createSkippedSmokeResponse();
  const unsafeCollaborationInviteEmailBounceCallback =
    collaborationInviteEmailDeliveryReceipt
      ? await postTeachingCollaborationInviteDeliveryCallback({
          baseUrl,
          authorized: true,
          collaborationInviteEmailCallbackToken,
          traceId:
            "trace-teaching-operations-route-smoke-collaboration-invite-bounce-unsafe-denied",
          courseId,
          operationRecordId:
            typeof collaborationInviteOperationReceipt?.receiptId === "string"
              ? collaborationInviteOperationReceipt.receiptId
              : undefined,
          outboxId:
            typeof collaborationInviteEmailDeliveryReceipt.outboxId === "string"
              ? collaborationInviteEmailDeliveryReceipt.outboxId
              : undefined,
          deliveryId: "unsafe/../callback-delivery",
        })
      : createSkippedSmokeResponse();
  const collaborationInviteEmailBounceCallback =
    collaborationInviteEmailDeliveryReceipt
      ? await postTeachingCollaborationInviteDeliveryCallback({
          baseUrl,
          authorized: true,
          collaborationInviteEmailCallbackToken,
          courseId,
          operationRecordId:
            typeof collaborationInviteOperationReceipt?.receiptId === "string"
              ? collaborationInviteOperationReceipt.receiptId
              : undefined,
          outboxId:
            typeof collaborationInviteEmailDeliveryReceipt.outboxId === "string"
              ? collaborationInviteEmailDeliveryReceipt.outboxId
              : undefined,
          deliveryId:
            typeof collaborationInviteEmailDeliveryReceipt.deliveryId === "string"
              ? collaborationInviteEmailDeliveryReceipt.deliveryId
              : undefined,
        })
      : createSkippedSmokeResponse();
  const collaborationInviteEmailBounceCallbackReceipt =
    isRecord(collaborationInviteEmailBounceCallback.body) &&
    isRecord(
      collaborationInviteEmailBounceCallback.body
        .collaborationInviteEmailDeliveryCallbackReceipt,
    )
      ? collaborationInviteEmailBounceCallback.body
          .collaborationInviteEmailDeliveryCallbackReceipt
      : undefined;
  const courseExportOperationReceipt =
    isRecord(courseExportManifest.body) && isRecord(courseExportManifest.body.receipt)
      ? courseExportManifest.body.receipt
      : undefined;
  const courseExportManifestReceipt =
    isRecord(courseExportManifest.body) &&
    isRecord(courseExportManifest.body.courseExportManifestReceipt)
      ? courseExportManifest.body.courseExportManifestReceipt
      : undefined;
  const courseExportProviderReceipt =
    isRecord(courseExportManifest.body) &&
    isRecord(courseExportManifest.body.courseExportProviderReceipt)
      ? courseExportManifest.body.courseExportProviderReceipt
      : undefined;
  const exportManifestId = findExportManifestId(courseExportManifest.body);
  const unauthenticatedExportManifestDownload = exportManifestId
    ? await getTeachingOperationExportManifest({
        baseUrl,
        manifestId: exportManifestId,
        traceId: "trace-teaching-operations-route-smoke-export-download-denied",
      })
    : createSkippedSmokeResponse();
  const signedStudentExportManifestDownload =
    exportManifestId && studentCookie
      ? await getTeachingOperationExportManifest({
          baseUrl,
          cookie: studentCookie,
          manifestId: exportManifestId,
          traceId: "trace-teaching-operations-route-smoke-export-download-student-denied",
        })
      : createSkippedSmokeResponse();
  const exportManifestDownload = exportManifestId
    ? await getTeachingOperationExportManifest({
        baseUrl,
        cookie,
        manifestId: exportManifestId,
      })
    : createSkippedSmokeResponse();
  const unsafeExportManifestDownload = await getTeachingOperationExportManifest({
    baseUrl,
    cookie,
    manifestId: unsafeExportManifestId,
    traceId: "trace-teaching-operations-route-smoke-unsafe-export-manifest-id",
  });
  const courseExportRedactionValidationOperationReceipt =
    isRecord(courseExportRedactionValidation.body) &&
    isRecord(courseExportRedactionValidation.body.receipt)
      ? courseExportRedactionValidation.body.receipt
      : undefined;
  const courseExportRedactionValidationReceipt =
    isRecord(courseExportRedactionValidation.body) &&
    isRecord(courseExportRedactionValidation.body.courseExportRedactionValidationReceipt)
      ? courseExportRedactionValidation.body.courseExportRedactionValidationReceipt
      : undefined;
  const gradingQueueOperationReceipt =
    isRecord(gradebookSeed.body) && isRecord(gradebookSeed.body.receipt)
      ? gradebookSeed.body.receipt
      : undefined;
  const gradingQueueReceipt =
    isRecord(gradebookSeed.body) && isRecord(gradebookSeed.body.gradingQueueReceipt)
      ? gradebookSeed.body.gradingQueueReceipt
      : undefined;
  const gradingFeedbackDraftOperationReceipt =
    isRecord(gradingFeedbackDraft.body) && isRecord(gradingFeedbackDraft.body.receipt)
      ? gradingFeedbackDraft.body.receipt
      : undefined;
  const gradingFeedbackDraftReceipt =
    isRecord(gradingFeedbackDraft.body) &&
    isRecord(gradingFeedbackDraft.body.gradingFeedbackDraftReceipt)
      ? gradingFeedbackDraft.body.gradingFeedbackDraftReceipt
      : undefined;
  const gradingFeedbackProviderReceipt =
    isRecord(gradingFeedbackDraft.body) &&
    isRecord(gradingFeedbackDraft.body.gradingFeedbackProviderReceipt)
      ? gradingFeedbackDraft.body.gradingFeedbackProviderReceipt
      : undefined;
  const audit = isRecord(receipt?.audit) ? receipt.audit : undefined;
  const expectedTeacherId = hasValue(teacherId) ? teacherId : "teacher-kang";
  setExpectedSmokeTeacherId(expectedTeacherId);
  const actorId = typeof receipt?.actorId === "string" ? receipt.actorId : expectedTeacherId;
  const externalAuditReadback = await getExternalTeachingOperationAudit({
    externalStorageBaseUrl,
    externalStorageAccessToken,
    actorId,
  });
  const externalCourseManagementReadback = await getExternalTeachingCourseManagementDatabase({
    externalStorageBaseUrl,
    externalStorageAccessToken,
  });
  const rollbackRecordId = findRollbackRecordId({
    body: auditReadback.body,
    courseId,
    receiptId: typeof receipt?.receiptId === "string" ? receipt.receiptId : undefined,
  });
  const unauthenticatedRollback = rollbackRecordId
    ? await postTeachingOperationRollback({
        baseUrl,
        courseId,
        recordId: rollbackRecordId,
        traceId: "trace-teaching-operations-route-smoke-rollback-denied",
      })
    : createSkippedSmokeResponse();
  const signedStudentRollback =
    rollbackRecordId && studentCookie
      ? await postTeachingOperationRollback({
          baseUrl,
          cookie: studentCookie,
          courseId,
          recordId: rollbackRecordId,
          traceId: "trace-teaching-operations-route-smoke-rollback-student-denied",
        })
      : createSkippedSmokeResponse();
  const rollbackDeniedAuditReadback =
    unauthenticatedRollback.statusCode === 401 ||
    signedStudentRollback.statusCode === 403
      ? await getTeachingOperationAudit({ baseUrl, cookie })
      : createSkippedSmokeResponse();
  const rollback = rollbackRecordId
    ? await postTeachingOperationRollback({
        baseUrl,
        cookie,
        courseId,
        recordId: rollbackRecordId,
      })
    : createSkippedSmokeResponse();
  const rollbackReceipt = isRecord(rollback.body) && isRecord(rollback.body.receipt)
    ? rollback.body.receipt
    : undefined;
  const rollbackAuditReadback =
    rollback.statusCode === 200
      ? await getTeachingOperationAudit({ baseUrl, cookie })
      : createSkippedSmokeResponse();
  const alertSeed = await postExternalTeachingOperationAlertSeed({
    externalStorageBaseUrl,
    externalStorageAccessToken,
    actorId,
  });
  const unauthenticatedAlertSummary = await getTeachingOperationAuditAlerts({
    baseUrl,
  });
  const signedStudentAlertSummary = studentCookie
    ? await getTeachingOperationAuditAlerts({
        baseUrl,
        cookie: studentCookie,
      })
    : createSkippedSmokeResponse();
  const alertSummary = await getTeachingOperationAuditAlerts({
    baseUrl,
    cookie,
  });
  const unauthenticatedAlertNotificationPost =
    await postTeachingOperationAuditAlertNotifications({
      baseUrl,
      traceId: "trace-teaching-operations-route-smoke-alert-notifications-denied",
    });
  const alertNotificationDeniedReadback =
    unauthenticatedAlertNotificationPost.statusCode === 401 ||
    unauthenticatedAlertNotificationPost.statusCode === 403
      ? await getTeachingOperationAuditAlertNotifications({
          baseUrl,
          cookie,
        })
      : createSkippedSmokeResponse();
  const signedStudentAlertNotificationPost = studentCookie
    ? await postTeachingOperationAuditAlertNotifications({
        baseUrl,
        cookie: studentCookie,
        traceId:
          "trace-teaching-operations-route-smoke-alert-notifications-student-denied",
      })
    : createSkippedSmokeResponse();
  const signedStudentAlertNotificationDeniedReadback =
    signedStudentAlertNotificationPost.statusCode === 403
      ? await getTeachingOperationAuditAlertNotifications({
          baseUrl,
          cookie,
        })
      : createSkippedSmokeResponse();
  const unauthenticatedAlertNotificationReadback =
    await getTeachingOperationAuditAlertNotifications({
      baseUrl,
    });
  const signedStudentAlertNotificationReadback = studentCookie
    ? await getTeachingOperationAuditAlertNotifications({
        baseUrl,
        cookie: studentCookie,
      })
    : createSkippedSmokeResponse();
  const alertNotificationPost = await postTeachingOperationAuditAlertNotifications({
    baseUrl,
    cookie,
  });
  const alertNotificationReadback = await getTeachingOperationAuditAlertNotifications({
    baseUrl,
    cookie,
  });
  const inviteIdempotencyKey = createSmokeInviteIdempotencyKey({
    courseId,
    environment: plan.environment,
    releaseRunId: plan.releaseRunId,
  });
  const inviteDraft = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-invite-draft",
    body: {
      operationId: "invite-code",
      actionSlot: "primary",
      courseId,
      targetClassId: classId,
      sourceAction: "route-smoke-invite-draft",
      idempotencyKey: createSmokeInviteDraftIdempotencyKey({
        courseId,
        environment: plan.environment,
        releaseRunId: plan.releaseRunId,
      }),
    },
  });
  const generatedInviteCode = findGeneratedInviteCode(inviteDraft.body);
  const inviteDraftReceipt =
    isRecord(inviteDraft.body) && isRecord(inviteDraft.body.inviteCodeDraftReceipt)
      ? inviteDraft.body.inviteCodeDraftReceipt
      : undefined;
  const inviteDraftOperationReceipt =
    isRecord(inviteDraft.body) && isRecord(inviteDraft.body.receipt)
      ? inviteDraft.body.receipt
      : undefined;
  const inviteDraftCourseManagementReadback =
    inviteDraft.statusCode === 200
      ? await getExternalTeachingCourseManagementDatabase({
          externalStorageBaseUrl,
          externalStorageAccessToken,
        })
      : createSkippedSmokeResponse();
  const invitePublish = await postTeachingOperation({
    baseUrl,
    cookie,
    traceId: "trace-teaching-operations-route-smoke-invite-publish",
    body: {
      operationId: "invite-code",
      actionSlot: "secondary",
      courseId,
      targetClassId: classId,
      sourceAction: "route-smoke-invite-publish",
      idempotencyKey: inviteIdempotencyKey,
    },
  });
  const publishedInviteCode = findPublishedInviteCode(invitePublish.body);
  const invitePublishCourseManagementReadback =
    invitePublish.statusCode === 200
      ? await getExternalTeachingCourseManagementDatabase({
          externalStorageBaseUrl,
          externalStorageAccessToken,
        })
      : createSkippedSmokeResponse();
  const studentInviteJoin = publishedInviteCode
    ? await postTeachingInviteJoin({
        baseUrl,
        studentCookie,
        inviteCode: publishedInviteCode,
      })
    : createSkippedSmokeResponse();
  const unauthenticatedGradebookRelease =
    gradebookSeed.statusCode === 200
      ? await postTeachingGradebookUpdateAction({
          baseUrl,
          gradebookUpdateId,
          action: "release",
          traceId: "trace-teaching-operations-route-smoke-gradebook-release-denied",
        })
      : createSkippedSmokeResponse();
  const unauthenticatedGradebookRollback =
    gradebookSeed.statusCode === 200
      ? await postTeachingGradebookUpdateAction({
          baseUrl,
          gradebookUpdateId,
          action: "rollback",
          traceId: "trace-teaching-operations-route-smoke-gradebook-rollback-denied",
        })
      : createSkippedSmokeResponse();
  const signedStudentGradebookRelease =
    gradebookSeed.statusCode === 200 && studentCookie
      ? await postTeachingGradebookUpdateAction({
          baseUrl,
          cookie: studentCookie,
          gradebookUpdateId,
          action: "release",
          traceId: "trace-teaching-operations-route-smoke-gradebook-release-student-denied",
        })
      : createSkippedSmokeResponse();
  const signedStudentGradebookRollback =
    gradebookSeed.statusCode === 200 && studentCookie
      ? await postTeachingGradebookUpdateAction({
          baseUrl,
          cookie: studentCookie,
          gradebookUpdateId,
          action: "rollback",
          traceId: "trace-teaching-operations-route-smoke-gradebook-rollback-student-denied",
        })
      : createSkippedSmokeResponse();
  const gradebookDeniedAuditReadback =
    isUnauthenticatedMutationDeniedReady({ response: unauthenticatedGradebookRelease }) &&
    isUnauthenticatedMutationDeniedReady({ response: unauthenticatedGradebookRollback }) &&
    isSignedStudentMutationDeniedReady({ response: signedStudentGradebookRelease }) &&
    isSignedStudentMutationDeniedReady({ response: signedStudentGradebookRollback })
      ? await getExternalTeachingOperationAudit({
          externalStorageBaseUrl,
          externalStorageAccessToken,
          actorId,
        })
      : createSkippedSmokeResponse();
  const unsafeGradebookReleaseObjectId = await postTeachingGradebookUpdateAction({
    baseUrl,
    cookie,
    gradebookUpdateId: unsafeGradebookUpdateId,
    action: "release",
    traceId: "trace-teaching-operations-route-smoke-unsafe-gradebook-release-id",
  });
  const unsafeGradebookRollbackObjectId = await postTeachingGradebookUpdateAction({
    baseUrl,
    cookie,
    gradebookUpdateId: unsafeGradebookUpdateId,
    action: "rollback",
    traceId: "trace-teaching-operations-route-smoke-unsafe-gradebook-rollback-id",
  });
  const gradebookRelease =
    gradebookSeed.statusCode === 200
      ? await postTeachingGradebookUpdateAction({
          baseUrl,
          cookie,
          gradebookUpdateId,
          action: "release",
          traceId: "trace-teaching-operations-route-smoke-gradebook-release",
        })
      : createSkippedSmokeResponse();
  const gradebookRollback =
    gradebookRelease.statusCode === 200
      ? await postTeachingGradebookUpdateAction({
          baseUrl,
          cookie,
          gradebookUpdateId,
          action: "rollback",
          traceId: "trace-teaching-operations-route-smoke-gradebook-rollback",
        })
      : createSkippedSmokeResponse();
  const gradebookAuditReadback =
    gradebookRollback.statusCode === 200
      ? await getExternalTeachingOperationAudit({
          externalStorageBaseUrl,
          externalStorageAccessToken,
          actorId,
        })
      : createSkippedSmokeResponse();
  const externalBackup = await postExternalTeachingOperationBackup({
    externalStorageBaseUrl,
    externalStorageAccessToken,
    actorId,
  });
  const backupId = isRecord(externalBackup.body) && typeof externalBackup.body.backupId === "string"
    ? externalBackup.body.backupId
    : undefined;
  const unauthenticatedBackupRestore = backupId
    ? await postTeachingOperationBackupRestore({
        baseUrl,
        backupId,
        traceId: "trace-teaching-operations-route-smoke-direct-restore-denied",
      })
    : createSkippedSmokeResponse();
  const signedStudentBackupRestore =
    backupId && studentCookie
      ? await postTeachingOperationBackupRestore({
          baseUrl,
          cookie: studentCookie,
          backupId,
          traceId:
            "trace-teaching-operations-route-smoke-direct-restore-student-denied",
        })
      : createSkippedSmokeResponse();
  const directBackupRestore = backupId
    ? await postTeachingOperationBackupRestore({
        baseUrl,
        cookie,
        backupId,
      })
    : createSkippedSmokeResponse();
  const unsafeBackupRestore = await postTeachingOperationBackupRestore({
    baseUrl,
    cookie,
    backupId: unsafeBackupId,
    traceId: "trace-teaching-operations-route-smoke-unsafe-backup-restore-id",
  });
  const backupRestoreDeniedAuditReadback =
    backupId && unsafeBackupRestore.statusCode === 400
      ? await getExternalTeachingOperationAudit({
          externalStorageBaseUrl,
          externalStorageAccessToken,
          actorId,
        })
      : createSkippedSmokeResponse();
  const externalRestoreDrill = backupId
    ? await postExternalTeachingOperationRestoreDrill({
        externalStorageBaseUrl,
        externalStorageAccessToken,
        actorId,
        backupId,
      })
    : createSkippedSmokeResponse();
  const results = {
    unauthenticatedPostDenied:
      unauthenticated.statusCode === 401 || unauthenticated.statusCode === 403 ? "passed" : "failed",
    unauthenticatedPostNoWriteSideEffects:
      unauthenticated.statusCode === 401 || unauthenticated.statusCode === 403
        ? hasNoDeniedOperationWriteSideEffects({
            auditBody: auditReadback.body,
            externalAuditBody: externalAuditReadback.body,
            externalCourseManagementBody: externalCourseManagementReadback.body,
            deniedSourceAction: unauthenticatedBody.sourceAction,
            deniedIdempotencyKey: unauthenticatedBody.idempotencyKey,
          })
          ? "passed"
          : "failed"
        : "failed",
    signedStudentPostDenied:
      signedStudent.statusCode === 403 ? "passed" : "failed",
    signedStudentNoWriteSideEffects:
      signedStudent.statusCode === 403 &&
      hasNoDeniedOperationWriteSideEffects({
        auditBody: auditReadback.body,
        externalAuditBody: externalAuditReadback.body,
        externalCourseManagementBody: externalCourseManagementReadback.body,
        deniedSourceAction: signedStudentBody.sourceAction,
        deniedIdempotencyKey: signedStudentBody.idempotencyKey,
      })
        ? "passed"
        : "failed",
    unsafeAppSessionPostDenied:
      unsafeAppSession.statusCode === 401 || unsafeAppSession.statusCode === 403
        ? "passed"
        : "failed",
    unsafeAppSessionPostTraceHeaderReturned: hasSafeTraceHeader(unsafeAppSession.headers)
      ? "passed"
      : "failed",
    unsafeAppSessionPostNoWriteSideEffects:
      hasNoDeniedOperationWriteSideEffects({
        auditBody: auditReadback.body,
        externalAuditBody: externalAuditReadback.body,
        externalCourseManagementBody: externalCourseManagementReadback.body,
        deniedSourceAction: unsafeAppSessionBody.sourceAction,
        deniedIdempotencyKey: unsafeAppSessionBody.idempotencyKey,
      })
        ? "passed"
        : "failed",
    signedTeacherCourseIdRequired:
      missingCourseId.statusCode === 400 &&
      readAccessReasonCode(missingCourseId.body) === "course-id-required"
        ? "passed"
        : "failed",
    signedTeacherCourseIdRequiredNoWriteSideEffects:
      hasNoDeniedOperationWriteSideEffects({
        auditBody: auditReadback.body,
        externalAuditBody: externalAuditReadback.body,
        externalCourseManagementBody: externalCourseManagementReadback.body,
        deniedSourceAction: missingCourseIdBody.sourceAction,
        deniedIdempotencyKey: missingCourseIdBody.idempotencyKey,
      })
        ? "passed"
        : "failed",
    forbiddenCourseScopeDenied:
      forbiddenCourse.statusCode === 403 &&
      readAccessReasonCode(forbiddenCourse.body) === "course-scope-denied"
        ? "passed"
        : "failed",
    forbiddenCourseScopeNoWriteSideEffects:
      hasNoDeniedOperationWriteSideEffects({
        auditBody: auditReadback.body,
        externalAuditBody: externalAuditReadback.body,
        externalCourseManagementBody: externalCourseManagementReadback.body,
        deniedCourseId: forbiddenCourseBody.courseId,
        deniedSourceAction: forbiddenCourseBody.sourceAction,
        deniedIdempotencyKey: forbiddenCourseBody.idempotencyKey,
      })
        ? "passed"
        : "failed",
    authorizedOperationPersisted:
      authorized.statusCode === 200 && receipt?.status === "persisted" ? "passed" : "failed",
    durableExternalPersistenceReturned:
      receipt?.storagePolicy === "external-redacted-teaching-operation-append" &&
      receipt?.storageWritePolicy === "external-append-only-operation-log"
        ? "passed"
        : "failed",
    domainPersistenceSummaryReturned: hasDomainPersistenceSummary({
      body: authorized.body,
      courseId,
      recordId: typeof receipt?.receiptId === "string" ? receipt.receiptId : undefined,
      operationId: "course-settings",
      actionSlot: "primary",
      objectType: "course-settings",
    })
      ? "passed"
      : "failed",
    operationsSchemaMigrationPolicyReturned: hasTeachingOperationsSchemaContract(
      plan.teachingOperationsSchema,
    )
      ? "passed"
      : "failed",
    appendLedgerSequenceReturned:
      isPositiveInteger(receipt?.externalAppend?.appendSequence) ? "passed" : "failed",
    appendLedgerSequenceReadbackReturned:
      auditReadback.statusCode === 200 &&
      hasAppendLedgerSequenceReadback({
        body: auditReadback.body,
        recordId: typeof receipt?.receiptId === "string" ? receipt.receiptId : undefined,
      })
        ? "passed"
        : "failed",
    signedActorReturned: receipt?.actorId === expectedTeacherId ? "passed" : "failed",
    courseBindingReturned: receipt?.courseId === courseId ? "passed" : "failed",
    auditTraceReturned:
      typeof audit?.traceId === "string" && audit.authMode === "signed-teacher-session"
        ? "passed"
        : "failed",
    auditAuthSessionReturned: isAuditAuthSessionReady(audit?.authSession)
      ? "passed"
      : "failed",
    auditRequestSourceProvenanceReturned: hasAuditRequestSourceProvenance(audit?.requestSource)
      ? "passed"
      : "failed",
    unauthenticatedTraceHeaderReturned: hasSafeTraceHeader(unauthenticated.headers)
      ? "passed"
      : "failed",
    signedStudentTraceHeaderReturned: hasSafeTraceHeader(signedStudent.headers)
      ? "passed"
      : "failed",
    unauthenticatedAuditReadbackDenied:
      unauthenticatedAuditReadback.statusCode === 401 ||
      unauthenticatedAuditReadback.statusCode === 403
        ? "passed"
        : "failed",
    unauthenticatedAuditReadbackTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedAuditReadback.headers,
    )
      ? "passed"
      : "failed",
    signedStudentAuditReadbackDenied:
      signedStudentAuditReadback.statusCode === 403 ? "passed" : "failed",
    signedStudentAuditReadbackTraceHeaderReturned: hasSafeTraceHeader(
      signedStudentAuditReadback.headers,
    )
      ? "passed"
      : "failed",
    unsafeAppSessionAuditReadbackDenied:
      unsafeAppSessionAuditReadback.statusCode === 401 ||
      unsafeAppSessionAuditReadback.statusCode === 403
        ? "passed"
        : "failed",
    unsafeAppSessionAuditReadbackTraceHeaderReturned: hasSafeTraceHeader(
      unsafeAppSessionAuditReadback.headers,
    )
      ? "passed"
      : "failed",
    authorizedTraceHeaderReturned: hasSafeTraceHeader(authorized.headers)
      ? "passed"
      : "failed",
    auditReadbackReturned: isAuditReadbackBodyReady({
      body: auditReadback.body,
      courseId,
      traceId: "trace-teaching-operations-route-smoke",
    }) && auditReadback.statusCode === 200
      ? "passed"
      : "failed",
    auditAuthSessionReadbackReturned:
      auditReadback.statusCode === 200 &&
      hasMatchingAuditAuthSessionReadback({
        body: auditReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke",
        authSession: audit?.authSession,
      })
        ? "passed"
        : "failed",
    auditReadbackTraceHeaderReturned: hasSafeTraceHeader(auditReadback.headers)
      ? "passed"
      : "failed",
    domainProjectionReadbackReturned: hasDomainProjectionReadback({
      body: auditReadback.body,
      courseId,
      recordId: typeof receipt?.receiptId === "string" ? receipt.receiptId : undefined,
    })
      ? "passed"
      : "failed",
    externalDomainProjectionReadbackReturned:
      externalAuditReadback.statusCode === 200 &&
      hasDomainProjectionReadback({
        body: externalAuditReadback.body,
        courseId,
        recordId: typeof receipt?.receiptId === "string" ? receipt.receiptId : undefined,
      })
        ? "passed"
        : "failed",
    courseSettingsDomainObjectReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseSettingsDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId: typeof receipt?.receiptId === "string" ? receipt.receiptId : undefined,
      })
        ? "passed"
        : "failed",
    courseSettingsPatchReadbackReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseSettingsPatchReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId: typeof receipt?.receiptId === "string" ? receipt.receiptId : undefined,
      })
        ? "passed"
        : "failed",
    studentPreviewSessionDomainObjectReturned:
      studentPreviewSession.statusCode === 200 &&
      studentPreviewSessionReceipt?.action === "generate-student-preview-session" &&
      studentPreviewSessionReceipt?.status === "persisted" &&
      studentPreviewSessionReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      studentPreviewSessionReceipt?.storageWritePolicy ===
        "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasStudentPreviewSessionDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof studentPreviewSessionOperationReceipt?.receiptId === "string"
            ? studentPreviewSessionOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    studentPreviewSessionAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-student-preview",
        action: "generate-student-preview-session",
      })
        ? "passed"
        : "failed",
    studentRosterSyncDomainObjectReturned:
      studentRosterSync.statusCode === 200 &&
      studentRosterSyncReceipt?.action === "sync-student-roster" &&
      studentRosterSyncReceipt?.status === "persisted" &&
      studentRosterSyncReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      studentRosterSyncReceipt?.storageWritePolicy === "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasStudentRosterSyncDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof studentRosterOperationReceipt?.receiptId === "string"
            ? studentRosterOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    studentRosterDomainPersistenceSummaryReturned: hasDomainPersistenceSummary({
      body: studentRosterSync.body,
      courseId,
      recordId:
        typeof studentRosterOperationReceipt?.receiptId === "string"
          ? studentRosterOperationReceipt.receiptId
          : undefined,
      operationId: "students",
      actionSlot: "primary",
      objectType: "student-roster",
    })
      ? "passed"
      : "failed",
    studentRosterProviderSyncReturned:
      studentRosterSync.statusCode === 200 &&
      studentRosterProviderSyncReceipt?.action === "sync-student-roster-provider" &&
      studentRosterProviderSyncReceipt?.status === "synced" &&
      studentRosterProviderSyncReceipt?.providerStatus === "sis-provider-synced" &&
      typeof studentRosterProviderSyncReceipt?.providerSyncId === "string" &&
      studentRosterProviderSyncReceipt.providerSyncId.length > 0 &&
      typeof studentRosterProviderSyncReceipt?.rosterId === "string" &&
      studentRosterProviderSyncReceipt.rosterId.length > 0
        ? "passed"
        : "failed",
    studentRosterProviderSyncAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-student-roster",
        action: "sync-student-roster-provider",
      })
        ? "passed"
        : "failed",
    studentGroupSuggestionDomainObjectReturned:
      studentGroupSuggestion.statusCode === 200 &&
      studentGroupSuggestionReceipt?.action === "generate-student-group-suggestions" &&
      studentGroupSuggestionReceipt?.status === "persisted" &&
      studentGroupSuggestionReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      studentGroupSuggestionReceipt?.storageWritePolicy ===
        "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasStudentGroupSuggestionDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof studentGroupSuggestionOperationReceipt?.receiptId === "string"
            ? studentGroupSuggestionOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    studentGroupSuggestionAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-student-group-suggestion",
        action: "generate-student-group-suggestions",
      })
        ? "passed"
        : "failed",
    knowledgeIndexSyncDomainObjectReturned:
      knowledgeIndexSync.statusCode === 200 &&
      knowledgeIndexSyncReceipt?.action === "sync-knowledge-index" &&
      knowledgeIndexSyncReceipt?.status === "persisted" &&
      knowledgeIndexSyncReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      knowledgeIndexSyncReceipt?.storageWritePolicy === "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasKnowledgeIndexSyncDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof knowledgeIndexOperationReceipt?.receiptId === "string"
            ? knowledgeIndexOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    knowledgeIndexDomainPersistenceSummaryReturned: hasDomainPersistenceSummary({
      body: knowledgeIndexSync.body,
      courseId,
      recordId:
        typeof knowledgeIndexOperationReceipt?.receiptId === "string"
          ? knowledgeIndexOperationReceipt.receiptId
          : undefined,
      operationId: "knowledge-base",
      actionSlot: "primary",
      objectType: "knowledge-index",
    })
      ? "passed"
      : "failed",
    knowledgeIndexProviderSyncReturned:
      knowledgeIndexSync.statusCode === 200 &&
      knowledgeIndexProviderSyncReceipt?.action === "sync-knowledge-index-provider" &&
      knowledgeIndexProviderSyncReceipt?.status === "synced" &&
      knowledgeIndexProviderSyncReceipt?.providerStatus === "knowledge-provider-synced" &&
      typeof knowledgeIndexProviderSyncReceipt?.providerSyncId === "string" &&
      knowledgeIndexProviderSyncReceipt.providerSyncId.length > 0 &&
      knowledgeIndexProviderSyncReceipt?.indexId === `knowledge-index-${courseId}`
        ? "passed"
        : "failed",
    knowledgeIndexProviderSyncAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      (
        hasCourseManagementAuditSourceReadback({
          body: externalCourseManagementReadback.body,
          courseId,
          traceId: "trace-teaching-operations-route-smoke-knowledge-index",
          action: "sync-knowledge-index-provider",
        }) ||
        (
          knowledgeIndexProviderSyncReceipt?.providerStatus === "knowledge-provider-synced" &&
          hasCourseManagementAuditSourceReadback({
            body: externalCourseManagementReadback.body,
            courseId,
            traceId: "trace-teaching-operations-route-smoke-knowledge-index",
            action: "sync-knowledge-index",
          })
        )
      )
        ? "passed"
        : "failed",
    resourceReviewItemDomainObjectReturned:
      resourceReviewItem.statusCode === 200 &&
      resourceReviewItemReceipt?.action === "queue-resource-review-item" &&
      resourceReviewItemReceipt?.status === "persisted" &&
      resourceReviewItemReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      resourceReviewItemReceipt?.storageWritePolicy === "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasResourceReviewItemDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof resourceReviewItemOperationReceipt?.receiptId === "string"
            ? resourceReviewItemOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    resourceReviewItemAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-resource-review",
        action: "queue-resource-review-item",
      })
        ? "passed"
        : "failed",
    courseContentPublishDomainObjectReturned:
      courseContentPublish.statusCode === 200 &&
      courseContentPublishReceipt?.action === "publish-course-content" &&
      courseContentPublishReceipt?.status === "persisted" &&
      courseContentPublishReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      courseContentPublishReceipt?.storageWritePolicy === "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseContentPublishDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof courseContentOperationReceipt?.receiptId === "string"
            ? courseContentOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    courseContentDomainPersistenceSummaryReturned: hasDomainPersistenceSummary({
      body: courseContentPublish.body,
      courseId,
      recordId:
        typeof courseContentOperationReceipt?.receiptId === "string"
          ? courseContentOperationReceipt.receiptId
          : undefined,
      operationId: "content",
      actionSlot: "primary",
      objectType: "course-content",
    })
      ? "passed"
      : "failed",
    courseContentProviderPublishReturned:
      courseContentPublish.statusCode === 200 &&
      courseContentProviderPublishReceipt?.action === "publish-course-content-provider" &&
      courseContentProviderPublishReceipt?.status === "published" &&
      courseContentProviderPublishReceipt?.providerStatus === "content-provider-published" &&
      typeof courseContentProviderPublishReceipt?.providerPublishId === "string" &&
      courseContentProviderPublishReceipt.providerPublishId.length > 0 &&
      courseContentProviderPublishReceipt?.contentId === `course-content-${courseId}`
        ? "passed"
        : "failed",
    courseContentProviderPublishAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      (
        hasCourseManagementAuditSourceReadback({
          body: externalCourseManagementReadback.body,
          courseId,
          traceId: "trace-teaching-operations-route-smoke-course-content",
          action: "publish-course-content-provider",
        }) ||
        (
          courseContentProviderPublishReceipt?.providerStatus ===
            "content-provider-published" &&
          hasCourseManagementAuditSourceReadback({
            body: externalCourseManagementReadback.body,
            courseId,
            traceId: "trace-teaching-operations-route-smoke-course-content",
            action: "publish-course-content",
          })
        )
      )
        ? "passed"
        : "failed",
    courseUnitDraftDomainObjectReturned:
      courseUnitDraft.statusCode === 200 &&
      courseUnitDraftReceipt?.action === "generate-course-unit-draft" &&
      courseUnitDraftReceipt?.status === "persisted" &&
      courseUnitDraftReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      courseUnitDraftReceipt?.storageWritePolicy === "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseUnitDraftDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof courseUnitDraftOperationReceipt?.receiptId === "string"
            ? courseUnitDraftOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    courseUnitDraftAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-course-unit-draft",
        action: "generate-course-unit-draft",
      })
        ? "passed"
        : "failed",
    dashboardRefreshDomainObjectReturned:
      dashboardRefresh.statusCode === 200 &&
      dashboardRefreshReceipt?.action === "refresh-dashboard" &&
      dashboardRefreshReceipt?.status === "persisted" &&
      dashboardRefreshReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      dashboardRefreshReceipt?.storageWritePolicy === "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasDashboardRefreshDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof dashboardOperationReceipt?.receiptId === "string"
            ? dashboardOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    dashboardRefreshDomainPersistenceSummaryReturned: hasDomainPersistenceSummary({
      body: dashboardRefresh.body,
      courseId,
      recordId:
        typeof dashboardOperationReceipt?.receiptId === "string"
          ? dashboardOperationReceipt.receiptId
          : undefined,
      operationId: "dashboard",
      actionSlot: "primary",
      objectType: "dashboard-state",
    })
      ? "passed"
      : "failed",
    dashboardRefreshAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-dashboard-state",
        action: "refresh-dashboard",
      })
        ? "passed"
        : "failed",
    dashboardSnapshotDomainObjectReturned:
      dashboardSnapshot.statusCode === 200 &&
      dashboardSnapshotReceipt?.action === "lock-dashboard-snapshot" &&
      dashboardSnapshotReceipt?.status === "persisted" &&
      dashboardSnapshotReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      dashboardSnapshotReceipt?.storageWritePolicy === "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasDashboardSnapshotDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof dashboardSnapshotOperationReceipt?.receiptId === "string"
            ? dashboardSnapshotOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    dashboardSnapshotAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-dashboard-snapshot",
        action: "lock-dashboard-snapshot",
      })
        ? "passed"
        : "failed",
    quizAssessmentDomainObjectReturned:
      quizAssessment.statusCode === 200 &&
      quizAssessmentReceipt?.action === "refresh-quiz-assessment" &&
      quizAssessmentReceipt?.status === "persisted" &&
      quizAssessmentReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      quizAssessmentReceipt?.storageWritePolicy === "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasQuizAssessmentDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof quizAssessmentOperationReceipt?.receiptId === "string"
            ? quizAssessmentOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    quizAssessmentDomainPersistenceSummaryReturned: hasDomainPersistenceSummary({
      body: quizAssessment.body,
      courseId,
      recordId:
        typeof quizAssessmentOperationReceipt?.receiptId === "string"
          ? quizAssessmentOperationReceipt.receiptId
          : undefined,
      operationId: "quiz-board",
      actionSlot: "primary",
      objectType: "quiz-board-state",
    })
      ? "passed"
      : "failed",
    quizItemReviewDomainObjectReturned:
      quizItemReview.statusCode === 200 &&
      quizItemReviewReceipt?.action === "flag-quiz-item-review" &&
      quizItemReviewReceipt?.status === "persisted" &&
      quizItemReviewReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      quizItemReviewReceipt?.storageWritePolicy === "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasQuizItemReviewDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof quizItemReviewOperationReceipt?.receiptId === "string"
            ? quizItemReviewOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    quizItemReviewDomainPersistenceSummaryReturned: hasDomainPersistenceSummary({
      body: quizItemReview.body,
      courseId,
      recordId:
        typeof quizItemReviewOperationReceipt?.receiptId === "string"
          ? quizItemReviewOperationReceipt.receiptId
          : undefined,
      operationId: "quiz-board",
      actionSlot: "secondary",
      objectType: "quiz-item-review",
    })
      ? "passed"
      : "failed",
    quizItemReviewAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-quiz-item-review",
        action: "flag-quiz-item-review",
      })
        ? "passed"
        : "failed",
    agentSettingsDomainObjectReturned:
      agentSettings.statusCode === 200 &&
      agentSettingsReceipt?.action === "save-agent-settings" &&
      agentSettingsReceipt?.status === "persisted" &&
      agentSettingsReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      agentSettingsReceipt?.storageWritePolicy === "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasAgentSettingsDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof agentSettingsOperationReceipt?.receiptId === "string"
            ? agentSettingsOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    agentSettingsAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-agent-settings",
        action: "save-agent-settings",
      })
        ? "passed"
        : "failed",
    agentPermissionPreflightDomainObjectReturned:
      agentPermissionPreflight.statusCode === 200 &&
      agentPermissionPreflightReceipt?.action === "record-agent-permission-preflight" &&
      agentPermissionPreflightReceipt?.status === "persisted" &&
      agentPermissionPreflightReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      agentPermissionPreflightReceipt?.storageWritePolicy ===
        "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasAgentPermissionPreflightDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof agentPermissionPreflightOperationReceipt?.receiptId === "string"
            ? agentPermissionPreflightOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    agentPermissionPreflightAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-agent-permission-preflight",
        action: "record-agent-permission-preflight",
      })
        ? "passed"
        : "failed",
    adminSettingsDomainObjectReturned:
      adminSettings.statusCode === 200 &&
      adminSettingsReceipt?.action === "save-admin-settings" &&
      adminSettingsReceipt?.status === "persisted" &&
      adminSettingsReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      adminSettingsReceipt?.storageWritePolicy === "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasAdminSettingsDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof adminSettingsOperationReceipt?.receiptId === "string"
            ? adminSettingsOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    adminSettingsAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-admin-settings",
        action: "save-admin-settings",
      })
        ? "passed"
        : "failed",
    collaborationInviteNotificationDomainObjectReturned:
      collaborationInviteNotification.statusCode === 200 &&
      collaborationInviteNotificationReceipt?.action ===
        "queue-collaboration-invite-notification" &&
      collaborationInviteNotificationReceipt?.status === "persisted" &&
      collaborationInviteNotificationReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      collaborationInviteNotificationReceipt?.storageWritePolicy ===
        "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasCollaborationInviteNotificationDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof collaborationInviteOperationReceipt?.receiptId === "string"
            ? collaborationInviteOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    collaborationInviteDomainPersistenceSummaryReturned: hasDomainPersistenceSummary({
      body: collaborationInviteNotification.body,
      courseId,
      recordId:
        typeof collaborationInviteOperationReceipt?.receiptId === "string"
          ? collaborationInviteOperationReceipt.receiptId
          : undefined,
      operationId: "admins",
      actionSlot: "secondary",
      objectType: "email-notification",
    })
      ? "passed"
      : "failed",
    collaborationInviteEmailDeliveryReturned:
      collaborationInviteNotification.statusCode === 200 &&
      collaborationInviteEmailDeliveryReceipt?.action === "deliver-collaboration-invite-email" &&
      collaborationInviteEmailDeliveryReceipt?.status === "delivered" &&
      collaborationInviteEmailDeliveryReceipt?.providerStatus === "smtp-provider-delivered" &&
      typeof collaborationInviteEmailDeliveryReceipt?.deliveryId === "string" &&
      collaborationInviteEmailDeliveryReceipt.deliveryId.length > 0 &&
      typeof collaborationInviteEmailDeliveryReceipt?.outboxId === "string" &&
      collaborationInviteEmailDeliveryReceipt.outboxId.length > 0
        ? "passed"
        : "failed",
    collaborationInviteEmailDeliveryAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-collaboration-invite",
        action: "deliver-collaboration-invite-email",
      })
        ? "passed"
        : "failed",
    unauthenticatedCollaborationInviteEmailBounceCallbackDenied:
      isUnauthenticatedMutationDeniedReady({
        response: unauthenticatedCollaborationInviteEmailBounceCallback,
      })
        ? "passed"
        : "failed",
    unauthenticatedCollaborationInviteEmailBounceCallbackTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedCollaborationInviteEmailBounceCallback.headers,
    )
      ? "passed"
      : "failed",
    unauthenticatedCollaborationInviteEmailBounceCallbackNoWriteSideEffects:
      externalCourseManagementReadback.statusCode === 200 &&
      hasNoCourseManagementTraceSideEffects({
        body: externalCourseManagementReadback.body,
        traceId:
          "trace-teaching-operations-route-smoke-collaboration-invite-bounce-denied",
      })
        ? "passed"
        : "failed",
    signedStudentCollaborationInviteEmailBounceCallbackDenied:
      isUnauthenticatedMutationDeniedReady({
        response: signedStudentCollaborationInviteEmailBounceCallback,
      })
        ? "passed"
        : "failed",
    signedStudentCollaborationInviteEmailBounceCallbackTraceHeaderReturned: hasSafeTraceHeader(
      signedStudentCollaborationInviteEmailBounceCallback.headers,
    )
      ? "passed"
      : "failed",
    signedStudentCollaborationInviteEmailBounceCallbackNoWriteSideEffects:
      externalCourseManagementReadback.statusCode === 200 &&
      hasNoCourseManagementTraceSideEffects({
        body: externalCourseManagementReadback.body,
        traceId:
          "trace-teaching-operations-route-smoke-collaboration-invite-bounce-student-denied",
      })
        ? "passed"
        : "failed",
    invalidTokenCollaborationInviteEmailBounceCallbackDenied:
      isUnauthenticatedMutationDeniedReady({
        response: invalidTokenCollaborationInviteEmailBounceCallback,
      })
        ? "passed"
        : "failed",
    invalidTokenCollaborationInviteEmailBounceCallbackTraceHeaderReturned: hasSafeTraceHeader(
      invalidTokenCollaborationInviteEmailBounceCallback.headers,
    )
      ? "passed"
      : "failed",
    invalidTokenCollaborationInviteEmailBounceCallbackNoWriteSideEffects:
      externalCourseManagementReadback.statusCode === 200 &&
      hasNoCourseManagementTraceSideEffects({
        body: externalCourseManagementReadback.body,
        traceId:
          "trace-teaching-operations-route-smoke-collaboration-invite-bounce-invalid-token-denied",
      })
        ? "passed"
        : "failed",
    unsafeCollaborationInviteEmailBounceCallbackDenied: isUnsafePathIdDeniedReady({
      response: unsafeCollaborationInviteEmailBounceCallback,
      traceId:
        "trace-teaching-operations-route-smoke-collaboration-invite-bounce-unsafe-denied",
      unsafeId: "unsafe/../callback-delivery",
    })
      ? "passed"
      : "failed",
    unsafeCollaborationInviteEmailBounceCallbackTraceHeaderReturned: hasSafeTraceHeader(
      unsafeCollaborationInviteEmailBounceCallback.headers,
    )
      ? "passed"
      : "failed",
    unsafeCollaborationInviteEmailBounceCallbackNoWriteSideEffects:
      externalCourseManagementReadback.statusCode === 200 &&
      hasNoCourseManagementTraceSideEffects({
        body: externalCourseManagementReadback.body,
        traceId:
          "trace-teaching-operations-route-smoke-collaboration-invite-bounce-unsafe-denied",
      })
        ? "passed"
        : "failed",
    collaborationInviteEmailBounceCallbackReturned:
      collaborationInviteEmailBounceCallback.statusCode === 200 &&
      collaborationInviteEmailBounceCallbackReceipt?.action ===
        "record-collaboration-invite-email-delivery-callback" &&
      collaborationInviteEmailBounceCallbackReceipt?.status === "persisted" &&
      collaborationInviteEmailBounceCallbackReceipt?.deliveryStatus === "failed" &&
      collaborationInviteEmailBounceCallbackReceipt?.providerStatus ===
        "smtp-provider-bounced" &&
      collaborationInviteEmailBounceCallbackReceipt?.deliveryId ===
        collaborationInviteEmailDeliveryReceipt?.deliveryId &&
      collaborationInviteEmailBounceCallbackReceipt?.outboxId ===
        collaborationInviteEmailDeliveryReceipt?.outboxId
        ? "passed"
        : "failed",
    collaborationInviteEmailCallbackAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-collaboration-invite-bounce",
        action: "record-collaboration-invite-email-delivery-callback",
        expectedUserAgent: "redacted",
      })
        ? "passed"
        : "failed",
    courseExportManifestDomainObjectReturned:
      courseExportManifest.statusCode === 200 &&
      courseExportManifestReceipt?.action === "create-export-manifest" &&
      courseExportManifestReceipt?.status === "persisted" &&
      courseExportManifestReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      courseExportManifestReceipt?.storageWritePolicy ===
        "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseExportManifestDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof courseExportOperationReceipt?.receiptId === "string"
            ? courseExportOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    courseExportProviderReturned:
      courseExportManifest.statusCode === 200 &&
      courseExportProviderReceipt?.action === "export-course-data-provider" &&
      courseExportProviderReceipt?.status === "exported" &&
      courseExportProviderReceipt?.providerStatus === "export-provider-exported" &&
      typeof courseExportProviderReceipt?.providerExportId === "string" &&
      courseExportProviderReceipt.providerExportId.length > 0 &&
      courseExportProviderReceipt?.exportManifestId === `export-manifest-${courseId}` &&
      courseExportProviderReceipt?.teachingOperationManifestId === exportManifestId
        ? "passed"
        : "failed",
    courseExportProviderAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-export-manifest",
        action: "export-course-data-provider",
      })
        ? "passed"
        : "failed",
    courseExportManifestAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-export-manifest",
        action: "create-export-manifest",
      })
        ? "passed"
        : "failed",
    unauthenticatedExportManifestDownloadDenied:
      unauthenticatedExportManifestDownload.statusCode === 401 ? "passed" : "failed",
    unauthenticatedExportManifestDownloadTraceHeaderReturned:
      unauthenticatedExportManifestDownload.statusCode === 401 &&
      hasSafeTraceHeader(unauthenticatedExportManifestDownload.headers)
        ? "passed"
        : "failed",
    signedStudentExportManifestDownloadDenied:
      signedStudentExportManifestDownload.statusCode === 403 ? "passed" : "failed",
    signedStudentExportManifestDownloadTraceHeaderReturned:
      signedStudentExportManifestDownload.statusCode === 403 &&
      hasSafeTraceHeader(signedStudentExportManifestDownload.headers)
        ? "passed"
        : "failed",
    exportManifestDownloadReadbackReturned:
      exportManifestDownload.statusCode === 200 &&
      hasSafeTraceHeader(exportManifestDownload.headers) &&
      hasExportManifestDownloadReadback({
        body: exportManifestDownload.body,
        courseId,
        manifestId: exportManifestId,
      })
        ? "passed"
        : "failed",
    unsafeExportManifestIdDenied: isUnsafePathIdDeniedReady({
      response: unsafeExportManifestDownload,
      traceId: "trace-teaching-operations-route-smoke-unsafe-export-manifest-id",
      unsafeId: unsafeExportManifestId,
    })
      ? "passed"
      : "failed",
    courseExportRedactionValidationDomainObjectReturned:
      courseExportRedactionValidation.statusCode === 200 &&
      courseExportRedactionValidationReceipt?.action === "validate-export-redaction-scope" &&
      courseExportRedactionValidationReceipt?.status === "persisted" &&
      courseExportRedactionValidationReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      courseExportRedactionValidationReceipt?.storageWritePolicy ===
        "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseExportRedactionValidationDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof courseExportRedactionValidationOperationReceipt?.receiptId === "string"
            ? courseExportRedactionValidationOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    exportRedactionValidationAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-export-redaction",
        action: "validate-export-redaction-scope",
      })
        ? "passed"
        : "failed",
    gradingQueueDomainObjectReturned:
      gradebookSeed.statusCode === 200 &&
      gradingQueueReceipt?.action === "save-grading-queue" &&
      gradingQueueReceipt?.status === "persisted" &&
      gradingQueueReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      gradingQueueReceipt?.storageWritePolicy === "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasGradingQueueDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof gradingQueueOperationReceipt?.receiptId === "string"
            ? gradingQueueOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    gradebookUpdateDomainObjectReturned:
      gradebookSeed.statusCode === 200 &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasGradebookUpdateDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof gradingQueueOperationReceipt?.receiptId === "string"
            ? gradingQueueOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    gradingDomainPersistenceSummaryReturned: hasDomainPersistenceSummary({
      body: gradebookSeed.body,
      courseId,
      recordId:
        typeof gradingQueueOperationReceipt?.receiptId === "string"
          ? gradingQueueOperationReceipt.receiptId
          : undefined,
      operationId: "grading",
      actionSlot: "primary",
      objectTypes: ["grading-queue", "gradebook-update"],
    })
      ? "passed"
      : "failed",
    gradingFeedbackDraftDomainObjectReturned:
      gradingFeedbackDraft.statusCode === 200 &&
      gradingFeedbackDraftReceipt?.action === "generate-grading-feedback-draft" &&
      gradingFeedbackDraftReceipt?.status === "persisted" &&
      gradingFeedbackDraftReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      gradingFeedbackDraftReceipt?.storageWritePolicy ===
        "external-optimistic-snapshot-replace" &&
      externalCourseManagementReadback.statusCode === 200 &&
      hasGradingFeedbackDraftDomainObject({
        body: externalCourseManagementReadback.body,
        courseId,
        recordId:
          typeof gradingFeedbackDraftOperationReceipt?.receiptId === "string"
            ? gradingFeedbackDraftOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    gradingFeedbackProviderReturned:
      gradingFeedbackDraft.statusCode === 200 &&
      gradingFeedbackProviderReceipt?.action === "generate-grading-feedback-provider" &&
      gradingFeedbackProviderReceipt?.status === "generated" &&
      gradingFeedbackProviderReceipt?.providerStatus === "feedback-provider-generated" &&
      typeof gradingFeedbackProviderReceipt?.providerFeedbackId === "string" &&
      gradingFeedbackProviderReceipt.providerFeedbackId.length > 0 &&
      gradingFeedbackProviderReceipt?.gradingFeedbackDraftId ===
        `grading-feedback-draft-${courseId}`
        ? "passed"
        : "failed",
    gradingFeedbackProviderAuditSourceReturned:
      externalCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: externalCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-grading-feedback",
        action: "generate-grading-feedback-provider",
      })
        ? "passed"
        : "failed",
    unauthenticatedRollbackDenied:
      unauthenticatedRollback.statusCode === 401 ? "passed" : "failed",
    unauthenticatedRollbackTraceHeaderReturned:
      unauthenticatedRollback.statusCode === 401 &&
      hasSafeTraceHeader(unauthenticatedRollback.headers)
        ? "passed"
        : "failed",
    unauthenticatedRollbackNoWriteSideEffects:
      rollbackDeniedAuditReadback.statusCode === 200 &&
      hasNoTraceSideEffects({
        body: rollbackDeniedAuditReadback.body,
        traceId: "trace-teaching-operations-route-smoke-rollback-denied",
      })
        ? "passed"
        : "failed",
    signedStudentRollbackDenied: isSignedStudentMutationDeniedReady({
      response: signedStudentRollback,
    })
      ? "passed"
      : "failed",
    signedStudentRollbackTraceHeaderReturned: hasSafeTraceHeader(
      signedStudentRollback.headers,
    )
      ? "passed"
      : "failed",
    signedStudentRollbackNoWriteSideEffects:
      rollbackDeniedAuditReadback.statusCode === 200 &&
      hasNoTraceSideEffects({
        body: rollbackDeniedAuditReadback.body,
        traceId: "trace-teaching-operations-route-smoke-rollback-student-denied",
      })
        ? "passed"
        : "failed",
    idempotentRetryReturned:
      idempotentRetry.statusCode === 200 &&
      retryReceipt?.status === "persisted" &&
      retryReceipt?.receiptId === receipt?.receiptId &&
      retryReceipt?.idempotencyKey === idempotencyKey &&
      retryReceipt?.idempotencyStatus === "already-persisted" &&
      retryReceipt?.storagePolicy === "external-redacted-teaching-operation-append" &&
      retryReceipt?.storageWritePolicy === "external-append-only-operation-log"
        ? "passed"
        : "failed",
    idempotentRetryAppendSequenceStableReturned:
      idempotentRetry.statusCode === 200 &&
      isPositiveInteger(receipt?.externalAppend?.appendSequence) &&
      retryReceipt?.externalAppend?.receiptId === receipt?.externalAppend?.receiptId &&
      retryReceipt?.externalAppend?.appendSequence === receipt?.externalAppend?.appendSequence
        ? "passed"
        : "failed",
    concurrentIdempotentRetryAppendSequenceStableReturned:
      concurrentIdempotentRetryA.statusCode === 200 &&
      concurrentIdempotentRetryB.statusCode === 200 &&
      isPositiveInteger(receipt?.externalAppend?.appendSequence) &&
      concurrentIdempotentRetryReceipts.every(
        (concurrentReceipt) =>
          concurrentReceipt?.status === "persisted" &&
          concurrentReceipt?.receiptId === receipt?.receiptId &&
          concurrentReceipt?.idempotencyKey === idempotencyKey &&
          concurrentReceipt?.idempotencyStatus === "already-persisted" &&
          concurrentReceipt?.externalAppend?.receiptId === receipt?.externalAppend?.receiptId &&
          concurrentReceipt?.externalAppend?.appendSequence ===
            receipt?.externalAppend?.appendSequence,
      )
        ? "passed"
        : "failed",
    idempotencyConflictDenied: isIdempotencyConflictDeniedReady({
      response: idempotencyConflict,
      traceId: "trace-teaching-operations-route-smoke-idempotency-conflict",
      idempotencyKey,
    })
      ? "passed"
      : "failed",
    rollbackPersistedReturned:
      rollback.statusCode === 200 &&
      rollbackReceipt?.action === "rollback-teaching-operation-record" &&
      rollbackReceipt?.status === "persisted" &&
      rollbackReceipt?.targetRecordId === rollbackRecordId &&
      rollbackReceipt?.courseId === courseId &&
      rollbackReceipt?.storagePolicy === "external-redacted-teaching-operation-rollback" &&
      rollbackReceipt?.storageWritePolicy === "external-append-only-rollback-log"
        ? "passed"
        : "failed",
    rollbackProductionDatabaseAdapterReturned:
      isReadyProductionDatabaseAdapter(
        rollbackReceipt?.externalRollback?.productionDatabaseAdapter,
      ) ||
      isReadyProductionDatabaseAdapter(rollbackReceipt?.productionDatabaseAdapter)
        ? "passed"
        : "failed",
    rollbackTraceHeaderReturned: hasSafeTraceHeader(rollback.headers)
      ? "passed"
      : "failed",
    rollbackTraceClosureReturned: isRollbackTraceClosureReady({
      response: rollback,
      courseId,
      recordId: rollbackRecordId,
      traceId: "trace-teaching-operations-route-smoke-rollback",
    })
      ? "passed"
      : "failed",
    rollbackReadbackReturned:
      rollbackAuditReadback.statusCode === 200 &&
      hasRollbackReadback({
        body: rollbackAuditReadback.body,
        courseId,
        recordId: rollbackRecordId,
      })
        ? "passed"
        : "failed",
    rollbackReadbackTraceHeaderReturned: hasSafeTraceHeader(rollbackAuditReadback.headers)
      ? "passed"
      : "failed",
    unauthenticatedAlertSummaryReadbackDenied:
      unauthenticatedAlertSummary.statusCode === 401 ||
      unauthenticatedAlertSummary.statusCode === 403
        ? "passed"
        : "failed",
    unauthenticatedAlertSummaryReadbackTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedAlertSummary.headers,
    )
      ? "passed"
      : "failed",
    signedStudentAlertSummaryReadbackDenied:
      signedStudentAlertSummary.statusCode === 403 ? "passed" : "failed",
    signedStudentAlertSummaryReadbackTraceHeaderReturned: hasSafeTraceHeader(
      signedStudentAlertSummary.headers,
    )
      ? "passed"
      : "failed",
    alertSummaryReadbackReturned:
      alertSeed.statusCode === 200 &&
      alertSummary.statusCode === 200 &&
      isAlertSummaryReady(alertSummary.body)
        ? "passed"
        : "failed",
    unauthenticatedAlertNotificationEnqueueDenied:
      unauthenticatedAlertNotificationPost.statusCode === 401 ||
      unauthenticatedAlertNotificationPost.statusCode === 403
        ? "passed"
        : "failed",
    unauthenticatedAlertNotificationTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedAlertNotificationPost.headers,
    )
      ? "passed"
      : "failed",
    signedStudentAlertNotificationEnqueueDenied:
      signedStudentAlertNotificationPost.statusCode === 403 ? "passed" : "failed",
    signedStudentAlertNotificationTraceHeaderReturned: hasSafeTraceHeader(
      signedStudentAlertNotificationPost.headers,
    )
      ? "passed"
      : "failed",
    unauthenticatedAlertNotificationNoWriteSideEffects:
      alertNotificationDeniedReadback.statusCode === 200 &&
      hasNoTraceSideEffects({
        body: alertNotificationDeniedReadback.body,
        traceId: "trace-teaching-operations-route-smoke-alert-notifications-denied",
      })
        ? "passed"
        : "failed",
    signedStudentAlertNotificationNoWriteSideEffects:
      signedStudentAlertNotificationDeniedReadback.statusCode === 200 &&
      hasNoTraceSideEffects({
        body: signedStudentAlertNotificationDeniedReadback.body,
        traceId:
          "trace-teaching-operations-route-smoke-alert-notifications-student-denied",
      })
        ? "passed"
        : "failed",
    unauthenticatedAlertNotificationReadbackDenied:
      unauthenticatedAlertNotificationReadback.statusCode === 401 ||
      unauthenticatedAlertNotificationReadback.statusCode === 403
        ? "passed"
        : "failed",
    unauthenticatedAlertNotificationReadbackTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedAlertNotificationReadback.headers,
    )
      ? "passed"
      : "failed",
    signedStudentAlertNotificationReadbackDenied:
      signedStudentAlertNotificationReadback.statusCode === 403 ? "passed" : "failed",
    signedStudentAlertNotificationReadbackTraceHeaderReturned: hasSafeTraceHeader(
      signedStudentAlertNotificationReadback.headers,
    )
      ? "passed"
      : "failed",
    alertNotificationQueuedReturned:
      alertNotificationPost.statusCode === 200 &&
      isAlertNotificationDispatchReady(alertNotificationPost.body)
        ? "passed"
        : "failed",
    alertNotificationReadbackReturned:
      alertNotificationReadback.statusCode === 200 &&
      isAlertNotificationReadbackReady(alertNotificationReadback.body)
        ? "passed"
        : "failed",
    inviteCodeDraftDomainObjectReturned:
      inviteDraft.statusCode === 200 &&
      inviteDraftReceipt?.action === "generate-class-invite-code-draft" &&
      inviteDraftReceipt?.status === "persisted" &&
      inviteDraftReceipt?.storagePolicy ===
        "external-redacted-teaching-course-management-snapshot" &&
      inviteDraftReceipt?.storageWritePolicy === "external-optimistic-snapshot-replace" &&
      inviteDraftCourseManagementReadback.statusCode === 200 &&
      hasInviteCodeDraftDomainObject({
        body: inviteDraftCourseManagementReadback.body,
        courseId,
        classId,
        inviteCode: generatedInviteCode,
        recordId:
          typeof inviteDraftOperationReceipt?.receiptId === "string"
            ? inviteDraftOperationReceipt.receiptId
            : undefined,
      })
        ? "passed"
        : "failed",
    inviteCodeDraftAuditSourceReturned:
      inviteDraftCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: inviteDraftCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-invite-draft",
        action: "generate-class-invite-code-draft",
      })
        ? "passed"
        : "failed",
    invitePublishClassJoinEntryReturned:
      invitePublish.statusCode === 200 &&
      isInvitePublishClassJoinEntryReady({
        body: invitePublish.body,
        courseId,
        classId,
        inviteCode: publishedInviteCode,
      })
        ? "passed"
        : "failed",
    invitePublishDomainPersistenceSummaryReturned: hasDomainPersistenceSummary({
      body: invitePublish.body,
      courseId,
      recordId:
        typeof invitePublish.body?.receipt?.receiptId === "string"
          ? invitePublish.body.receipt.receiptId
          : undefined,
      operationId: "invite-code",
      actionSlot: "secondary",
      objectTypes: ["enrollment-access"],
    })
      ? "passed"
      : "failed",
    inviteCodePublishAuditSourceReturned:
      invitePublishCourseManagementReadback.statusCode === 200 &&
      hasCourseManagementAuditSourceReadback({
        body: invitePublishCourseManagementReadback.body,
        courseId,
        traceId: "trace-teaching-operations-route-smoke-invite-publish",
        action: "publish-class-invite-code",
      })
        ? "passed"
        : "failed",
    studentInviteJoinReturned:
      studentInviteJoin.statusCode === 201 &&
      isStudentInviteJoinReady({
        body: studentInviteJoin.body,
        courseId,
        classId,
        inviteCode: publishedInviteCode,
      })
        ? "passed"
        : "failed",
    unauthenticatedGradebookReleaseDenied: isUnauthenticatedMutationDeniedReady({
      response: unauthenticatedGradebookRelease,
    })
      ? "passed"
      : "failed",
    unauthenticatedGradebookReleaseTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedGradebookRelease.headers,
    )
      ? "passed"
      : "failed",
    unauthenticatedGradebookRollbackDenied: isUnauthenticatedMutationDeniedReady({
      response: unauthenticatedGradebookRollback,
    })
      ? "passed"
      : "failed",
    unauthenticatedGradebookRollbackTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedGradebookRollback.headers,
    )
      ? "passed"
      : "failed",
    signedStudentGradebookReleaseDenied: isSignedStudentMutationDeniedReady({
      response: signedStudentGradebookRelease,
    })
      ? "passed"
      : "failed",
    signedStudentGradebookReleaseTraceHeaderReturned: hasSafeTraceHeader(
      signedStudentGradebookRelease.headers,
    )
      ? "passed"
      : "failed",
    signedStudentGradebookRollbackDenied: isSignedStudentMutationDeniedReady({
      response: signedStudentGradebookRollback,
    })
      ? "passed"
      : "failed",
    signedStudentGradebookRollbackTraceHeaderReturned: hasSafeTraceHeader(
      signedStudentGradebookRollback.headers,
    )
      ? "passed"
      : "failed",
    unauthenticatedGradebookReleaseNoWriteSideEffects:
      gradebookDeniedAuditReadback.statusCode === 200 &&
      hasNoTraceSideEffects({
        body: gradebookDeniedAuditReadback.body,
        traceId: "trace-teaching-operations-route-smoke-gradebook-release-denied",
      })
        ? "passed"
        : "failed",
    unauthenticatedGradebookRollbackNoWriteSideEffects:
      gradebookDeniedAuditReadback.statusCode === 200 &&
      hasNoTraceSideEffects({
        body: gradebookDeniedAuditReadback.body,
        traceId: "trace-teaching-operations-route-smoke-gradebook-rollback-denied",
      })
        ? "passed"
        : "failed",
    signedStudentGradebookReleaseNoWriteSideEffects:
      gradebookDeniedAuditReadback.statusCode === 200 &&
      hasNoTraceSideEffects({
        body: gradebookDeniedAuditReadback.body,
        traceId: "trace-teaching-operations-route-smoke-gradebook-release-student-denied",
      })
        ? "passed"
        : "failed",
    signedStudentGradebookRollbackNoWriteSideEffects:
      gradebookDeniedAuditReadback.statusCode === 200 &&
      hasNoTraceSideEffects({
        body: gradebookDeniedAuditReadback.body,
        traceId: "trace-teaching-operations-route-smoke-gradebook-rollback-student-denied",
      })
        ? "passed"
        : "failed",
    unsafeGradebookReleaseObjectIdDenied: isUnsafePathIdDeniedReady({
      response: unsafeGradebookReleaseObjectId,
      traceId: "trace-teaching-operations-route-smoke-unsafe-gradebook-release-id",
      unsafeId: unsafeGradebookUpdateId,
    })
      ? "passed"
      : "failed",
    unsafeGradebookRollbackObjectIdDenied: isUnsafePathIdDeniedReady({
      response: unsafeGradebookRollbackObjectId,
      traceId: "trace-teaching-operations-route-smoke-unsafe-gradebook-rollback-id",
      unsafeId: unsafeGradebookUpdateId,
    })
      ? "passed"
      : "failed",
    gradebookReleaseTraceClosureReturned: isGradebookReleaseTraceClosureReady({
      response: gradebookRelease,
      courseId,
      gradebookUpdateId,
      traceId: "trace-teaching-operations-route-smoke-gradebook-release",
    })
      ? "passed"
      : "failed",
    gradebookReleaseAuditSourceReturned:
      gradebookAuditReadback.statusCode === 200 &&
      hasGradebookAuditSourceReadback({
        body: gradebookAuditReadback.body,
        courseId,
        gradebookUpdateId,
        traceId: "trace-teaching-operations-route-smoke-gradebook-release",
        eventType: "teaching-gradebook-update.released",
      })
        ? "passed"
        : "failed",
    gradebookReleaseExternalStorageReturned: isGradebookExternalStorageReceiptReady({
      response: gradebookRelease,
      action: "release-gradebook-update",
    })
      ? "passed"
      : "failed",
    gradebookProviderReleaseReturned: isGradebookProviderReleaseReceiptReady({
      response: gradebookRelease,
    })
      ? "passed"
      : "failed",
    gradebookRollbackTraceClosureReturned: isGradebookRollbackTraceClosureReady({
      response: gradebookRollback,
      courseId,
      gradebookUpdateId,
      traceId: "trace-teaching-operations-route-smoke-gradebook-rollback",
    })
      ? "passed"
      : "failed",
    gradebookRollbackAuditSourceReturned:
      gradebookAuditReadback.statusCode === 200 &&
      hasGradebookAuditSourceReadback({
        body: gradebookAuditReadback.body,
        courseId,
        gradebookUpdateId,
        traceId: "trace-teaching-operations-route-smoke-gradebook-rollback",
        eventType: "teaching-gradebook-update.release-rolled-back",
      })
        ? "passed"
        : "failed",
    gradebookRollbackExternalStorageReturned: isGradebookExternalStorageReceiptReady({
      response: gradebookRollback,
      action: "rollback-gradebook-release",
    })
      ? "passed"
      : "failed",
    gradebookProviderRollbackReturned: isGradebookProviderRollbackReceiptReady({
      response: gradebookRollback,
    })
      ? "passed"
      : "failed",
    externalBackupCreatedReturned:
      externalBackup.statusCode === 200 && isExternalBackupReady(externalBackup.body)
        ? "passed"
        : "failed",
    unauthenticatedBackupRestoreDenied: isUnauthenticatedMutationDeniedReady({
      response: unauthenticatedBackupRestore,
    })
      ? "passed"
      : "failed",
    unauthenticatedBackupRestoreTraceHeaderReturned: hasSafeTraceHeader(
      unauthenticatedBackupRestore.headers,
    )
      ? "passed"
      : "failed",
    unauthenticatedBackupRestoreNoWriteSideEffects:
      unauthenticatedBackupRestore.statusCode === 401 &&
      hasNoTraceSideEffects({
        body: backupRestoreDeniedAuditReadback.body,
        traceId: "trace-teaching-operations-route-smoke-direct-restore-denied",
      })
        ? "passed"
        : "failed",
    signedStudentBackupRestoreDenied: isSignedStudentMutationDeniedReady({
      response: signedStudentBackupRestore,
    })
      ? "passed"
      : "failed",
    signedStudentBackupRestoreTraceHeaderReturned: hasSafeTraceHeader(
      signedStudentBackupRestore.headers,
    )
      ? "passed"
      : "failed",
    signedStudentBackupRestoreNoWriteSideEffects:
      signedStudentBackupRestore.statusCode === 403 &&
      hasNoTraceSideEffects({
        body: backupRestoreDeniedAuditReadback.body,
        traceId:
          "trace-teaching-operations-route-smoke-direct-restore-student-denied",
      })
        ? "passed"
        : "failed",
    directBackupRestoreDisabledReturned: isDirectBackupRestoreDisabledReady({
      response: directBackupRestore,
      backupId,
    })
      ? "passed"
      : "failed",
    directBackupRestoreTraceClosureReturned: isDirectBackupRestoreTraceClosureReady({
      response: directBackupRestore,
      traceId: "trace-teaching-operations-route-smoke-direct-restore",
    })
      ? "passed"
      : "failed",
    directBackupRestoreNoWriteSideEffects:
      directBackupRestore.statusCode === 409 &&
      hasNoTraceSideEffects({
        body: backupRestoreDeniedAuditReadback.body,
        traceId: "trace-teaching-operations-route-smoke-direct-restore",
      })
        ? "passed"
        : "failed",
    unsafeBackupRestoreIdDenied: isUnsafePathIdDeniedReady({
      response: unsafeBackupRestore,
      traceId: "trace-teaching-operations-route-smoke-unsafe-backup-restore-id",
      unsafeId: unsafeBackupId,
    })
      ? "passed"
      : "failed",
    unsafeBackupRestoreNoWriteSideEffects:
      unsafeBackupRestore.statusCode === 400 &&
      hasNoTraceSideEffects({
        body: backupRestoreDeniedAuditReadback.body,
        traceId: "trace-teaching-operations-route-smoke-unsafe-backup-restore-id",
      })
        ? "passed"
        : "failed",
    externalRestoreDrillVerifiedReturned:
      externalRestoreDrill.statusCode === 200 &&
      isExternalRestoreDrillReady({
        body: externalRestoreDrill.body,
        backupId,
      })
        ? "passed"
        : "failed",
  };
  const status = Object.values(results).every((result) => result === "passed")
    ? "passed"
    : "blocked";

  return {
    ...plan,
    status,
    httpStatus: {
      unauthenticatedPost: unauthenticated.statusCode,
      signedStudentPost: signedStudent.statusCode,
      unsafeAppSessionPost: unsafeAppSession.statusCode,
      unauthenticatedAuditReadback: unauthenticatedAuditReadback.statusCode,
      signedStudentAuditReadback: signedStudentAuditReadback.statusCode,
      unsafeAppSessionAuditReadback: unsafeAppSessionAuditReadback.statusCode,
      authorizedPost: authorized.statusCode,
      forbiddenCoursePost: forbiddenCourse.statusCode,
      idempotentRetryPost: idempotentRetry.statusCode,
      concurrentIdempotentRetryPosts: [
        concurrentIdempotentRetryA.statusCode,
        concurrentIdempotentRetryB.statusCode,
      ],
      idempotencyConflictPost: idempotencyConflict.statusCode,
      studentPreviewSessionPost: studentPreviewSession.statusCode,
      studentRosterSyncPost: studentRosterSync.statusCode,
      studentGroupSuggestionPost: studentGroupSuggestion.statusCode,
      knowledgeIndexSyncPost: knowledgeIndexSync.statusCode,
      resourceReviewItemPost: resourceReviewItem.statusCode,
      courseContentPublishPost: courseContentPublish.statusCode,
      courseUnitDraftPost: courseUnitDraft.statusCode,
      dashboardRefreshPost: dashboardRefresh.statusCode,
      dashboardSnapshotPost: dashboardSnapshot.statusCode,
      quizAssessmentPost: quizAssessment.statusCode,
      quizItemReviewPost: quizItemReview.statusCode,
      agentSettingsPost: agentSettings.statusCode,
      agentPermissionPreflightPost: agentPermissionPreflight.statusCode,
      adminSettingsPost: adminSettings.statusCode,
      collaborationInviteNotificationPost: collaborationInviteNotification.statusCode,
      unauthenticatedCollaborationInviteEmailBounceCallbackPost:
        unauthenticatedCollaborationInviteEmailBounceCallback.statusCode,
      signedStudentCollaborationInviteEmailBounceCallbackPost:
        signedStudentCollaborationInviteEmailBounceCallback.statusCode,
      invalidTokenCollaborationInviteEmailBounceCallbackPost:
        invalidTokenCollaborationInviteEmailBounceCallback.statusCode,
      unsafeCollaborationInviteEmailBounceCallbackPost:
        unsafeCollaborationInviteEmailBounceCallback.statusCode,
      collaborationInviteEmailBounceCallbackPost:
        collaborationInviteEmailBounceCallback.statusCode,
      courseExportManifestPost: courseExportManifest.statusCode,
      unauthenticatedExportManifestDownload:
        unauthenticatedExportManifestDownload.statusCode,
      signedStudentExportManifestDownload:
        signedStudentExportManifestDownload.statusCode,
      exportManifestDownload: exportManifestDownload.statusCode,
      unsafeExportManifestDownload: unsafeExportManifestDownload.statusCode,
      courseExportRedactionValidationPost: courseExportRedactionValidation.statusCode,
      auditReadback: auditReadback.statusCode,
      externalAuditReadback: externalAuditReadback.statusCode,
      externalCourseManagementReadback: externalCourseManagementReadback.statusCode,
      unauthenticatedRollbackPost: unauthenticatedRollback.statusCode,
      signedStudentRollbackPost: signedStudentRollback.statusCode,
      rollbackDeniedAuditReadback: rollbackDeniedAuditReadback.statusCode,
      rollbackPost: rollback.statusCode,
      rollbackAuditReadback: rollbackAuditReadback.statusCode,
      alertSeedAppend: alertSeed.statusCode,
      unauthenticatedAlertSummaryReadback: unauthenticatedAlertSummary.statusCode,
      signedStudentAlertSummaryReadback: signedStudentAlertSummary.statusCode,
      alertSummaryReadback: alertSummary.statusCode,
      unauthenticatedAlertNotificationPost:
        unauthenticatedAlertNotificationPost.statusCode,
      alertNotificationDeniedReadback: alertNotificationDeniedReadback.statusCode,
      signedStudentAlertNotificationPost:
        signedStudentAlertNotificationPost.statusCode,
      signedStudentAlertNotificationDeniedReadback:
        signedStudentAlertNotificationDeniedReadback.statusCode,
      unauthenticatedAlertNotificationReadback:
        unauthenticatedAlertNotificationReadback.statusCode,
      signedStudentAlertNotificationReadback:
        signedStudentAlertNotificationReadback.statusCode,
      alertNotificationPost: alertNotificationPost.statusCode,
      alertNotificationReadback: alertNotificationReadback.statusCode,
      inviteDraftPost: inviteDraft.statusCode,
      inviteDraftCourseManagementReadback: inviteDraftCourseManagementReadback.statusCode,
      invitePublishPost: invitePublish.statusCode,
      invitePublishCourseManagementReadback: invitePublishCourseManagementReadback.statusCode,
      studentInviteJoinPost: studentInviteJoin.statusCode,
      unauthenticatedGradebookReleasePost: unauthenticatedGradebookRelease.statusCode,
      unauthenticatedGradebookRollbackPost: unauthenticatedGradebookRollback.statusCode,
      signedStudentGradebookReleasePost: signedStudentGradebookRelease.statusCode,
      signedStudentGradebookRollbackPost: signedStudentGradebookRollback.statusCode,
      gradebookDeniedAuditReadback: gradebookDeniedAuditReadback.statusCode,
      unsafeGradebookReleaseObjectIdPost: unsafeGradebookReleaseObjectId.statusCode,
      unsafeGradebookRollbackObjectIdPost: unsafeGradebookRollbackObjectId.statusCode,
      gradebookSeedPost: gradebookSeed.statusCode,
      gradingFeedbackDraftPost: gradingFeedbackDraft.statusCode,
      gradebookReleasePost: gradebookRelease.statusCode,
      gradebookRollbackPost: gradebookRollback.statusCode,
      gradebookAuditReadback: gradebookAuditReadback.statusCode,
      externalBackupPost: externalBackup.statusCode,
      unauthenticatedBackupRestorePost: unauthenticatedBackupRestore.statusCode,
      signedStudentBackupRestorePost: signedStudentBackupRestore.statusCode,
      directBackupRestorePost: directBackupRestore.statusCode,
      unsafeBackupRestorePost: unsafeBackupRestore.statusCode,
      backupRestoreDeniedAuditReadback: backupRestoreDeniedAuditReadback.statusCode,
      externalRestoreDrillPost: externalRestoreDrill.statusCode,
    },
    failureDiagnostics: createFailureDiagnostics({
      idempotentRetry,
      concurrentIdempotentRetryA,
      concurrentIdempotentRetryB,
      idempotencyConflict,
      studentRosterSync,
      courseExportManifest,
      gradingFeedbackDraft,
      courseExportRedactionValidation,
      rollbackDeniedAuditReadback,
      rollbackAuditReadback,
      alertNotificationDeniedReadback,
      invitePublish,
      studentInviteJoin,
      gradebookDeniedAuditReadback,
      gradebookAuditReadback,
      backupRestoreDeniedAuditReadback,
      externalCourseManagementReadback,
    }),
    results,
    safety: createSafety(),
  };
}

function postExternalTeachingOperationBackup({
  externalStorageBaseUrl,
  externalStorageAccessToken,
  actorId,
}) {
  const payload = JSON.stringify({
    action: "create-teaching-operation-backup",
    requestedBy: "s22-route-smoke",
    requestedAt: "2026-06-23T00:10:00.000Z",
    traceId: "trace-teaching-operations-route-smoke-backup",
  });

  return requestExternalStorage({
    externalStorageBaseUrl,
    externalStorageAccessToken,
    method: "POST",
    path: `/teaching-operations/${encodeURIComponent(actorId)}/backups`,
    payload,
    timeoutMessage: "Teaching operations external backup smoke request timed out.",
  });
}

function postExternalTeachingOperationRestoreDrill({
  externalStorageBaseUrl,
  externalStorageAccessToken,
  actorId,
  backupId,
}) {
  const payload = JSON.stringify({
    action: "verify-teaching-operation-backup-restore",
    requestedBy: "s22-route-smoke",
    requestedAt: "2026-06-23T00:11:00.000Z",
    traceId: "trace-teaching-operations-route-smoke-restore-drill",
  });

  return requestExternalStorage({
    externalStorageBaseUrl,
    externalStorageAccessToken,
    method: "POST",
    path: `/teaching-operations/${encodeURIComponent(actorId)}/backups/${encodeURIComponent(
      backupId,
    )}/restore-drill`,
    payload,
    timeoutMessage: "Teaching operations external restore-drill smoke request timed out.",
  });
}

function postTeachingOperationBackupRestore({
  baseUrl,
  cookie,
  backupId,
  traceId = "trace-teaching-operations-route-smoke-direct-restore",
}) {
  return requestTeachingOperationRoute({
    baseUrl,
    cookie,
    method: "POST",
    path: `/api/teaching/operations/backups/${encodeURIComponent(backupId)}/restore`,
    traceId,
    timeoutMessage: "Teaching operations direct backup restore route smoke request timed out.",
  });
}

function postTeachingInviteJoin({ baseUrl, studentCookie, inviteCode }) {
  return requestTeachingOperationRoute({
    baseUrl,
    cookie: studentCookie,
    method: "POST",
    path: `/api/teaching/invite-codes/${encodeURIComponent(inviteCode)}/join`,
    traceId: "trace-teaching-operations-route-smoke-student-join",
    timeoutMessage: "Teaching operations invite join route smoke request timed out.",
  });
}

function postTeachingCollaborationInviteDeliveryCallback({
  baseUrl,
  authorized,
  cookie,
  collaborationInviteEmailCallbackToken,
  authorizationToken,
  traceId,
  courseId,
  operationRecordId,
  outboxId,
  deliveryId,
}) {
  const bearerToken = authorizationToken ?? collaborationInviteEmailCallbackToken;
  if (
    (authorized && !hasValue(bearerToken)) ||
    !hasValue(courseId) ||
    !hasValue(operationRecordId) ||
    !hasValue(outboxId) ||
    !hasValue(deliveryId)
  ) {
    return createSkippedSmokeResponse();
  }
  return requestTeachingOperationRoute({
    baseUrl,
    cookie,
    method: "POST",
    path: collaborationInviteDeliveryCallbackRoute,
    ...(authorized ? { authorization: `Bearer ${bearerToken}` } : {}),
    ...(authorized
      ? { userAgent: collaborationInviteDeliveryCallbackAuditProbeUserAgent }
      : {}),
    traceId:
      traceId ??
      (authorized
        ? "trace-teaching-operations-route-smoke-collaboration-invite-bounce"
        : "trace-teaching-operations-route-smoke-collaboration-invite-bounce-denied"),
    payload: {
      eventType: "collaboration-invite-email.delivery-status",
      courseId,
      operationRecordId,
      outboxId,
      deliveryId,
      providerStatus: "bounced",
      occurredAt: "2026-06-23T00:05:45.000Z",
      failureReason: "route-smoke-bounce",
    },
    timeoutMessage:
      "Teaching operations collaboration invite delivery callback smoke request timed out.",
  });
}

function postTeachingGradebookUpdateAction({ baseUrl, cookie, gradebookUpdateId, action, traceId }) {
  return requestTeachingOperationRoute({
    baseUrl,
    cookie,
    method: "POST",
    path: `/api/teaching/gradebook-updates/${encodeURIComponent(gradebookUpdateId)}/${action}`,
    traceId,
    timeoutMessage: `Teaching operations gradebook ${action} route smoke request timed out.`,
  });
}

function getExternalTeachingOperationAudit({
  externalStorageBaseUrl,
  externalStorageAccessToken,
  actorId,
}) {
  return requestExternalStorage({
    externalStorageBaseUrl,
    externalStorageAccessToken,
    method: "GET",
    path: `/teaching-operations/${encodeURIComponent(actorId)}/audit`,
    timeoutMessage: "Teaching operations external audit readback smoke request timed out.",
  });
}

function getExternalTeachingCourseManagementDatabase({
  externalStorageBaseUrl,
  externalStorageAccessToken,
}) {
  return requestExternalStorage({
    externalStorageBaseUrl,
    externalStorageAccessToken,
    method: "GET",
    path: "/teaching-course-management/database",
    timeoutMessage:
      "Teaching operations course-management domain-object smoke request timed out.",
  });
}

function postExternalTeachingOperationAlertSeed({
  externalStorageBaseUrl,
  externalStorageAccessToken,
  actorId,
}) {
  const payload = JSON.stringify({
    action: "append-teaching-operation",
    record: {
      recordId: "admins-send-admin-email-route-smoke-alert",
      operationId: "admins",
      actionSlot: "secondary",
      actionId: "send-collaboration-invite",
      actorId,
      createdAt: "2026-06-23T00:00:00.000Z",
      status: "persisted",
      storagePolicy: "external-redacted-teaching-operation-append",
      storageWritePolicy: "external-append-only-operation-log",
      redaction: createRedaction(),
      artifacts: [
        {
          kind: "outbox",
          outboxId: "route-smoke-alert-outbox",
          channel: "collaboration-invite",
          deliveryStatus: "sent-to-local-outbox",
        },
      ],
    },
    auditEvent: {
      auditId: "audit-admins-send-admin-email-route-smoke-alert",
      traceId: "trace-teaching-operations-route-smoke-alert",
      eventType: "teaching-operation.persisted",
      actorId,
      actorRole: "teacher",
      authMode: "signed-teacher-session",
      operationId: "admins",
      actionSlot: "secondary",
      actionId: "send-collaboration-invite",
      requestSource: {
        userAgent: "UAIS teaching operations route smoke",
        ipAddress: "redacted",
      },
      createdAt: "2026-06-23T00:00:00.000Z",
      redaction: createRedaction(),
    },
  });

  return requestExternalStorage({
    externalStorageBaseUrl,
    externalStorageAccessToken,
    method: "POST",
    path: `/teaching-operations/${encodeURIComponent(actorId)}/append`,
    payload,
    timeoutMessage: "Teaching operations alert seed smoke request timed out.",
  });
}

function getTeachingOperationAuditAlerts({ baseUrl, cookie }) {
  return requestTeachingOperationRoute({
    baseUrl,
    cookie,
    method: "GET",
    path: auditAlertsRoute,
    timeoutMessage: "Teaching operations audit alert route smoke request timed out.",
  });
}

function postTeachingOperationAuditAlertNotifications({
  baseUrl,
  cookie,
  traceId = "trace-teaching-operations-route-smoke-alert-notifications",
}) {
  return requestTeachingOperationRoute({
    baseUrl,
    cookie,
    method: "POST",
    path: auditAlertNotificationsRoute,
    traceId,
    timeoutMessage:
      "Teaching operations audit alert notification route smoke request timed out.",
  });
}

function getTeachingOperationAuditAlertNotifications({ baseUrl, cookie }) {
  return requestTeachingOperationRoute({
    baseUrl,
    cookie,
    method: "GET",
    path: auditAlertNotificationsRoute,
    timeoutMessage:
      "Teaching operations audit alert notification readback route smoke request timed out.",
  });
}

function requestExternalStorage({
  externalStorageBaseUrl,
  externalStorageAccessToken,
  method,
  path,
  payload,
  timeoutMessage,
}) {
  if (!hasValue(externalStorageBaseUrl) || !hasValue(externalStorageAccessToken)) {
    return createSkippedSmokeResponse();
  }
  const url = new URL(path, externalStorageBaseUrl);
  const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const request = requestImpl(
      url,
      {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${externalStorageAccessToken}`,
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: parseJson(raw),
          });
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(10_000, () => {
      request.destroy(new Error(timeoutMessage));
    });
    if (payload) {
      request.end(payload);
    } else {
      request.end();
    }
  });
}

function postTeachingOperationRollback({
  baseUrl,
  cookie,
  courseId,
  recordId,
  traceId = "trace-teaching-operations-route-smoke-rollback",
}) {
  const url = new URL(
    `/api/teaching/operations/records/${encodeURIComponent(recordId)}/rollback`,
    baseUrl,
  );
  const payload = JSON.stringify({
    action: "rollback-teaching-operation-record",
    rollbackReason: "route-smoke-rollback",
    courseId,
  });
  const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const request = requestImpl(
      url,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...(cookie ? { cookie } : {}),
          "x-uais-trace-id": traceId,
          "user-agent": "UAIS teaching operations route smoke",
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: parseJson(raw),
          });
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(10_000, () => {
      request.destroy(new Error("Teaching operations rollback smoke request timed out."));
    });
    request.end(payload);
  });
}

function createFailureDiagnostics(responses) {
  const responseDiagnostics = Object.fromEntries(
    Object.entries(responses)
      .filter(([name]) => name !== "externalCourseManagementReadback")
      .map(([name, response]) => {
        const statusCode = Number.isInteger(response?.statusCode)
          ? response.statusCode
          : undefined;
        const error =
          typeof response?.body?.error === "string"
            ? sanitizeDiagnosticText(response.body.error)
            : undefined;
        const diagnostics = sanitizeDiagnosticObject(response?.body?.diagnostics);
        if (!statusCode || (statusCode < 400 && !error)) {
          return undefined;
        }
        return [
          name,
          {
            ...(statusCode ? { statusCode } : {}),
            ...(error ? { error } : {}),
            ...(diagnostics ? { diagnostics } : {}),
          },
        ];
      })
      .filter(Boolean),
  );
  const courseManagementAuditEvents = summarizeCourseManagementAuditEvents(
    responses.externalCourseManagementReadback?.body,
  );
  return {
    ...responseDiagnostics,
    ...(courseManagementAuditEvents.length > 0
      ? { courseManagementAuditEvents }
      : {}),
  };
}

function summarizeCourseManagementAuditEvents(body) {
  if (
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.auditEvents)
  ) {
    return [];
  }
  const interestingActions = new Set([
    "sync-knowledge-index",
    "sync-knowledge-index-provider",
    "publish-course-content",
    "publish-course-content-provider",
  ]);
  return body.database.auditEvents
    .filter((event) => isRecord(event) && interestingActions.has(event.action))
    .slice(-12)
    .map((event) => ({
      action: typeof event.action === "string" ? event.action : "missing",
      traceId: typeof event.traceId === "string" ? event.traceId : "missing",
      actorId: typeof event.actorId === "string" ? event.actorId : "missing",
      actorRole: typeof event.actorRole === "string" ? event.actorRole : "missing",
      authMode: typeof event.authMode === "string" ? event.authMode : "missing",
      userAgent:
        isRecord(event.requestSource) && typeof event.requestSource.userAgent === "string"
          ? event.requestSource.userAgent
          : "missing",
      ipAddress:
        isRecord(event.requestSource) && typeof event.requestSource.ipAddress === "string"
          ? event.requestSource.ipAddress
          : "missing",
      storagePolicy:
        typeof event.storagePolicy === "string" ? event.storagePolicy : "missing",
    }));
}

function sanitizeDiagnosticObject(value) {
  if (!isRecord(value)) {
    return undefined;
  }
  const externalTeachingCourseManagement = sanitizeExternalTeachingCourseManagementDiagnostic(
    value.externalTeachingCourseManagement,
  );
  if (!externalTeachingCourseManagement) {
    return undefined;
  }
  return {
    externalTeachingCourseManagement,
  };
}

function sanitizeExternalTeachingCourseManagementDiagnostic(value) {
  if (!isRecord(value)) {
    return undefined;
  }
  const upstreamStatus = Number.isInteger(value.upstreamStatus)
    ? value.upstreamStatus
    : undefined;
  const upstreamError =
    typeof value.upstreamError === "string"
      ? sanitizeDiagnosticText(value.upstreamError)
      : undefined;
  if (!upstreamStatus && !upstreamError) {
    return undefined;
  }
  return {
    status: "failed",
    ...(upstreamStatus ? { upstreamStatus } : {}),
    ...(upstreamError ? { upstreamError } : {}),
    valueRedacted: true,
  };
}

function sanitizeDiagnosticText(value) {
  const normalized = value.trim().slice(0, 160);
  if (!normalized || /\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    return "redacted";
  }
  return normalized;
}

function getTeachingOperationAudit({ baseUrl, cookie }) {
  return requestTeachingOperationRoute({
    baseUrl,
    cookie,
    method: "GET",
    path: auditRoute,
    timeoutMessage: "Teaching operations audit readback smoke request timed out.",
  });
}

function getTeachingOperationExportManifest({
  baseUrl,
  cookie,
  manifestId,
  traceId = "trace-teaching-operations-route-smoke-export-download",
}) {
  return requestTeachingOperationRoute({
    baseUrl,
    cookie,
    method: "GET",
    path: exportManifestRouteTemplate.replace(
      "{manifestId}",
      encodeURIComponent(manifestId),
    ),
    traceId,
    timeoutMessage: "Teaching operations export manifest download smoke request timed out.",
  });
}

function requestTeachingOperationRoute({
  baseUrl,
  cookie,
  method,
  path,
  authorization,
  payload,
  traceId,
  timeoutMessage,
  userAgent = "UAIS teaching operations route smoke",
}) {
  const url = new URL(path, baseUrl);
  const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
  const payloadText = payload ? JSON.stringify(payload) : undefined;

  return new Promise((resolve, reject) => {
    const request = requestImpl(
      url,
      {
        method,
        headers: {
          accept: "application/json",
          ...(payloadText
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payloadText),
              }
            : {}),
          ...(cookie ? { cookie } : {}),
          ...(authorization ? { authorization } : {}),
          ...(traceId ? { "x-uais-trace-id": traceId } : {}),
          origin: url.origin,
          referer: new URL("/teaching", url).toString(),
          "user-agent": userAgent,
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: parseJson(raw),
          });
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(10_000, () => {
      request.destroy(new Error(timeoutMessage));
    });
    if (payloadText) {
      request.end(payloadText);
    } else {
      request.end();
    }
  });
}

function postTeachingOperation({ baseUrl, body, cookie, traceId }) {
  const url = new URL(route, baseUrl);
  const payload = JSON.stringify(body);
  const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const request = requestImpl(
      url,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...(cookie ? { cookie } : {}),
          ...(traceId ? { "x-uais-trace-id": traceId } : {}),
          origin: url.origin,
          referer: new URL("/teaching", url).toString(),
          "user-agent": "UAIS teaching operations route smoke",
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: parseJson(raw),
          });
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(10_000, () => {
      request.destroy(new Error("Teaching operations route smoke request timed out."));
    });
    request.end(payload);
  });
}

function hasSafeTraceHeader(headers) {
  const value = readTraceHeader(headers);
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value);
}

function readTraceHeader(headers) {
  const traceId = headers?.["x-uais-trace-id"];
  return Array.isArray(traceId) ? traceId[0] : traceId;
}

function readAccessReasonCode(body) {
  return isRecord(body) && isRecord(body.access) && typeof body.access.reasonCode === "string"
    ? body.access.reasonCode
    : undefined;
}

function isAuditReadbackBodyReady({ body, courseId, traceId }) {
  if (!isRecord(body) || body.actorId !== getExpectedSmokeTeacherId()) {
    return false;
  }
  if (!Array.isArray(body.courseIds) || !body.courseIds.includes(courseId)) {
    return false;
  }
  if (!Array.isArray(body.auditEvents)) {
    return false;
  }
  return body.auditEvents.some(
    (event) =>
      isRecord(event) &&
      event.traceId === traceId &&
      event.courseId === courseId &&
      event.actorId === getExpectedSmokeTeacherId(),
  );
}

function hasMatchingAuditAuthSessionReadback({ body, courseId, traceId, authSession }) {
  if (!isAuditAuthSessionReady(authSession) || !isRecord(body) || !Array.isArray(body.auditEvents)) {
    return false;
  }
  return body.auditEvents.some(
    (event) =>
      isRecord(event) &&
      event.traceId === traceId &&
      event.courseId === courseId &&
      event.actorId === getExpectedSmokeTeacherId() &&
      isMatchingAuditAuthSession(event.authSession, authSession),
  );
}

function hasAuditRequestSourceProvenance(requestSource) {
  return (
    isRecord(requestSource) &&
    requestSource.userAgent === "UAIS teaching operations route smoke" &&
    requestSource.ipAddress === "redacted" &&
    (requestSource.originClass === "remote-https" ||
      requestSource.originClass === "local-loopback") &&
    requestSource.refererPath === "/teaching"
  );
}

function hasAppendLedgerSequenceReadback({ body, recordId }) {
  if (!recordId || !isRecord(body) || !Array.isArray(body.records)) {
    return false;
  }
  return body.records.some(
    (record) =>
      isRecord(record) &&
      record.recordId === recordId &&
      record.status === "persisted" &&
      isPositiveInteger(record.appendSequence),
  );
}

function isMatchingAuditAuthSession(candidate, expected) {
  return (
    isAuditAuthSessionReady(candidate) &&
    isAuditAuthSessionReady(expected) &&
    candidate.sessionId === expected.sessionId &&
    candidate.authenticatedAt === expected.authenticatedAt &&
    candidate.expiresAt === expected.expiresAt
  );
}

function isAuditAuthSessionReady(value) {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value.sessionId) &&
    typeof value.authenticatedAt === "string" &&
    !Number.isNaN(Date.parse(value.authenticatedAt)) &&
    typeof value.expiresAt === "string" &&
    !Number.isNaN(Date.parse(value.expiresAt))
  );
}

function findRollbackRecordId({ body, courseId, receiptId }) {
  if (!receiptId || !isRecord(body) || !Array.isArray(body.records)) {
    return undefined;
  }
  const matchingRecord = body.records.find(
    (record) =>
      isRecord(record) &&
      record.recordId === receiptId &&
      record.courseId === courseId &&
      record.status === "persisted",
  );
  return typeof matchingRecord?.recordId === "string" ? matchingRecord.recordId : undefined;
}

function hasDomainProjectionReadback({ body, courseId, recordId }) {
  if (!recordId || !isRecord(body) || !Array.isArray(body.domainProjections)) {
    return false;
  }
  return body.domainProjections.some(
    (projection) =>
      isRecord(projection) &&
      projection.objectId === `course-settings-${courseId}` &&
      projection.objectType === "course-settings" &&
      projection.courseId === courseId &&
      projection.operationRecordId === recordId &&
      projection.storagePolicy === "domain-projection-teaching-course-settings",
  );
}

function hasNoDeniedOperationWriteSideEffects({
  auditBody,
  externalAuditBody,
  externalCourseManagementBody,
  deniedCourseId,
  deniedSourceAction,
  deniedIdempotencyKey,
}) {
  const deniedValues = [
    deniedCourseId,
    deniedSourceAction,
    deniedIdempotencyKey,
  ].filter(hasValue);
  if (deniedValues.length === 0) {
    return false;
  }
  return [auditBody, externalAuditBody, externalCourseManagementBody].every((body) => {
    const bodyText = JSON.stringify(body ?? {});
    return deniedValues.every((value) => !bodyText.includes(value));
  });
}

function hasNoCourseManagementTraceSideEffects({ body, traceId }) {
  return hasNoTraceSideEffects({ body, traceId });
}

function hasNoTraceSideEffects({ body, traceId }) {
  if (!hasValue(traceId) || !isRecord(body)) {
    return false;
  }
  return !JSON.stringify(body).includes(traceId);
}

function hasDomainPersistenceSummary({
  body,
  courseId,
  recordId,
  operationId,
  actionSlot,
  objectType,
  objectTypes,
}) {
  if (!recordId || !isRecord(body) || !isRecord(body.domainPersistenceSummary)) {
    return false;
  }
  const summary = body.domainPersistenceSummary;
  const expectedObjectTypes = Array.isArray(objectTypes) ? objectTypes : [objectType];
  if (!expectedObjectTypes.every(hasValue)) {
    return false;
  }
  return (
    summary.status === "persisted" &&
    summary.required === true &&
    summary.operationId === operationId &&
    summary.actionSlot === actionSlot &&
    summary.operationReceiptId === recordId &&
    summary.courseId === courseId &&
    Array.isArray(summary.expectedObjectTypes) &&
    expectedObjectTypes.every((expectedObjectType) =>
      summary.expectedObjectTypes.includes(expectedObjectType),
    ) &&
    Array.isArray(summary.persistedObjectTypes) &&
    expectedObjectTypes.every((expectedObjectType) =>
      summary.persistedObjectTypes.includes(expectedObjectType),
    ) &&
    Array.isArray(summary.missingObjectTypes) &&
    summary.missingObjectTypes.length === 0 &&
    Number.isInteger(summary.receiptCount) &&
    summary.receiptCount >= expectedObjectTypes.length &&
    Array.isArray(summary.storageWritePolicies) &&
    summary.storageWritePolicies.includes("external-optimistic-snapshot-replace") &&
    summary.responsibleSession === "S12" &&
    isRedactionReady(summary.redaction)
  );
}

function isRedactionReady(value) {
  return (
    isRecord(value) &&
    value.secrets === "omitted" &&
    value.localFiles === "omitted" &&
    value.assets === "ids-only"
  );
}

function hasCourseSettingsDomainObject({ body, courseId, recordId }) {
  if (!isRecord(body) || !isRecord(body.database) || !Array.isArray(body.database.courseSettings)) {
    return false;
  }

  return body.database.courseSettings.some(
    (settings) =>
      isRecord(settings) &&
      settings.settingsId === `course-settings-${courseId}` &&
      settings.courseId === courseId &&
      settings.ownerTeacherId === getExpectedSmokeTeacherId() &&
      settings.updatedBy === getExpectedSmokeTeacherId() &&
      settings.settingsStatus === "saved" &&
      settings.operationRecordId === recordId &&
      settings.sourceAction === "route-smoke" &&
      settings.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      settings.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasCourseSettingsPatchReadback({ body, courseId, recordId }) {
  if (!isRecord(body) || !isRecord(body.database) || !Array.isArray(body.database.courseSettings)) {
    return false;
  }

  return body.database.courseSettings.some(
    (settings) =>
      isRecord(settings) &&
      settings.settingsId === `course-settings-${courseId}` &&
      settings.courseId === courseId &&
      settings.operationRecordId === recordId &&
      Array.isArray(settings.appliedFields) &&
      settings.appliedFields.includes("courseName") &&
      settings.appliedFields.includes("semester") &&
      settings.appliedFields.includes("description") &&
      settings.courseName === "Route Smoke Applied Course Settings" &&
      settings.semester === "2026 Fall" &&
      settings.description ===
        "Route smoke verifies persisted course settings patch readback.",
  );
}

function hasStudentPreviewSessionDomainObject({ body, courseId, recordId }) {
  if (
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.studentPreviewSessions)
  ) {
    return false;
  }

  return body.database.studentPreviewSessions.some(
    (session) =>
      isRecord(session) &&
      session.previewSessionId === `student-preview-session-${courseId}` &&
      session.courseId === courseId &&
      session.ownerTeacherId === getExpectedSmokeTeacherId() &&
      session.previewedBy === getExpectedSmokeTeacherId() &&
      session.previewStatus === "generated" &&
      session.operationRecordId === recordId &&
      session.sourceAction === "route-smoke-student-preview" &&
      typeof session.previewId === "string" &&
      session.previewId.startsWith("student-preview-") &&
      session.previewUrl === `/learning?teacherPreview=1&course=${courseId}` &&
      session.previewScope === "teacher-course-preview" &&
      session.previewPolicy === "teacher-visible-preview-only" &&
      session.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      session.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasStudentRosterSyncDomainObject({ body, courseId, recordId }) {
  if (!isRecord(body) || !isRecord(body.database) || !Array.isArray(body.database.studentRosters)) {
    return false;
  }

  return body.database.studentRosters.some(
    (roster) =>
      isRecord(roster) &&
      roster.rosterId === `student-roster-${courseId}` &&
      roster.courseId === courseId &&
      roster.ownerTeacherId === getExpectedSmokeTeacherId() &&
      roster.syncedBy === getExpectedSmokeTeacherId() &&
      roster.syncStatus === "synced" &&
      roster.operationRecordId === recordId &&
      roster.sourceAction === "route-smoke-student-roster" &&
      roster.approvedStudentCount >= 0 &&
      roster.pendingTeacherReviewCount >= 0 &&
      roster.classCount >= 1 &&
      Array.isArray(roster.sourceSystems) &&
      roster.sourceSystems.includes("sis-roster") &&
      roster.sourceSystems.includes("invite-code-joins") &&
      roster.sourceSystems.includes("withdrawals") &&
      roster.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      roster.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasStudentGroupSuggestionDomainObject({ body, courseId, recordId }) {
  if (
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.studentGroupSuggestions)
  ) {
    return false;
  }

  return body.database.studentGroupSuggestions.some(
    (suggestion) =>
      isRecord(suggestion) &&
      suggestion.groupSuggestionId === `group-suggestion-${courseId}` &&
      suggestion.courseId === courseId &&
      suggestion.ownerTeacherId === getExpectedSmokeTeacherId() &&
      suggestion.generatedBy === getExpectedSmokeTeacherId() &&
      suggestion.suggestionStatus === "generated" &&
      suggestion.operationRecordId === recordId &&
      suggestion.sourceAction === "route-smoke-student-group-suggestion" &&
      suggestion.suggestionScope === "teacher-editable-student-groups" &&
      Array.isArray(suggestion.sourceSignals) &&
      suggestion.sourceSignals.includes("learning-progress") &&
      suggestion.sourceSignals.includes("participation-frequency") &&
      suggestion.sourceSignals.includes("role-preferences") &&
      suggestion.reviewPolicy === "teacher-review-before-group-assignment" &&
      suggestion.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      suggestion.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasKnowledgeIndexSyncDomainObject({ body, courseId, recordId }) {
  if (!isRecord(body) || !isRecord(body.database) || !Array.isArray(body.database.knowledgeIndexes)) {
    return false;
  }

  return body.database.knowledgeIndexes.some(
    (index) =>
      isRecord(index) &&
      index.indexId === `knowledge-index-${courseId}` &&
      index.courseId === courseId &&
      index.ownerTeacherId === getExpectedSmokeTeacherId() &&
      index.syncedBy === getExpectedSmokeTeacherId() &&
      index.syncStatus === "synced" &&
      index.operationRecordId === recordId &&
      index.sourceAction === "route-smoke-knowledge-index" &&
      Array.isArray(index.sourceSystems) &&
      index.sourceSystems.includes("course-files") &&
      index.sourceSystems.includes("teacher-resources") &&
      index.sourceSystems.includes("agent-grounding-index") &&
      index.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      index.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasResourceReviewItemDomainObject({ body, courseId, recordId }) {
  if (
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.resourceReviewItems)
  ) {
    return false;
  }

  return body.database.resourceReviewItems.some(
    (item) =>
      isRecord(item) &&
      item.resourceReviewItemId === `resource-review-item-${courseId}` &&
      item.courseId === courseId &&
      item.ownerTeacherId === getExpectedSmokeTeacherId() &&
      item.queuedBy === getExpectedSmokeTeacherId() &&
      item.reviewStatus === "pending-teacher-review" &&
      item.operationRecordId === recordId &&
      item.sourceAction === "route-smoke-resource-review" &&
      item.resourceSource === "teacher-placeholder" &&
      item.reviewPolicy === "teacher-review-before-knowledge-index" &&
      item.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      item.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasCourseContentPublishDomainObject({ body, courseId, recordId }) {
  if (!isRecord(body) || !isRecord(body.database) || !Array.isArray(body.database.contentPackages)) {
    return false;
  }

  return body.database.contentPackages.some(
    (content) =>
      isRecord(content) &&
      content.contentId === `course-content-${courseId}` &&
      content.courseId === courseId &&
      content.ownerTeacherId === getExpectedSmokeTeacherId() &&
      content.publishedBy === getExpectedSmokeTeacherId() &&
      content.publicationStatus === "published" &&
      content.operationRecordId === recordId &&
      content.sourceAction === "route-smoke-course-content" &&
      content.releaseScope === "course-visible-content" &&
      content.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      content.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasCourseUnitDraftDomainObject({ body, courseId, recordId }) {
  if (!isRecord(body) || !isRecord(body.database) || !Array.isArray(body.database.courseUnitDrafts)) {
    return false;
  }

  return body.database.courseUnitDrafts.some(
    (draft) =>
      isRecord(draft) &&
      draft.unitDraftId === `course-unit-draft-${courseId}` &&
      draft.courseId === courseId &&
      draft.ownerTeacherId === getExpectedSmokeTeacherId() &&
      draft.generatedBy === getExpectedSmokeTeacherId() &&
      draft.draftStatus === "generated" &&
      draft.operationRecordId === recordId &&
      draft.sourceAction === "route-smoke-course-unit-draft" &&
      draft.draftScope === "teacher-editable-unit-plan" &&
      Array.isArray(draft.sourceSystems) &&
      draft.sourceSystems.includes("course-knowledge-index") &&
      draft.sourceSystems.includes("teaching-objectives") &&
      draft.sourceSystems.includes("quiz-bank") &&
      draft.reviewPolicy === "teacher-review-before-student-release" &&
      draft.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      draft.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasDashboardRefreshDomainObject({ body, courseId, recordId }) {
  if (!isRecord(body) || !isRecord(body.database) || !Array.isArray(body.database.dashboardStates)) {
    return false;
  }

  return body.database.dashboardStates.some(
    (state) =>
      isRecord(state) &&
      state.dashboardStateId === `dashboard-state-${courseId}` &&
      state.courseId === courseId &&
      state.ownerTeacherId === getExpectedSmokeTeacherId() &&
      state.refreshedBy === getExpectedSmokeTeacherId() &&
      state.refreshStatus === "refreshed" &&
      state.operationRecordId === recordId &&
      state.sourceAction === "route-smoke-dashboard-state" &&
      Array.isArray(state.visibleMetrics) &&
      state.visibleMetrics.includes("engagement") &&
      state.visibleMetrics.includes("progress") &&
      state.visibleMetrics.includes("assessment-quality") &&
      state.refreshPolicy === "teacher-visible-course-dashboard" &&
      state.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      state.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasDashboardSnapshotDomainObject({ body, courseId, recordId }) {
  if (
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.dashboardSnapshots)
  ) {
    return false;
  }

  return body.database.dashboardSnapshots.some(
    (snapshot) =>
      isRecord(snapshot) &&
      snapshot.dashboardSnapshotId === `dashboard-snapshot-${courseId}` &&
      snapshot.courseId === courseId &&
      snapshot.ownerTeacherId === getExpectedSmokeTeacherId() &&
      snapshot.lockedBy === getExpectedSmokeTeacherId() &&
      snapshot.snapshotStatus === "locked" &&
      snapshot.operationRecordId === recordId &&
      snapshot.sourceAction === "route-smoke-dashboard-snapshot" &&
      typeof snapshot.teachingOperationSnapshotId === "string" &&
      snapshot.teachingOperationSnapshotId.startsWith("daily-snapshot-") &&
      snapshot.snapshotScope === "daily-course-dashboard" &&
      snapshot.retentionPolicy === "teacher-locked-dashboard-snapshot" &&
      snapshot.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      snapshot.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasQuizAssessmentDomainObject({ body, courseId, recordId }) {
  if (
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.quizAssessments)
  ) {
    return false;
  }

  return body.database.quizAssessments.some(
    (assessment) =>
      isRecord(assessment) &&
      assessment.quizAssessmentId === `quiz-assessment-${courseId}` &&
      assessment.courseId === courseId &&
      assessment.ownerTeacherId === getExpectedSmokeTeacherId() &&
      assessment.refreshedBy === getExpectedSmokeTeacherId() &&
      assessment.assessmentStatus === "refreshed" &&
      assessment.operationRecordId === recordId &&
      assessment.sourceAction === "route-smoke-quiz-assessment" &&
      assessment.quizBoardStateId === `quiz-board-state-${courseId}` &&
      Array.isArray(assessment.visibleMetrics) &&
      assessment.visibleMetrics.includes("completion-rate") &&
      assessment.visibleMetrics.includes("item-quality") &&
      assessment.visibleMetrics.includes("misconception-clusters") &&
      assessment.reviewPolicy === "teacher-visible-quiz-quality-board" &&
      assessment.reusePolicy === "teacher-review-before-quiz-reuse" &&
      assessment.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      assessment.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasAdminSettingsDomainObject({ body, courseId, recordId }) {
  if (!isRecord(body) || !isRecord(body.database) || !Array.isArray(body.database.adminSettings)) {
    return false;
  }

  return body.database.adminSettings.some(
    (settings) =>
      isRecord(settings) &&
      settings.adminSettingsId === `admin-settings-${courseId}` &&
      settings.courseId === courseId &&
      settings.ownerTeacherId === getExpectedSmokeTeacherId() &&
      settings.savedBy === getExpectedSmokeTeacherId() &&
      settings.settingsStatus === "saved" &&
      settings.operationRecordId === recordId &&
      settings.sourceAction === "route-smoke-admin-settings" &&
      Array.isArray(settings.adminScopes) &&
      settings.adminScopes.includes("course-collaborators") &&
      settings.adminScopes.includes("permission-boundary") &&
      settings.adminScopes.includes("audit-routing") &&
      settings.governancePolicy === "teacher-controlled-admin-settings" &&
      settings.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      settings.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasQuizItemReviewDomainObject({ body, courseId, recordId }) {
  if (
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.quizItemReviews)
  ) {
    return false;
  }

  return body.database.quizItemReviews.some(
    (review) =>
      isRecord(review) &&
      review.quizItemReviewId === `quiz-item-review-${courseId}` &&
      review.courseId === courseId &&
      review.ownerTeacherId === getExpectedSmokeTeacherId() &&
      review.flaggedBy === getExpectedSmokeTeacherId() &&
      review.reviewStatus === "flagged-for-review" &&
      review.operationRecordId === recordId &&
      review.sourceAction === "route-smoke-quiz-item-review" &&
      Array.isArray(review.flaggedSignals) &&
      review.flaggedSignals.includes("low-discrimination") &&
      review.flaggedSignals.includes("high-error-rate") &&
      review.flaggedSignals.includes("teacher-review-needed") &&
      review.reviewPolicy === "teacher-review-before-quiz-reuse" &&
      review.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      review.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasAgentSettingsDomainObject({ body, courseId, recordId }) {
  if (!isRecord(body) || !isRecord(body.database) || !Array.isArray(body.database.agentSettings)) {
    return false;
  }

  return body.database.agentSettings.some(
    (settings) =>
      isRecord(settings) &&
      settings.agentSettingsId === `agent-settings-${courseId}` &&
      settings.courseId === courseId &&
      settings.ownerTeacherId === getExpectedSmokeTeacherId() &&
      settings.savedBy === getExpectedSmokeTeacherId() &&
      settings.settingsStatus === "saved" &&
      settings.operationRecordId === recordId &&
      settings.sourceAction === "route-smoke-agent-settings" &&
      Array.isArray(settings.agentScopes) &&
      settings.agentScopes.includes("research-agent") &&
      settings.agentScopes.includes("method-agent") &&
      settings.agentScopes.includes("writing-agent") &&
      settings.agentScopes.includes("math-agent") &&
      settings.governancePolicy === "teacher-controlled-agent-settings" &&
      settings.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      settings.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasAgentPermissionPreflightDomainObject({ body, courseId, recordId }) {
  if (
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.agentPermissionPreflights)
  ) {
    return false;
  }

  return body.database.agentPermissionPreflights.some(
    (preflight) =>
      isRecord(preflight) &&
      preflight.preflightId === `agent-permission-preflight-${courseId}` &&
      preflight.courseId === courseId &&
      preflight.ownerTeacherId === getExpectedSmokeTeacherId() &&
      preflight.checkedBy === getExpectedSmokeTeacherId() &&
      preflight.preflightStatus === "passed" &&
      preflight.operationRecordId === recordId &&
      preflight.sourceAction === "route-smoke-agent-permission-preflight" &&
      Array.isArray(preflight.checkedPermissions) &&
      preflight.checkedPermissions.includes("course-bindings") &&
      preflight.checkedPermissions.includes("agent-roles") &&
      preflight.checkedPermissions.includes("student-access") &&
      preflight.preflightPolicy === "teacher-agent-permission-gate" &&
      preflight.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      preflight.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasCollaborationInviteNotificationDomainObject({ body, courseId, recordId }) {
  if (
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.collaborationInviteNotifications)
  ) {
    return false;
  }

  return body.database.collaborationInviteNotifications.some(
    (notification) =>
      isRecord(notification) &&
      notification.notificationId === `collaboration-invite-notification-${courseId}` &&
      notification.courseId === courseId &&
      notification.ownerTeacherId === getExpectedSmokeTeacherId() &&
      notification.queuedBy === getExpectedSmokeTeacherId() &&
      notification.notificationStatus === "delivery-failed" &&
      notification.operationRecordId === recordId &&
      notification.sourceAction === "route-smoke-collaboration-invite" &&
      notification.deliveryChannel === "collaboration-invite-email" &&
      notification.providerStatus === "smtp-provider-bounced" &&
      notification.providerDeliveryId ===
        "email-delivery-collaboration-invite-route-smoke" &&
      notification.deliveryFailureReason === "route-smoke-bounce" &&
      notification.providerCallbackAt === "2026-06-23T00:05:45.000Z" &&
      notification.deliveryPolicy === "server-outbox-before-smtp-provider" &&
      notification.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      notification.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasCourseExportManifestDomainObject({ body, courseId, recordId }) {
  if (
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.exportManifests)
  ) {
    return false;
  }

  return body.database.exportManifests.some(
    (manifest) =>
      isRecord(manifest) &&
      manifest.exportManifestId === `export-manifest-${courseId}` &&
      manifest.courseId === courseId &&
      manifest.ownerTeacherId === getExpectedSmokeTeacherId() &&
      manifest.createdBy === getExpectedSmokeTeacherId() &&
      manifest.exportStatus === "generated" &&
      manifest.operationRecordId === recordId &&
      manifest.sourceAction === "route-smoke-export-manifest" &&
      typeof manifest.teachingOperationManifestId === "string" &&
      typeof manifest.downloadRoute === "string" &&
      manifest.downloadRoute.endsWith(manifest.teachingOperationManifestId) &&
      Array.isArray(manifest.datasetScopes) &&
      manifest.datasetScopes.includes("learning-records") &&
      manifest.datasetScopes.includes("chat-threads") &&
      manifest.datasetScopes.includes("grades") &&
      manifest.datasetScopes.includes("activities") &&
      Array.isArray(manifest.formats) &&
      manifest.formats.includes("json") &&
      manifest.formats.includes("csv") &&
      manifest.exportPolicy === "redacted-teacher-export-manifest" &&
      manifest.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      manifest.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasCourseExportRedactionValidationDomainObject({ body, courseId, recordId }) {
  if (
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.exportRedactionValidations)
  ) {
    return false;
  }

  return body.database.exportRedactionValidations.some(
    (validation) =>
      isRecord(validation) &&
      validation.exportRedactionValidationId === `export-redaction-validation-${courseId}` &&
      validation.courseId === courseId &&
      validation.ownerTeacherId === getExpectedSmokeTeacherId() &&
      validation.validatedBy === getExpectedSmokeTeacherId() &&
      validation.validationStatus === "passed" &&
      validation.operationRecordId === recordId &&
      validation.sourceAction === "route-smoke-export-redaction" &&
      Array.isArray(validation.checkedScopes) &&
      validation.checkedScopes.includes("identity-fields") &&
      validation.checkedScopes.includes("ai-chat-transcripts") &&
      validation.checkedScopes.includes("voice-references") &&
      validation.checkedScopes.includes("local-file-paths") &&
      validation.blockedSecretCount === 0 &&
      validation.validationPolicy === "no-secrets-or-local-paths-before-export" &&
      validation.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      validation.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasGradingQueueDomainObject({ body, courseId, recordId }) {
  if (!isRecord(body) || !isRecord(body.database) || !Array.isArray(body.database.gradingQueues)) {
    return false;
  }

  return body.database.gradingQueues.some(
    (queue) =>
      isRecord(queue) &&
      queue.gradingQueueId === `grading-queue-${courseId}` &&
      queue.courseId === courseId &&
      queue.ownerTeacherId === getExpectedSmokeTeacherId() &&
      queue.savedBy === getExpectedSmokeTeacherId() &&
      queue.queueStatus === "saved" &&
      queue.operationRecordId === recordId &&
      queue.sourceAction === "route-smoke-gradebook-release" &&
      queue.gradebookUpdateId === `gradebook-update-${courseId}` &&
      queue.reviewPolicy === "teacher-review-before-release" &&
      queue.releasePolicy === "teacher-confirmed-grade-release" &&
      queue.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      queue.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasGradebookUpdateDomainObject({ body, courseId, recordId }) {
  if (!isRecord(body) || !isRecord(body.database) || !Array.isArray(body.database.gradebookUpdates)) {
    return false;
  }

  return body.database.gradebookUpdates.some(
    (update) =>
      isRecord(update) &&
      update.objectId === `gradebook-update-${courseId}` &&
      update.objectType === "gradebook-update" &&
      update.courseId === courseId &&
      update.updatedBy === getExpectedSmokeTeacherId() &&
      update.updateStatus === "pending-release" &&
      update.operationRecordId === recordId &&
      update.sourceAction === "route-smoke-gradebook-release" &&
      update.releasePolicy === "teacher-confirmed-grade-release" &&
      update.storagePolicy === "domain-projection-teaching-gradebook-update",
  );
}

function hasGradingFeedbackDraftDomainObject({ body, courseId, recordId }) {
  if (
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.gradingFeedbackDrafts)
  ) {
    return false;
  }

  return body.database.gradingFeedbackDrafts.some(
    (draft) =>
      isRecord(draft) &&
      draft.gradingFeedbackDraftId === `grading-feedback-draft-${courseId}` &&
      draft.courseId === courseId &&
      draft.ownerTeacherId === getExpectedSmokeTeacherId() &&
      draft.generatedBy === getExpectedSmokeTeacherId() &&
      draft.feedbackStatus === "generated" &&
      draft.operationRecordId === recordId &&
      draft.sourceAction === "route-smoke-grading-feedback" &&
      typeof draft.teachingOperationFeedbackArtifactId === "string" &&
      draft.teachingOperationFeedbackArtifactId.startsWith("ai-feedback-") &&
      draft.feedbackScope === "grading-review-queue" &&
      draft.reviewPolicy === "teacher-review-before-student-release" &&
      draft.releasePolicy === "teacher-confirmed-feedback-release" &&
      draft.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      draft.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function hasRollbackReadback({ body, courseId, recordId }) {
  if (!recordId || !isRecord(body) || !Array.isArray(body.rollbackRecords)) {
    return false;
  }
  return body.rollbackRecords.some(
    (rollbackRecord) =>
      isRecord(rollbackRecord) &&
      rollbackRecord.action === "rollback-teaching-operation-record" &&
      rollbackRecord.targetRecordId === recordId &&
      rollbackRecord.courseId === courseId &&
      rollbackRecord.status === "persisted" &&
      rollbackRecord.storagePolicy === "external-redacted-teaching-operation-rollback" &&
      rollbackRecord.storageWritePolicy === "external-append-only-rollback-log",
  );
}

function isRollbackTraceClosureReady({ response, courseId, recordId, traceId }) {
  const body = response.body;
  if (
    response.statusCode !== 200 ||
    readTraceHeader(response.headers) !== traceId ||
    !isRecord(body) ||
    body.traceId !== traceId ||
    !isRecord(body.receipt)
  ) {
    return false;
  }
  return (
    body.receipt.action === "rollback-teaching-operation-record" &&
    body.receipt.courseId === courseId &&
    body.receipt.targetRecordId === recordId &&
    body.receipt.traceId === traceId &&
    body.receipt.status === "persisted"
  );
}

function isAlertSummaryReady(body) {
  if (!isRecord(body)) {
    return false;
  }
  return (
    body.status === "attention-required" &&
    body.eventType === "teaching-operation-audit-alert-summary" &&
    body.storagePolicy === "external-redacted-teaching-operation-audit-alerts" &&
    body.alertCount >= 1 &&
    Array.isArray(body.alerts) &&
    body.alerts.some(
      (alert) =>
        isRecord(alert) &&
        alert.severity === "high" &&
        alert.reason === "missing-course-context" &&
        alert.traceId === "trace-teaching-operations-route-smoke-alert" &&
        alert.actorId === getExpectedSmokeTeacherId(),
    )
  );
}

function isAlertNotificationDispatchReady(body) {
  if (!isRecord(body)) {
    return false;
  }
  return (
    body.status === "queued" &&
    body.eventType === "teaching-operation-audit-alert-notification-dispatch" &&
    body.storagePolicy ===
      "external-redacted-teaching-operation-audit-alert-notification-outbox" &&
    body.notificationCount >= 1 &&
    Array.isArray(body.notifications) &&
    body.notifications.some(
      (notification) =>
        isRecord(notification) &&
        notification.deliveryStatus === "queued" &&
        notification.traceId === "trace-teaching-operations-route-smoke-alert",
    )
  );
}

function isAlertNotificationReadbackReady(body) {
  if (!isRecord(body)) {
    return false;
  }
  return (
    body.eventType === "teaching-operation-audit-alert-notification-outbox" &&
    body.storagePolicy ===
      "external-redacted-teaching-operation-audit-alert-notification-outbox" &&
    body.recordCount >= 1 &&
    Array.isArray(body.notifications) &&
    body.notifications.some(
      (notification) =>
        isRecord(notification) &&
        notification.deliveryStatus === "queued" &&
        notification.traceId === "trace-teaching-operations-route-smoke-alert",
    )
  );
}

function findPublishedInviteCode(body) {
  if (!isRecord(body) || !isRecord(body.receipt) || !Array.isArray(body.receipt.artifacts)) {
    return undefined;
  }
  const inviteArtifact = body.receipt.artifacts.find(
    (artifact) =>
      isRecord(artifact) &&
      artifact.kind === "invite-code" &&
      artifact.status === "published" &&
      typeof artifact.code === "string" &&
      /^\d{8}$/.test(artifact.code),
  );
  return typeof inviteArtifact?.code === "string" ? inviteArtifact.code : undefined;
}

function findGeneratedInviteCode(body) {
  if (!isRecord(body) || !isRecord(body.receipt) || !Array.isArray(body.receipt.artifacts)) {
    return undefined;
  }
  const inviteArtifact = body.receipt.artifacts.find(
    (artifact) =>
      isRecord(artifact) &&
      artifact.kind === "invite-code" &&
      artifact.status === "generated" &&
      typeof artifact.code === "string" &&
      /^\d{8}$/.test(artifact.code),
  );
  return typeof inviteArtifact?.code === "string" ? inviteArtifact.code : undefined;
}

function findExportManifestId(body) {
  if (!isRecord(body) || !isRecord(body.receipt) || !Array.isArray(body.receipt.artifacts)) {
    return undefined;
  }
  const exportArtifact = body.receipt.artifacts.find(
    (artifact) =>
      isRecord(artifact) &&
      artifact.kind === "export-file" &&
      typeof artifact.manifestId === "string" &&
      typeof artifact.downloadUrl === "string" &&
      artifact.downloadUrl.endsWith(artifact.manifestId),
  );
  return typeof exportArtifact?.manifestId === "string" ? exportArtifact.manifestId : undefined;
}

function hasExportManifestDownloadReadback({ body, courseId, manifestId }) {
  return (
    typeof manifestId === "string" &&
    isRecord(body) &&
    body.manifestId === manifestId &&
    body.operationId === "data-export" &&
    body.courseId === courseId &&
    body.actorId === getExpectedSmokeTeacherId() &&
    Array.isArray(body.datasets) &&
    body.datasets.includes("learning-records") &&
    body.datasets.includes("chat-threads") &&
    body.datasets.includes("grades") &&
    body.datasets.includes("activities") &&
    Array.isArray(body.formats) &&
    body.formats.includes("json") &&
    body.formats.includes("csv") &&
    isRecord(body.redactionScope) &&
    body.redactionScope.studentPrivateNotes === "excluded" &&
    body.redactionScope.credentials === "excluded" &&
    body.redactionScope.localPaths === "excluded" &&
    isRecord(body.redaction) &&
    body.redaction.secrets === "omitted" &&
    body.redaction.localFiles === "omitted" &&
    body.redaction.assets === "ids-only"
  );
}

function hasInviteCodeDraftDomainObject({ body, courseId, classId, inviteCode, recordId }) {
  if (
    !inviteCode ||
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.inviteCodeDrafts)
  ) {
    return false;
  }

  return body.database.inviteCodeDrafts.some(
    (draft) =>
      isRecord(draft) &&
      draft.inviteCodeDraftId === `invite-code-draft-${courseId}-${inviteCode}` &&
      draft.courseId === courseId &&
      draft.classId === classId &&
      draft.ownerTeacherId === getExpectedSmokeTeacherId() &&
      draft.generatedBy === getExpectedSmokeTeacherId() &&
      draft.draftStatus === "generated" &&
      draft.operationRecordId === recordId &&
      draft.sourceAction === "route-smoke-invite-draft" &&
      draft.inviteCode === inviteCode &&
      draft.joinUrl === `/courses?invite=${inviteCode}` &&
      draft.invitePolicy === "teacher-review-before-publication" &&
      draft.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
      draft.storageWritePolicy === "external-optimistic-snapshot-replace",
  );
}

function isInvitePublishClassJoinEntryReady({ body, courseId, classId, inviteCode }) {
  if (!inviteCode || !isRecord(body) || !isRecord(body.classInvitePublicationReceipt)) {
    return false;
  }
  const receipt = body.classInvitePublicationReceipt;
  return (
    receipt.action === "publish-class-invite-code" &&
    receipt.actorId === getExpectedSmokeTeacherId() &&
    receipt.courseId === courseId &&
    receipt.classId === classId &&
    receipt.status === "persisted" &&
    receipt.storagePolicy === "external-redacted-teaching-course-management-snapshot" &&
    receipt.storageWritePolicy === "external-optimistic-snapshot-replace"
  );
}

function isStudentInviteJoinReady({ body, courseId, classId, inviteCode }) {
  if (!inviteCode || !isRecord(body) || !isRecord(body.membership) || !isRecord(body.receipt)) {
    return false;
  }
  return (
    body.membership.courseId === courseId &&
    body.membership.classId === classId &&
    body.membership.invitationCode === inviteCode &&
    body.membership.membershipStatus === "pending-teacher-review" &&
    body.receipt.action === "join-class-by-invite" &&
    body.receipt.courseId === courseId &&
    body.receipt.classId === classId &&
    body.receipt.status === "persisted"
  );
}

function isUnauthenticatedMutationDeniedReady({ response }) {
  return response.statusCode === 401 || response.statusCode === 403;
}

function isSignedStudentMutationDeniedReady({ response }) {
  return response.statusCode === 403;
}

function isGradebookReleaseTraceClosureReady({ response, courseId, gradebookUpdateId, traceId }) {
  const body = response.body;
  if (
    response.statusCode !== 200 ||
    readTraceHeader(response.headers) !== traceId ||
    !isRecord(body) ||
    body.traceId !== traceId ||
    !isRecord(body.gradebookUpdate) ||
    !isRecord(body.notification) ||
    !isRecord(body.receipt)
  ) {
    return false;
  }
  return (
    body.gradebookUpdate.objectId === gradebookUpdateId &&
    body.gradebookUpdate.objectType === "gradebook-update" &&
    body.gradebookUpdate.courseId === courseId &&
    body.gradebookUpdate.updateStatus === "released" &&
    body.notification.objectType === "grade-release-notification" &&
    body.notification.gradebookUpdateId === gradebookUpdateId &&
    body.receipt.action === "release-gradebook-update" &&
    body.receipt.courseId === courseId &&
    body.receipt.gradebookUpdateId === gradebookUpdateId &&
    body.receipt.traceId === traceId &&
    body.receipt.status === "persisted"
  );
}

function isGradebookRollbackTraceClosureReady({ response, courseId, gradebookUpdateId, traceId }) {
  const body = response.body;
  if (
    response.statusCode !== 200 ||
    readTraceHeader(response.headers) !== traceId ||
    !isRecord(body) ||
    body.traceId !== traceId ||
    !isRecord(body.gradebookUpdate) ||
    !isRecord(body.notification) ||
    !isRecord(body.receipt)
  ) {
    return false;
  }
  return (
    body.gradebookUpdate.objectId === gradebookUpdateId &&
    body.gradebookUpdate.objectType === "gradebook-update" &&
    body.gradebookUpdate.courseId === courseId &&
    body.gradebookUpdate.updateStatus === "release-rolled-back" &&
    body.notification.objectType === "grade-release-rollback-notification" &&
    body.notification.gradebookUpdateId === gradebookUpdateId &&
    body.receipt.action === "rollback-gradebook-release" &&
    body.receipt.courseId === courseId &&
    body.receipt.gradebookUpdateId === gradebookUpdateId &&
    body.receipt.traceId === traceId &&
    body.receipt.status === "persisted"
  );
}

function isGradebookExternalStorageReceiptReady({ response, action }) {
  const body = response.body;
  if (response.statusCode !== 200 || !isRecord(body) || !isRecord(body.receipt)) {
    return false;
  }
  return (
    body.receipt.action === action &&
    body.receipt.storagePolicy === "external-redacted-teaching-operation-append" &&
    body.receipt.storageWritePolicy === "external-append-only-operation-log"
  );
}

function isGradebookProviderReleaseReceiptReady({ response }) {
  const body = response.body;
  if (
    response.statusCode !== 200 ||
    !isRecord(body) ||
    !isRecord(body.gradebookUpdate) ||
    !isRecord(body.receipt)
  ) {
    return false;
  }
  return (
    body.gradebookUpdate.providerStatus === "gradebook-provider-released" &&
    typeof body.gradebookUpdate.providerReleaseId === "string" &&
    body.gradebookUpdate.providerReleaseId.length > 0 &&
    body.receipt.providerStatus === "gradebook-provider-released" &&
    typeof body.receipt.providerReleaseId === "string" &&
    body.receipt.providerReleaseId.length > 0
  );
}

function isGradebookProviderRollbackReceiptReady({ response }) {
  const body = response.body;
  if (
    response.statusCode !== 200 ||
    !isRecord(body) ||
    !isRecord(body.gradebookUpdate) ||
    !isRecord(body.receipt)
  ) {
    return false;
  }
  return (
    body.gradebookUpdate.providerRollbackStatus ===
      "gradebook-provider-release-rolled-back" &&
    typeof body.gradebookUpdate.providerRollbackId === "string" &&
    body.gradebookUpdate.providerRollbackId.length > 0 &&
    body.receipt.providerRollbackStatus === "gradebook-provider-release-rolled-back" &&
    typeof body.receipt.providerRollbackId === "string" &&
    body.receipt.providerRollbackId.length > 0
  );
}

function hasGradebookAuditSourceReadback({
  body,
  courseId,
  gradebookUpdateId,
  traceId,
  eventType,
}) {
  if (!isRecord(body) || !Array.isArray(body.auditEvents)) {
    return false;
  }
  return body.auditEvents.some(
    (event) =>
      isRecord(event) &&
      event.eventType === eventType &&
      event.traceId === traceId &&
      event.actorId === getExpectedSmokeTeacherId() &&
      event.courseId === courseId &&
      event.gradebookUpdateId === gradebookUpdateId &&
      isRecord(event.requestSource) &&
      event.requestSource.userAgent === "UAIS teaching operations route smoke" &&
      event.requestSource.ipAddress === "redacted",
  );
}

function hasCourseManagementAuditSourceReadback({
  body,
  courseId,
  traceId,
  action,
  expectedUserAgent = "UAIS teaching operations route smoke",
}) {
  if (
    !isRecord(body) ||
    !isRecord(body.database) ||
    !Array.isArray(body.database.auditEvents)
  ) {
    return false;
  }

  return body.database.auditEvents.some(
    (event) =>
      isRecord(event) &&
      event.action === action &&
      event.traceId === traceId &&
      event.actorId === getExpectedSmokeTeacherId() &&
      event.actorRole === "teacher" &&
      event.authMode === "signed-teacher-session" &&
      event.courseId === courseId &&
      isRecord(event.requestSource) &&
      event.requestSource.userAgent === expectedUserAgent &&
      event.requestSource.ipAddress === "redacted" &&
      event.storagePolicy === "external-redacted-teaching-course-management-audit-log",
  );
}

function isExternalBackupReady(body) {
  if (!isRecord(body) || !isRecord(body.sourceRecordCounts)) {
    return false;
  }
  return (
    body.teacherId === getExpectedSmokeTeacherId() &&
    typeof body.backupId === "string" &&
    body.status === "persisted" &&
    body.eventType === "teaching-operation-backup.created" &&
    body.traceId === "trace-teaching-operations-route-smoke-backup" &&
    body.storagePolicy === "external-redacted-teaching-operation-backup" &&
    body.storageWritePolicy === "external-atomic-backup-snapshot" &&
    body.responsibleSession === "S12" &&
    body.sourceRecordCounts.operations >= 1 &&
    body.sourceRecordCounts.auditEvents >= 1
  );
}

function isExternalRestoreDrillReady({ body, backupId }) {
  if (!backupId || !isRecord(body) || !isRecord(body.restoredRecordCounts)) {
    return false;
  }
  return (
    body.teacherId === getExpectedSmokeTeacherId() &&
    body.backupId === backupId &&
    body.status === "verified" &&
    body.eventType === "teaching-operation-backup.restore-drill-verified" &&
    body.traceId === "trace-teaching-operations-route-smoke-restore-drill" &&
    body.storagePolicy === "external-redacted-teaching-operation-restore-drill" &&
    body.storageWritePolicy === "external-append-only-restore-drill-log" &&
    body.responsibleSession === "S12" &&
    body.restoredRecordCounts.operations >= 1 &&
    body.restoredRecordCounts.auditEvents >= 1
  );
}

function isDirectBackupRestoreDisabledReady({ response, backupId }) {
  const body = response.body;
  if (
    !backupId ||
    response.statusCode !== 409 ||
    readTraceHeader(response.headers) !==
      "trace-teaching-operations-route-smoke-direct-restore" ||
    !isRecord(body) ||
    body.traceId !== "trace-teaching-operations-route-smoke-direct-restore" ||
    !isRecord(body.restorePlan)
  ) {
    return false;
  }
  return (
    body.restorePlan.status === "external-restore-drill-required" &&
    body.restorePlan.action === "verify-teaching-operation-backup-restore" &&
    body.restorePlan.backupId === backupId &&
    body.restorePlan.route ===
      `/api/external-storage/teaching-operations/${getExpectedSmokeTeacherId()}/backups/${backupId}/restore-drill` &&
    body.restorePlan.storagePolicy === "external-redacted-teaching-operation-restore-drill" &&
    body.restorePlan.storageWritePolicy === "external-append-only-restore-drill-log" &&
    body.restorePlan.responsibleSession === "S12"
  );
}

function isDirectBackupRestoreTraceClosureReady({ response, traceId }) {
  const body = response.body;
  return (
    response.statusCode === 409 &&
    readTraceHeader(response.headers) === traceId &&
    isRecord(body) &&
    body.traceId === traceId &&
    typeof body.error === "string" &&
    isRecord(body.redaction) &&
    body.redaction.secrets === "omitted" &&
    body.redaction.localFiles === "omitted"
  );
}

function isIdempotencyConflictDeniedReady({ response, traceId, idempotencyKey }) {
  const body = response.body;
  const bodyText = JSON.stringify(body ?? {});
  return (
    response.statusCode === 409 &&
    readTraceHeader(response.headers) === traceId &&
    isRecord(body) &&
    body.traceId === traceId &&
    typeof body.error === "string" &&
    body.error.toLowerCase().includes("idempotency key") &&
    isRecord(body.redaction) &&
    body.redaction.secrets === "omitted" &&
    body.redaction.localFiles === "omitted" &&
    !bodyText.includes("/Users/") &&
    !bodyText.includes(idempotencyKey) &&
    !bodyText.includes(encodeURIComponent(idempotencyKey))
  );
}

function isUnsafePathIdDeniedReady({ response, traceId, unsafeId }) {
  const body = response.body;
  const bodyText = JSON.stringify(body ?? {});
  return (
    response.statusCode === 400 &&
    readTraceHeader(response.headers) === traceId &&
    isRecord(body) &&
    typeof body.error === "string" &&
    body.error.toLowerCase().includes("invalid") &&
    isRecord(body.redaction) &&
    body.redaction.secrets === "omitted" &&
    body.redaction.localFiles === "omitted" &&
    !bodyText.includes(unsafeId) &&
    !bodyText.includes(encodeURIComponent(unsafeId))
  );
}

function createSkippedSmokeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
  };
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    environment: "local-production",
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
      options.environment = readNextArg(args, ++index, arg);
    } else if (arg === "--env-file") {
      options.envFile = readNextArg(args, ++index, arg);
    } else if (arg === "--base-url") {
      options.baseUrl = readNextArg(args, ++index, arg);
    } else if (arg === "--course-id") {
      options.courseId = readNextArg(args, ++index, arg);
    } else if (arg === "--class-id") {
      options.classId = readNextArg(args, ++index, arg);
    } else if (arg === "--teacher-id") {
      options.teacherId = readNextArg(args, ++index, arg);
    } else if (arg === "--cookie") {
      options.cookie = readNextArg(args, ++index, arg);
    } else if (arg === "--student-cookie") {
      options.studentCookie = readNextArg(args, ++index, arg);
    } else if (arg === "--release-run-id") {
      options.releaseRunId = readNextArg(args, ++index, arg);
    } else if (arg === "--vercel-production-deployment") {
      options.vercelProductionDeployment = readNextArg(args, ++index, arg);
    } else if (arg === "--deployment-domain-reachability") {
      options.deploymentDomainReachability = readNextArg(args, ++index, arg);
    } else if (arg === "--teacher-auth-provider-readiness") {
      options.teacherAuthProviderReadiness = readNextArg(args, ++index, arg);
    } else if (arg === "--app-auth-provider-readiness") {
      options.appAuthProviderReadiness = readNextArg(args, ++index, arg);
    } else if (arg === "--external-storage-service-readiness") {
      options.externalStorageServiceReadiness = readNextArg(args, ++index, arg);
    } else if (arg === "--teaching-operations-backend") {
      options.teachingOperationsBackend = readNextArg(args, ++index, arg);
    } else if (arg === "--teaching-course-management-backend") {
      options.teachingCourseManagementBackend = readNextArg(args, ++index, arg);
    } else if (arg === "--external-storage-base-url") {
      options.externalStorageBaseUrl = readNextArg(args, ++index, arg);
    } else if (arg === "--external-storage-access-token") {
      options.externalStorageAccessToken = readNextArg(args, ++index, arg);
    } else if (arg === "--collaboration-invite-email-provider") {
      options.collaborationInviteEmailProvider = readNextArg(args, ++index, arg);
    } else if (arg === "--collaboration-invite-email-provider-url") {
      options.collaborationInviteEmailProviderUrl = readNextArg(args, ++index, arg);
    } else if (arg === "--collaboration-invite-email-provider-token") {
      options.collaborationInviteEmailProviderToken = readNextArg(args, ++index, arg);
    } else if (arg === "--collaboration-invite-email-callback-token") {
      options.collaborationInviteEmailCallbackToken = readNextArg(args, ++index, arg);
    } else if (arg === "--student-roster-sync-provider") {
      options.studentRosterSyncProvider = readNextArg(args, ++index, arg);
    } else if (arg === "--student-roster-sync-provider-url") {
      options.studentRosterSyncProviderUrl = readNextArg(args, ++index, arg);
    } else if (arg === "--student-roster-sync-provider-token") {
      options.studentRosterSyncProviderToken = readNextArg(args, ++index, arg);
    } else if (arg === "--knowledge-index-sync-provider") {
      options.knowledgeIndexSyncProvider = readNextArg(args, ++index, arg);
    } else if (arg === "--knowledge-index-sync-provider-url") {
      options.knowledgeIndexSyncProviderUrl = readNextArg(args, ++index, arg);
    } else if (arg === "--knowledge-index-sync-provider-token") {
      options.knowledgeIndexSyncProviderToken = readNextArg(args, ++index, arg);
    } else if (arg === "--gradebook-release-provider") {
      options.gradebookReleaseProvider = readNextArg(args, ++index, arg);
    } else if (arg === "--gradebook-release-provider-url") {
      options.gradebookReleaseProviderUrl = readNextArg(args, ++index, arg);
    } else if (arg === "--gradebook-release-provider-token") {
      options.gradebookReleaseProviderToken = readNextArg(args, ++index, arg);
    } else if (arg === "--course-content-publish-provider") {
      options.courseContentPublishProvider = readNextArg(args, ++index, arg);
    } else if (arg === "--course-content-publish-provider-url") {
      options.courseContentPublishProviderUrl = readNextArg(args, ++index, arg);
    } else if (arg === "--course-content-publish-provider-token") {
      options.courseContentPublishProviderToken = readNextArg(args, ++index, arg);
    } else if (arg === "--course-export-provider") {
      options.courseExportProvider = readNextArg(args, ++index, arg);
    } else if (arg === "--course-export-provider-url") {
      options.courseExportProviderUrl = readNextArg(args, ++index, arg);
    } else if (arg === "--course-export-provider-token") {
      options.courseExportProviderToken = readNextArg(args, ++index, arg);
    } else if (arg === "--grading-feedback-provider") {
      options.gradingFeedbackProvider = readNextArg(args, ++index, arg);
    } else if (arg === "--grading-feedback-provider-url") {
      options.gradingFeedbackProviderUrl = readNextArg(args, ++index, arg);
    } else if (arg === "--grading-feedback-provider-token") {
      options.gradingFeedbackProviderToken = readNextArg(args, ++index, arg);
    } else {
      throw new Error(
        "Usage: node -- scripts/teaching-operations-route-smoke.mjs [--dry-run] [--live --approved] [--environment production|local-production] [--base-url URL] [--env-file PATH] [--teacher-id ID] [--course-id ID] [--cookie COOKIE] [--release-run-id ID] [--vercel-production-deployment PATH] [--deployment-domain-reachability PATH] [--teacher-auth-provider-readiness PATH] [--app-auth-provider-readiness PATH] [--external-storage-service-readiness PATH] [--teaching-operations-backend external] [--teaching-course-management-backend external] [--external-storage-base-url URL] [--external-storage-access-token TOKEN] [--collaboration-invite-email-provider external] [--collaboration-invite-email-provider-url URL] [--collaboration-invite-email-provider-token TOKEN] [--collaboration-invite-email-callback-token TOKEN] [--student-roster-sync-provider external] [--student-roster-sync-provider-url URL] [--student-roster-sync-provider-token TOKEN] [--knowledge-index-sync-provider external] [--knowledge-index-sync-provider-url URL] [--knowledge-index-sync-provider-token TOKEN] [--gradebook-release-provider external] [--gradebook-release-provider-url URL] [--gradebook-release-provider-token TOKEN] [--course-content-publish-provider external] [--course-content-publish-provider-url URL] [--course-content-publish-provider-token TOKEN] [--course-export-provider external] [--course-export-provider-url URL] [--course-export-provider-token TOKEN] [--grading-feedback-provider external] [--grading-feedback-provider-url URL] [--grading-feedback-provider-token TOKEN]",
      );
    }
  }
  return options;
}

function readNextArg(args, index, flag) {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function readEnvFile(envFile) {
  if (!envFile) {
    return {};
  }
  const entries = {};
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    entries[trimmed.slice(0, separatorIndex)] = trimmed.slice(separatorIndex + 1);
  }
  return entries;
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
      releaseRunIdStatus: "missing",
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
  if (evidence.mode !== "live" || evidence.status !== "reachable") {
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

function evaluateExternalStorageServiceReadinessEvidence({
  evidence,
  releaseRunId,
  storageServiceFingerprint,
}) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      valueRedacted: true,
      releaseRunIdStatus: "missing",
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
    valueRedacted: true,
    releaseRunIdStatus,
  };
  if (target !== "external-storage-service-readiness") {
    return { ...summary, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "ready"
  ) {
    return { ...summary, status: "not-ready" };
  }
  if (releaseRunId && releaseRunIdStatus !== "matched") {
    return { ...summary, status: "release-run-id-mismatch" };
  }

  const readinessFingerprint = readStorageServiceFingerprint(evidence);
  if (!readinessFingerprint) {
    return { ...summary, status: "fingerprint-missing" };
  }
  if (
    storageServiceFingerprint.status !== "present" ||
    typeof storageServiceFingerprint.value !== "string"
  ) {
    return { ...summary, status: "smoke-fingerprint-missing" };
  }
  if (readinessFingerprint !== storageServiceFingerprint.value) {
    return { ...summary, status: "mismatched" };
  }
  const productionDatabaseAdapterStatus =
    readExternalStorageReadinessDatabaseAdapterStatus(evidence);
  const productionDatabaseAdapters =
    readExternalStorageReadinessDatabaseAdapters(evidence);
  if (productionDatabaseAdapterStatus !== "ready") {
    return {
      ...summary,
      status: "database-adapter-not-proven",
      productionDatabaseAdapterStatus,
      productionDatabaseAdapters,
    };
  }
  return {
    ...summary,
    status: "matched",
    productionDatabaseAdapterStatus: "ready",
    productionDatabaseAdapters,
  };
}

function readStorageServiceFingerprint(evidence) {
  if (!isRecord(evidence) || !isRecord(evidence.storageServiceFingerprint)) {
    return undefined;
  }
  const fingerprint = evidence.storageServiceFingerprint;
  if (
    fingerprint.status === "present" &&
    typeof fingerprint.value === "string" &&
    /^sha256:[a-f0-9]{16}$/.test(fingerprint.value) &&
    fingerprint.source === "origin" &&
    fingerprint.valueRedacted === true
  ) {
    return fingerprint.value;
  }
  return undefined;
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
  if (evidenceStatus.status === "missing") {
    return ["vercel-production-deployment-evidence-missing"];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["vercel-production-deployment-fingerprint-mismatch"];
  }
  return [`vercel-production-deployment-evidence-${evidenceStatus.status}`];
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

function readExternalStorageServiceReadinessBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "missing") {
    return ["external-storage-service-readiness-evidence-missing"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["external-storage-service-readiness-release-run-mismatch"];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["external-storage-service-readiness-fingerprint-mismatch"];
  }
  if (evidenceStatus.status === "database-adapter-not-proven") {
    return ["external-storage-service-readiness-database-adapter-not-proven"];
  }
  return [`external-storage-service-readiness-evidence-${evidenceStatus.status}`];
}

function readExternalStorageReadinessDatabaseAdapterStatus(evidence) {
  const health = isRecord(evidence.health) ? evidence.health : undefined;
  const statuses = [
    readStorageSchemaDatabaseAdapterStatus(health?.teachingOperationsStorageSchema),
    readStorageSchemaDatabaseAdapterStatus(
      health?.teachingCourseManagementStorageSchema,
    ),
    readStorageSchemaDatabaseAdapterStatus(health?.teachingCourseAssetsStorageSchema),
  ];
  if (statuses.every((status) => status === "ready")) {
    return "ready";
  }
  if (statuses.includes("missing")) {
    return "missing";
  }
  return "blocked";
}

function readExternalStorageReadinessDatabaseAdapters(evidence) {
  const health = isRecord(evidence.health) ? evidence.health : undefined;
  return {
    teachingOperations: readStorageSchemaDatabaseAdapterSummary(
      health?.teachingOperationsStorageSchema,
    ),
    teachingCourseManagement: readStorageSchemaDatabaseAdapterSummary(
      health?.teachingCourseManagementStorageSchema,
    ),
    teachingCourseAssets: readStorageSchemaDatabaseAdapterSummary(
      health?.teachingCourseAssetsStorageSchema,
    ),
  };
}

function readStorageSchemaDatabaseAdapterStatus(schema) {
  if (!isRecord(schema) || !isRecord(schema.productionDatabaseAdapter)) {
    return "missing";
  }
  return isReadyProductionDatabaseAdapter(schema.productionDatabaseAdapter)
    ? "ready"
    : "blocked";
}

function readStorageSchemaDatabaseAdapterSummary(schema) {
  if (!isRecord(schema) || !isRecord(schema.productionDatabaseAdapter)) {
    return { status: "missing" };
  }
  const adapter = schema.productionDatabaseAdapter;
  return {
    status: isReadyProductionDatabaseAdapter(adapter)
      ? "ready"
      : typeof adapter.status === "string"
        ? adapter.status
        : "blocked",
    providerClass:
      typeof adapter.providerClass === "string" ? adapter.providerClass : "missing",
    migrationStatus:
      typeof adapter.migrationStatus === "string" ? adapter.migrationStatus : "missing",
    backupPolicy:
      typeof adapter.backupPolicy === "string" ? adapter.backupPolicy : "missing",
    concurrencyControl:
      typeof adapter.concurrencyControl === "string"
        ? adapter.concurrencyControl
        : "missing",
    valueRedacted: adapter.valueRedacted === true,
  };
}

function isReadyProductionDatabaseAdapter(value) {
  return (
    isRecord(value) &&
    value.status === "ready" &&
    value.providerClass === "managed-database" &&
    value.migrationStatus === "up-to-date" &&
    value.backupPolicy === "point-in-time-restore" &&
    value.concurrencyControl === "transactional" &&
    value.valueRedacted === true
  );
}

function readProductionDeploymentOriginBlockedReasons({ environment, deploymentOrigin }) {
  if (
    environment !== "production" ||
    (deploymentOrigin.status === "present" && deploymentOrigin.originClass === "remote-https")
  ) {
    return [];
  }
  return ["deployment-origin-not-remote-https"];
}

function describeDeploymentOrigin(baseUrl) {
  const originClass = classifyDeploymentOrigin(baseUrl);
  return {
    status: originClass === "missing" ? "missing" : "present",
    originClass,
    valueRedacted: true,
  };
}

function classifyDeploymentOrigin(baseUrl) {
  if (!hasValue(baseUrl)) {
    return "missing";
  }
  try {
    const origin = new URL(baseUrl);
    const hostClass = classifyOriginHost(origin.hostname);
    if (hostClass !== "remote") {
      return hostClass;
    }
    return origin.protocol === "https:" ? "remote-https" : "insecure-http";
  } catch {
    return "invalid";
  }
}

function classifyOriginHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") {
    return "local-loopback";
  }
  const octets = host.split(".").map((part) => Number(part));
  if (
    octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    if (octets[0] === 127) {
      return "local-loopback";
    }
    if (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
    ) {
      return "private-network";
    }
  }
  if (host.endsWith(".local")) {
    return "local-loopback";
  }
  return "remote";
}

function createDeploymentFingerprint(baseUrl) {
  if (!hasValue(baseUrl)) {
    return {
      status: "missing",
      valueRedacted: true,
    };
  }
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(baseUrl).digest("hex").slice(0, 16)}`,
  };
}

function createStorageServiceFingerprint(baseUrl) {
  if (!hasValue(baseUrl)) {
    return {
      status: "missing",
      valueRedacted: true,
    };
  }
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(baseUrl).digest("hex").slice(0, 16)}`,
    source: "origin",
    valueRedacted: true,
  };
}

function createSmokeIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeDeniedIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-denied-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeUnauthenticatedDeniedIdempotencyKey({
  courseId,
  environment,
  releaseRunId,
}) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-unauthenticated-denied-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeMissingCourseIdIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-missing-course-id-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeStudentDeniedIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-student-denied-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeUnsafeAppSessionDeniedIdempotencyKey({
  courseId,
  environment,
  releaseRunId,
}) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-unsafe-app-session-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createUnsafeStudentAppSessionCookie({ environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  const claims = Buffer.from(
    JSON.stringify({
      account: "route-smoke-student",
      role: "student",
      displayName: "Route Smoke Student",
      department: "Student Account",
      sessionId: `/Users/redacted/secret-token-${sanitizeSafeIdPart(runPart)}`,
      authenticatedAt: "2026-06-22T10:45:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }),
    "utf8",
  ).toString("base64url");
  const signature = `invalid-${createHash("sha256").update(claims).digest("hex").slice(0, 32)}`;
  return `uais_app_session=${claims}; uais_app_session_signature=${signature}`;
}

function createSmokeStudentPreviewIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-student-preview-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeInviteIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-invite-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeInviteDraftIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-invite-draft-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeStudentRosterIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-student-roster-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeStudentGroupSuggestionIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-student-group-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeKnowledgeIndexIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-knowledge-index-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeResourceReviewItemIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-resource-review-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeCourseContentIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-course-content-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeCourseUnitDraftIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-course-unit-draft-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeDashboardStateIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-dashboard-state-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeDashboardSnapshotIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-dashboard-snapshot-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeQuizAssessmentIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-quiz-assessment-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeQuizItemReviewIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-quiz-item-review-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeAdminSettingsIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-admin-settings-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeAgentSettingsIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-agent-settings-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeAgentPermissionPreflightIdempotencyKey({
  courseId,
  environment,
  releaseRunId,
}) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-agent-permission-preflight-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeCollaborationInviteIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-admin-invite-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeCourseExportManifestIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-export-manifest-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeCourseExportRedactionIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-export-redaction-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeGradebookIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-gradebook-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createSmokeGradingFeedbackDraftIdempotencyKey({ courseId, environment, releaseRunId }) {
  const runPart = hasValue(releaseRunId)
    ? createHash("sha256").update(releaseRunId).digest("hex").slice(0, 12)
    : environment;
  return `route-smoke-grading-feedback-${sanitizeSafeIdPart(courseId)}-${sanitizeSafeIdPart(runPart)}`.slice(
    0,
    120,
  );
}

function createGradebookUpdateId(courseId) {
  return `gradebook-update-${sanitizeSafeIdPart(courseId)}`.slice(0, 120);
}

function sanitizeSafeIdPart(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .slice(0, 64);
  return normalized || "unknown";
}

function createSafety() {
  return {
    valuesRedacted: true,
    cookieValuesOmitted: true,
    responseBodiesOmitted: true,
    liveRequiresApproval: true,
    remoteMutationRequiresApproval: true,
  };
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function setExpectedSmokeTeacherId(value) {
  expectedSmokeTeacherId = hasValue(value) ? value.trim() : "teacher-kang";
}

function getExpectedSmokeTeacherId() {
  return expectedSmokeTeacherId;
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isStrongExternalStorageToken(value) {
  return hasValue(value) && value.trim().length >= 32;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function hasTeachingOperationsSchemaContract(value) {
  return (
    isRecord(value) &&
    value.schemaVersion === "uais-teaching-operations-v1" &&
    value.backupSchemaVersion === "uais-teaching-operations-backup-v1" &&
    Array.isArray(value.supportedSchemaVersions) &&
    value.supportedSchemaVersions.length === 1 &&
    value.supportedSchemaVersions[0] === "uais-teaching-operations-v1" &&
    value.migrationPolicy === "explicit-versioned-schema-normalization" &&
    value.unsupportedSchemaVersionPolicy === "fail-closed" &&
    value.responsibleSession === "S12"
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
