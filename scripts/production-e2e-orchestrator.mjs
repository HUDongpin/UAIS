#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_REPORT_DATE = new Date().toISOString().slice(0, 10);
const DEFAULT_OUTPUT_DIR = "coordination/reports";

const releaseGateSource = readFileSync(
  new URL("./production-e2e-release-gate.mjs", import.meta.url),
  "utf8",
);

const readReleaseGateRequiredResults = (name) => {
  const match = releaseGateSource.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));

  if (!match) {
    throw new Error(`Missing production release gate result list: ${name}`);
  }

  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, value]) => value);
};

const releaseGateRequiredResults = {
  teacherWorkflowBrowser: readReleaseGateRequiredResults("requiredTeacherWorkflowBrowserResults"),
  teachingOperationsRouteSmoke: readReleaseGateRequiredResults(
    "requiredTeachingOperationsRouteSmokeResults",
  ),
  teachingOperationDetailBrowser: readReleaseGateRequiredResults(
    "requiredTeachingOperationDetailBrowserResults",
  ),
  teachingCourseManagementRouteSmoke: readReleaseGateRequiredResults(
    "requiredTeachingCourseManagementRouteSmokeResults",
  ),
};

const stepContracts = [
  {
    id: "s05-teacher-workflow-ui-smoke",
    owner: "S05",
    evidenceKey: "teacherWorkflowUi",
    mutatesRemote: false,
    requiresOwnerApproval: false,
    command:
      "node -- scripts/teacher-workflow-ui-smoke.mjs > <evidence>",
    proves: [
      "voice-sample-upload-marker",
      "uploaded-audio-payload-marker",
      "voice-sample-duration-gate-marker",
      "voice-sample-select-marker",
      "selected-sample-identity-marker",
      "preflight-marker",
      "voice-ref-display-marker",
      "ppt-narration-generate-marker",
      "per-slide-wav-downloads-marker",
      "workflow-step-gating-marker",
      "signed-session-bootstrap-marker",
      "signed-session-readiness-marker",
      "auth-fail-closed-marker",
      "server-workflow-status-marker",
      "feature-evidence-output-redacted",
    ],
  },
  {
    id: "s22-vercel-project-readiness",
    owner: "S22",
    evidenceKey: "vercelProjectReadiness",
    mutatesRemote: false,
    requiresOwnerApproval: false,
    command:
      "node -- scripts/vercel-project-readiness.mjs --project-name <approved-project-name> --scope <approved-scope> > <evidence>",
    proves: [
      "vercel-cli-present",
      "authenticated-vercel-account-redacted",
      "approved-or-detected-vercel-scope",
      "approved-project-candidate",
      "project-link-marker",
      "vercelignore-upload-hygiene",
    ],
  },
  {
    id: "s19-vercel-env-sync-apply-evidence",
    owner: "S19",
    evidenceKey: "vercelEnvSync",
    mutatesRemote: true,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/vercel-env-sync.mjs --apply --approved --project <approved-project> --env-file <env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <evidence>",
    proves: [
      "server-only-env-applied-to-production-and-preview",
      "teacher-auth-provider-selector",
      "app-auth-trusted-account-provider-bound",
      "production-secret-strength",
      "remote-https-external-storage-endpoint",
      "redacted-external-storage-service-fingerprint",
      "redacted-env-apply-preflight",
      "redacted-env-apply-summary",
      "release-run-id-bound",
    ],
  },
  {
    id: "s19-vercel-env-inventory-observation",
    owner: "S19",
    evidenceKey: "vercelEnvInventory",
    mutatesRemote: false,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/vercel-env-inventory.mjs --method rest --project-dir <vercel-project-dir> --release-run-id <release-run-id> > <evidence>",
    proves: [
      "redacted-vercel-env-name-inventory",
      "required-production-and-preview-env-observed",
      "optional-external-storage-adapter-env-observed",
      "release-run-id-bound",
    ],
  },
  {
    id: "s22-app-auth-provider-readiness",
    owner: "S22",
    evidenceKey: "appAuthProviderReadiness",
    mutatesRemote: false,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/app-auth-provider-readiness.mjs --live --approved --environment production --env-file <env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> > <evidence>",
    proves: [
      "trusted-app-account-provider-selector",
      "app-session-cookie-pair-contract",
      "vercel-env-app-auth-provider-selector-bound",
      "app-auth-provider-token-strength-redacted",
      "release-run-id-bound",
    ],
  },
  {
    id: "s12-trusted-teacher-auth-route-chain-contract",
    owner: "S12",
    evidenceKey: "trustedTeacherAuthRouteChain",
    mutatesRemote: false,
    requiresOwnerApproval: false,
    command:
      "node -- scripts/trusted-teacher-auth-route-chain-contract.mjs > <evidence>",
    proves: [
      "trusted-cookie-issuer-route-chain",
      "issued-cookie-pair-to-scoped-ai-session",
      "ppt-narration-submit-scoped-session",
      "cookie-and-session-values-omitted",
    ],
  },
  {
    id: "s22-external-storage-production-launch-contract",
    owner: "S22",
    evidenceKey: "externalStorageProductionLauncher",
    mutatesRemote: false,
    requiresOwnerApproval: false,
    command:
      "node -- scripts/external-storage-service-production-launcher.mjs --dry-run > <evidence>",
    proves: [
      "env-only-secret-launch",
      "production-service-mode-forced",
      "persistent-data-dir-required",
      "container-runtime-artifact",
      "redacted-launch-contract",
    ],
  },
  {
    id: "s22-external-storage-container-build-readiness",
    owner: "S22",
    evidenceKey: "externalStorageContainerBuildReadiness",
    mutatesRemote: false,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/external-storage-container-build-readiness.mjs --build --approved --image-tag <non-secret-image-tag> --release-run-id <release-run-id> > <evidence>",
    proves: [
      "dockerfile-contract",
      "docker-context-secret-exclusion",
      "docker-daemon-availability-status",
      "approved-container-build-invoked",
      "docker-output-omitted",
      "container-image-tag-redacted",
      "release-run-id-bound",
    ],
  },
  {
    id: "s22-external-storage-persistence",
    owner: "S22",
    evidenceKey: "externalStoragePersistence",
    mutatesRemote: true,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/external-storage-persistence-smoke.mjs --live --approved --environment production --phase read --env-file <env-file> --teacher-id <redacted-smoke-teacher-id> --proof-id <redacted-persistence-proof-id> --release-run-id <release-run-id> > <evidence>",
    proves: [
      "remote-https-storage-persistence-read-after-restart",
      "redacted-storage-service-fingerprint",
      "redacted-persistence-proof-fingerprint",
      "persisted-ownership-read",
      "persisted-lifecycle-audit-read",
      "release-run-id-bound",
    ],
  },
  {
    id: "s22-external-storage-service-readiness",
    owner: "S22",
    evidenceKey: "externalStorageServiceReadiness",
    mutatesRemote: false,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/external-storage-service-readiness.mjs --live --approved --environment production --env-file <env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> --external-storage-production-launch-contract <external-storage-production-launch-contract-evidence> --external-storage-persistence <external-storage-persistence-evidence> > <evidence>",
    proves: [
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
    ],
  },
  {
    id: "s22-vercel-production-deployment",
    owner: "S22",
    evidenceKey: "vercelProductionDeployment",
    mutatesRemote: true,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/vercel-production-deployment-evidence.mjs --live --approved --deploy --environment production --env-file <env-file> --scope <approved-scope> --vercel-project-readiness <vercel-project-readiness-evidence> --vercel-env-sync <vercel-env-sync-evidence> --release-run-id <release-run-id> > <evidence>",
    proves: [
      "production-deployment-created-or-inspected",
      "ready-project-readiness-guard",
      "applied-env-sync-guard",
      "env-sync-storage-fingerprint-guard",
      "env-sync-apply-summary-guard",
      "env-sync-apply-preflight-guard",
      "deployment-url-redacted",
      "deployment-fingerprint-source-for-smokes",
      "release-run-id-bound",
    ],
  },
  {
    id: "s22-deployment-domain-reachability",
    owner: "S22",
    evidenceKey: "deploymentDomainReachability",
    mutatesRemote: false,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/deployment-reachability-diagnostics.mjs --live --approved --environment production --base-url <deployment-url> --release-run-id <release-run-id> --domain-reachability-evidence > <evidence>",
    proves: [
      "custom-production-domain-reachable",
      "redacted-domain-origin",
      "redacted-domain-deployment-fingerprint",
      "route-smoke-domain-binding-evidence",
      "release-run-id-bound",
    ],
  },
  {
    id: "s22-teacher-auth-issuer-route-smoke",
    owner: "S22",
    evidenceKey: "teacherAuthIssuerRouteSmoke",
    mutatesRemote: false,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/ai-route-smoke.mjs --live --approved --environment production --teacher-auth-issuer-only --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> > <evidence>",
    proves: [
      "deployed-teacher-auth-issuer-route",
      "issuer-cookie-hardening",
      "teacher-auth-issuer-response-shape",
      "matching-deployment-fingerprint",
      "release-run-id-bound",
      "vercel-production-deployment-fingerprint-bound",
      "same-deployment-domain-reachability-bound",
    ],
  },
  {
    id: "s22-teacher-auth-provider-readiness",
    owner: "S22",
    evidenceKey: "teacherAuthProviderReadiness",
    mutatesRemote: false,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/teacher-auth-provider-readiness.mjs --live --approved --environment production --env-file <env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> --trusted-teacher-auth-route-chain <trusted-teacher-auth-route-chain-evidence> --route-smoke <teacher-auth-issuer-route-smoke-evidence> > <evidence>",
    proves: [
      "local-trusted-route-chain-contract-present",
      "deployed-teacher-auth-issuer-route-smoke",
      "teacher-auth-provider-selector",
      "vercel-env-auth-provider-selector-bound",
      "teacher-auth-session-cookie-contract",
      "production-session-cookie-pair-contract",
      "trusted-issuer-or-oidc-provider-readiness",
      "secret-strength-redacted",
      "release-run-id-bound",
    ],
  },
  {
    id: "s22-deployed-teacher-workflow-page-smoke",
    owner: "S22",
    evidenceKey: "deployedTeacherWorkflowUi",
    mutatesRemote: false,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/teacher-workflow-deployment-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <evidence>",
    proves: [
      "remote-https-deployment-origin",
      "rendered-teacher-workflow-anchors",
      "voice-sample-select-marker",
      "uploaded-audio-payload-marker",
      "selected-sample-identity-marker",
      "signed-session-bootstrap-marker",
      "signed-session-readiness-marker",
      "protected-workflow-session-action-manifest",
      "server-workflow-status-marker",
      "deployment-fingerprint",
      "rendered-page-fingerprint",
      "release-run-id-bound",
      "vercel-production-deployment-fingerprint-bound",
    ],
  },
  {
    id: "s22-deployed-teacher-workflow-browser-smoke",
    owner: "S22",
    evidenceKey: "teacherWorkflowBrowserUi",
    mutatesRemote: false,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --api-mode live-workflow-status > <evidence>",
    proves: [
      "real-browser-hydration",
      "real-protected-workflow-status-read",
      "fixture-blocked-workflow-mutations",
      "ppt-narration-slide-payload-contract",
      "voice-sample-file-selection",
      "signed-session-bootstrap-request",
      "protected-workflow-click-sequence",
      "per-slide-wav-download-links",
      "protected-wav-download-href-contract",
      "no-remote-provider-or-storage-mutation",
      "matching-deployment-fingerprint",
      "release-run-id-bound",
      "vercel-production-deployment-fingerprint-bound",
    ],
    releaseGateRequiredResults: releaseGateRequiredResults.teacherWorkflowBrowser,
  },
  {
    id: "s22-deployed-teacher-workflow-live-generation-smoke",
    owner: "S22",
    evidenceKey: "teacherWorkflowLiveGeneration",
    mutatesRemote: true,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/teacher-workflow-live-generation-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <evidence>",
    proves: [
      "signed-session-bootstrap",
      "live-provider-approved-workflow-mutations",
      "voice-sample-submit-live-provider",
      "voice-clone-preflight-live-approved",
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
    ],
  },
  {
    id: "s22-deployed-learning-ppt-playback-smoke",
    owner: "S22",
    evidenceKey: "learningPptPlayback",
    mutatesRemote: false,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/learning-ppt-playback-deployment-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <evidence>",
    proves: [
      "kang-xia-learning-playback-19-slides",
      "student-safe-playback-manifest",
      "first-slide-public-wav-response",
      "first-slide-wav-minimum-content-length",
      "matching-deployment-fingerprint",
      "release-run-id-bound",
      "vercel-production-deployment-fingerprint-bound",
    ],
  },
  {
    id: "s22-protected-deployment-route-smoke",
    owner: "S22",
    evidenceKey: "routeSmoke",
    mutatesRemote: false,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/ai-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> > <evidence>",
    proves: [
      "trusted-teacher-auth-session",
      "issuer-cookie-hardening",
      "teacher-ai-session-response-shape",
      "teacher-ownership-response-shape",
      "teacher-ppt-workflow-response-shape",
      "teacher-ppt-workflow-download-contract",
      "signed-ai-contract-direct-call-denied",
      "signed-ai-download-direct-call-denied",
      "legacy-scoped-ai-direct-call-denied",
      "teacher-cookie-helper-direct-call-denied",
      "matching-deployment-fingerprint",
      "release-run-id-bound",
      "vercel-production-deployment-fingerprint-bound",
      "same-deployment-domain-reachability-bound",
      "teacher-auth-provider-readiness-selector-bound",
    ],
  },
  {
    id: "s22-deployed-teaching-operations-route-smoke",
    owner: "S22",
    evidenceKey: "teachingOperationsRouteSmoke",
    mutatesRemote: true,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/teaching-operations-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <evidence>",
    proves: [
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
      "unauthenticated-response-trace-header-returned",
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
      "authorized-response-trace-header-returned",
      "audit-readback-returned",
      "audit-auth-session-readback-returned",
      "audit-readback-response-trace-header-returned",
      "domain-projection-readback-returned",
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
      "rollback-record-persisted",
      "rollback-response-trace-header-returned",
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
      "invite-publish-class-join-entry-returned",
      "invite-code-publish-audit-source-returned",
      "student-invite-join-returned",
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
    ],
    releaseGateRequiredResults: releaseGateRequiredResults.teachingOperationsRouteSmoke,
  },
  {
    id: "s22-deployed-teaching-operation-detail-browser-smoke",
    owner: "S22",
    evidenceKey: "teachingOperationDetailBrowserSmoke",
    mutatesRemote: true,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --api-mode live-teaching-operations > <evidence>",
    proves: [
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
      "main-inline-audit-pending-before-success",
      "main-inline-course-settings-card-audit-gated",
      "main-inline-audit-readback-verified",
      "main-inline-domain-projection-verified",
      "main-inline-alert-pending-before-success",
      "main-inline-knowledge-index-sync-submitted",
      "main-inline-student-roster-sync-submitted",
      "main-inline-dashboard-refresh-submitted",
      "main-inline-student-preview-submitted",
      "main-inline-agent-permission-preflight-submitted",
      "main-linked-knowledge-source-registration-submitted",
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
    ],
    releaseGateRequiredResults: releaseGateRequiredResults.teachingOperationDetailBrowser,
  },
  {
    id: "s22-deployed-teaching-course-management-route-smoke",
    owner: "S22",
    evidenceKey: "teachingCourseManagementRouteSmoke",
    mutatesRemote: true,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/teaching-course-management-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <evidence>",
    proves: [
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
      "signed-teacher-cookie-required",
      "course-cover-asset-generated",
      "course-cover-asset-external-storage-returned",
      "course-cover-asset-readback-revision-returned",
      "course-cover-asset-readback-managed-database-adapter-returned",
      "course-cover-audit-auth-session-returned",
      "course-cover-asset-audit-external-readback-returned",
      "signed-course-cover-trace-header-returned",
      "teacher-owned-course-created",
      "duplicate-course-create-denied",
      "course-create-external-snapshot-policy-returned",
      "course-create-audit-source-readback-returned",
      "course-create-auth-session-readback-returned",
      "created-course-bound-generated-cover-asset",
      "created-course-used-cover-draft-scope",
      "existing-course-cover-binding-readback-returned",
      "existing-course-cover-listed-readback-returned",
      "existing-course-cover-asset-audit-external-readback-returned",
      "existing-course-cover-binding-audit-source-returned",
      "external-ownership-merge-returned",
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
      "unauthenticated-membership-approval-denied",
      "signed-student-membership-approval-denied",
      "signed-other-teacher-membership-approval-denied",
      "signed-other-teacher-membership-approval-actor-resource-returned",
      "teacher-membership-approval-persisted",
      "duplicate-membership-approval-idempotent-returned",
      "teacher-membership-approval-audit-source-returned",
      "teacher-membership-approval-auth-session-returned",
      "teacher-membership-approval-auth-session-readback-returned",
      "approved-membership-readable-for-student",
      "unauthenticated-course-list-trace-header-returned",
      "unauthenticated-course-cover-trace-header-returned",
      "unauthenticated-course-create-trace-header-returned",
      "signed-student-course-create-trace-header-returned",
      "signed-student-course-cover-trace-header-returned",
      "signed-other-teacher-course-cover-trace-header-returned",
      "unauthenticated-class-create-trace-header-returned",
      "signed-student-class-create-trace-header-returned",
      "signed-other-teacher-class-create-trace-header-returned",
      "signed-course-create-trace-header-returned",
      "signed-class-create-trace-header-returned",
      "signed-course-list-trace-header-returned",
      "signed-other-teacher-course-list-trace-header-returned",
      "signed-student-prejoin-course-list-trace-header-returned",
      "unauthenticated-invite-join-trace-header-returned",
      "signed-student-invite-join-trace-header-returned",
      "unauthenticated-membership-approval-trace-header-returned",
      "signed-student-membership-approval-trace-header-returned",
      "signed-other-teacher-membership-approval-trace-header-returned",
      "signed-teacher-membership-approval-trace-header-returned",
      "signed-student-course-list-trace-header-returned",
      "response-values-redacted",
      "release-run-id-bound",
      "same-teacher-auth-provider-readiness-bound",
      "same-app-auth-provider-readiness-bound",
      "same-vercel-production-deployment-bound",
      "same-deployment-domain-reachability-bound",
      "same-external-storage-service-readiness-bound",
    ],
    releaseGateRequiredResults: releaseGateRequiredResults.teachingCourseManagementRouteSmoke,
  },
  {
    id: "s22-production-external-storage-smoke",
    owner: "S22",
    evidenceKey: "externalStorageSmoke",
    mutatesRemote: true,
    requiresOwnerApproval: true,
    command:
      "node -- scripts/external-storage-smoke.mjs --live --approved --environment production --teacher-id <redacted-smoke-teacher-id> --env-file <env-file> --release-run-id <release-run-id> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <evidence>",
    proves: [
      "remote-https-storage-endpoint",
      "durable-backing-store-write-read-delete",
      "managed-database-adapter-proof-shape",
      "teacher-ownership-merge-read-after-write",
      "qwen-lifecycle-audit-append-read-after-write",
      "course-management-backup-created",
      "course-management-restore-drill-verified",
      "course-assets-backup-created",
      "course-assets-restore-drill-verified",
      "teaching-operations-backup-created",
      "teaching-operations-restore-drill-verified",
      "ordinary-teaching-concurrent-append-readback",
      "ordinary-teaching-concurrent-append-sequence-distinct",
      "ordinary-teaching-concurrent-append-domain-projection-readback",
      "same-run-smoke-marker-readback",
      "redacted-storage-service-fingerprint",
      "release-run-id-bound",
      "external-storage-service-readiness-fingerprint-bound",
    ],
  },
  {
    id: "s24-manual-ppt-playback-acceptance",
    owner: "S24",
    evidenceKey: "pptAcceptance",
    mutatesRemote: false,
    requiresOwnerApproval: false,
    command:
      "node -- scripts/ppt-manual-playback-acceptance.mjs --package-json <kangxia-package-json> --preflight-report <desktop-preflight-report> --manual-record <manual-record> --vercel-production-deployment <vercel-production-deployment-evidence> > <evidence>",
    proves: [
      "package-identity-matched",
      "manual-powerpoint-playback-accepted",
      "manual-wps-playback-accepted",
      "non-future-tested-at",
      "all-19-slide-audio-checks",
      "release-run-id-bound",
      "deployment-fingerprint-bound",
      "deployment-observation-bound",
      "vercel-production-deployment-evidence-bound",
    ],
  },
  {
    id: "s22-enterprise-live-evidence-audit",
    owner: "S22",
    evidenceKey: "enterpriseLiveEvidenceAudit",
    mutatesRemote: false,
    requiresOwnerApproval: false,
    command:
      "node -- scripts/enterprise-live-evidence-audit.mjs --reports-dir <reports-dir> --date <report-date> --output <evidence>",
    proves: [
      "production-live-filenames-body-field-audited",
      "accepted-live-evidence-counted",
      "filename-only-or-blocked-evidence-counted",
      "shared-release-run-id-across-production-live-evidence",
      "all-orchestrated-production-live-targets-present",
      "required-production-live-safety-redaction-flags",
      "filename-only-production-live-evidence-rejected",
      "file-names-only-output",
      "response-bodies-omitted",
    ],
  },
  {
    id: "s22-production-e2e-release-gate",
    owner: "S22",
    evidenceKey: "releaseGate",
    mutatesRemote: false,
    requiresOwnerApproval: false,
    command:
      "node -- scripts/production-e2e-release-gate.mjs --teacher-workflow-ui <teacher-workflow-ui-evidence> --deployed-teacher-workflow-ui <deployed-teacher-workflow-ui-evidence> --teacher-workflow-browser-ui <teacher-workflow-browser-ui-evidence> --teacher-workflow-live-generation <teacher-workflow-live-generation-evidence> --learning-ppt-playback <learning-ppt-playback-evidence> --vercel-project-readiness <vercel-project-readiness-evidence> --vercel-env-sync <vercel-env-sync-evidence> --vercel-env-inventory <vercel-env-inventory-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --trusted-teacher-auth-route-chain <trusted-teacher-auth-route-chain-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --external-storage-production-launch-contract <external-storage-production-launch-contract-evidence> --external-storage-container-build-readiness <external-storage-container-build-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --vercel-production-deployment <vercel-production-deployment-evidence> --route-smoke <route-smoke-evidence> --teaching-operations-route-smoke <teaching-operations-route-smoke-evidence> --teaching-operation-detail-browser-smoke <teaching-operation-detail-browser-smoke-evidence> --teaching-course-management-route-smoke <teaching-course-management-route-smoke-evidence> --external-storage-smoke <external-storage-smoke-evidence> --ppt-acceptance <ppt-acceptance-evidence> --enterprise-live-evidence-audit <enterprise-live-evidence-audit-evidence> --local-production-e2e-smoke <local-production-e2e-smoke-evidence> > <evidence>",
    proves: [
      "all-production-e2e-requirements-satisfied",
      "no-stale-or-local-only-evidence-accepted",
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
      "vercel-env-storage-service-fingerprint-match",
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
    ],
  },
];

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "live" && !options.approved) {
    throw new Error("Production E2E orchestration requires explicit owner approval.");
  }
  if (options.mode === "live" && !options.releaseRunId) {
    throw new Error("Production E2E orchestration requires --release-run-id in live mode.");
  }

  process.stdout.write(`${JSON.stringify(buildPlan(options), null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Production E2E orchestration failed."}\n`,
  );
  process.exitCode = 1;
}

function buildPlan(options) {
  const evidenceFiles = createEvidenceFiles(options.reportDate);
  return {
    target: "production-e2e-release-orchestrator",
    mode: options.mode,
    environment: "production",
    network: options.mode === "live" ? "enabled" : "disabled",
    status: "planned",
    responsibleSession: "S22",
    reportDate: options.reportDate,
    ...(options.releaseRunId ? { releaseRunId: options.releaseRunId } : {}),
    outputDir: "redacted",
    evidenceFiles,
    evidenceReadiness: readEvidenceReadiness({
      outputDir: options.outputDir,
      evidenceFiles,
    }),
    ordinaryTeachingEvidenceBundle: buildOrdinaryTeachingEvidenceBundle(),
    steps: stepContracts.map((step, index) => ({
      order: index + 1,
      id: step.id,
      owner: step.owner,
      evidence: evidenceFiles[step.evidenceKey],
      command: step.command,
      mutatesRemote: step.mutatesRemote,
      requiresOwnerApproval: step.requiresOwnerApproval,
      proves: step.proves,
      ...(step.releaseGateRequiredResults
        ? { releaseGateRequiredResults: step.releaseGateRequiredResults }
        : {}),
    })),
    notRunReasons:
      options.mode === "dry-run"
        ? [
            "dry-run-only",
            "vercel-env-apply-separated-from-plan",
            "production-live-smokes-require-approved-deployment-url-and-secrets",
            "manual-ppt-playback-record-required",
          ]
        : [],
    safety: {
      valuesRedacted: true,
      envFilePathOmitted: true,
      deploymentUrlOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      liveRequiresApproval: true,
      liveRequiresReleaseRunId: true,
      vercelEnvApplyNotRunInDryRun: options.mode === "dry-run",
      remoteMutationCommandsSeparated: true,
      remoteMutationRequiresApproval: true,
    },
  };
}

function buildOrdinaryTeachingEvidenceBundle() {
  return {
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
    proofNeeded: [
      "live-teaching-operations-route-smoke",
      "live-teaching-operation-detail-browser-smoke",
      "live-teaching-course-management-route-smoke",
      "ordinary-teaching-operation-clicks-use-live-operations-api",
      "ordinary-teaching-route-smoke-provider-backed-side-effects",
      "ordinary-teaching-audit-readback-rollback-alerts",
      "course-cover-and-course-management-external-backend-readback",
      "same-release-run-id-bound-to-ordinary-teaching-evidence",
      "same-vercel-production-deployment-bound-to-ordinary-teaching-smokes",
      "same-deployment-domain-reachability-bound-to-ordinary-teaching-smokes",
      "teacher-auth-provider-readiness-bound-to-ordinary-teaching-smokes",
      "external-storage-readiness-bound-to-ordinary-teaching-smokes",
    ],
    releaseGateRequiredResults: {
      teachingOperationsRouteSmoke:
        releaseGateRequiredResults.teachingOperationsRouteSmoke,
      teachingOperationDetailBrowserSmoke:
        releaseGateRequiredResults.teachingOperationDetailBrowser,
      teachingCourseManagementRouteSmoke:
        releaseGateRequiredResults.teachingCourseManagementRouteSmoke,
    },
  };
}

function readEvidenceReadiness({ outputDir, evidenceFiles }) {
  return Object.entries(evidenceFiles).map(([key, file]) => {
    const evidencePath = join(outputDir, file);
    if (!existsSync(evidencePath)) {
      return {
        key,
        file,
        presence: "missing",
        releaseStatus: "missing",
      };
    }

    try {
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      return {
        key,
        file,
        presence: "present",
        target: typeof evidence.target === "string" ? evidence.target : "missing",
        evidenceStatus: readEvidenceStatus(evidence),
        releaseStatus: readReleaseStatus(evidence),
        blockedReasons: readBlockedReasons(evidence),
      };
    } catch {
      return {
        key,
        file,
        presence: "present",
        releaseStatus: "invalid-json",
      };
    }
  });
}

function readEvidenceStatus(evidence) {
  if (typeof evidence.mode === "string" && typeof evidence.status === "string") {
    return `${evidence.mode}-${evidence.status}`;
  }
  if (typeof evidence.mode === "string") {
    return evidence.mode;
  }
  if (typeof evidence.status === "string") {
    return evidence.status;
  }
  return "unknown";
}

function readReleaseStatus(evidence) {
  if (typeof evidence.status === "string") {
    return evidence.status;
  }
  if (typeof evidence.manualAcceptanceStatus === "string") {
    return evidence.manualAcceptanceStatus;
  }
  return "unknown";
}

function readBlockedReasons(evidence) {
  if (!Array.isArray(evidence.blockedReasons)) {
    return [];
  }
  return evidence.blockedReasons.filter((reason) => typeof reason === "string");
}

function createEvidenceFiles(reportDate) {
  return {
    teacherWorkflowUi: `${reportDate}-teacher-workflow-ui-smoke-current.json`,
    vercelProjectReadiness: `${reportDate}-vercel-project-readiness.json`,
    vercelEnvSync: `${reportDate}-vercel-env-sync-production-apply.json`,
    vercelEnvInventory: `${reportDate}-vercel-env-inventory-production-observed.json`,
    appAuthProviderReadiness: `${reportDate}-app-auth-provider-readiness-production-live.json`,
    trustedTeacherAuthRouteChain: `${reportDate}-trusted-teacher-auth-route-chain-contract.json`,
    teacherAuthIssuerRouteSmoke: `${reportDate}-teacher-auth-issuer-route-smoke-production-live.json`,
    teacherAuthProviderReadiness: `${reportDate}-teacher-auth-provider-readiness-production-live.json`,
    externalStorageProductionLauncher: `${reportDate}-external-storage-production-launch-contract.json`,
    externalStorageContainerBuildReadiness:
      `${reportDate}-external-storage-container-build-readiness-approved-build-release-run-bound.json`,
    externalStoragePersistence: `${reportDate}-external-storage-persistence-production-live.json`,
    externalStorageServiceReadiness: `${reportDate}-external-storage-service-readiness-production-live.json`,
    vercelProductionDeployment: `${reportDate}-vercel-production-deployment.json`,
    deploymentDomainReachability: `${reportDate}-deployment-domain-reachability-production-live.json`,
    deployedTeacherWorkflowUi: `${reportDate}-teacher-workflow-deployment-smoke-production-live.json`,
    teacherWorkflowBrowserUi: `${reportDate}-teacher-workflow-browser-smoke-production-live.json`,
    teacherWorkflowLiveGeneration:
      `${reportDate}-teacher-workflow-live-generation-smoke-production-live.json`,
    learningPptPlayback: `${reportDate}-learning-ppt-playback-deployment-smoke-production-live.json`,
    routeSmoke: `${reportDate}-route-smoke-production-live.json`,
    teachingOperationsRouteSmoke: `${reportDate}-teaching-operations-route-smoke-production-live.json`,
    teachingOperationDetailBrowserSmoke:
      `${reportDate}-teaching-operation-detail-browser-smoke-production-live.json`,
    teachingCourseManagementRouteSmoke:
      `${reportDate}-teaching-course-management-route-smoke-production-live.json`,
    externalStorageSmoke: `${reportDate}-external-storage-smoke-production-live.json`,
    pptAcceptance: `${reportDate}-ppt-manual-playback-acceptance-production-live.json`,
    enterpriseLiveEvidenceAudit: `${reportDate}-enterprise-live-evidence-audit.json`,
    localProductionE2eSmoke:
      `${reportDate}-local-production-e2e-smoke-enterprise-continuation.json`,
    releaseGate: `${reportDate}-production-e2e-release-gate.json`,
  };
}

function parseArgs(args) {
  const options = {
    mode: "dry-run",
    approved: false,
    reportDate: DEFAULT_REPORT_DATE,
    releaseRunId: undefined,
    envFile: ".env.local",
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.mode = "dry-run";
    } else if (arg === "--live") {
      options.mode = "live";
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--report-date") {
      options.reportDate = readArgValue(args, index, arg);
      validateReportDate(options.reportDate);
      index += 1;
    } else if (arg === "--release-run-id") {
      options.releaseRunId = normalizeReleaseRunId(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--env-file") {
      options.envFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/production-e2e-orchestrator.mjs [--dry-run|--live --approved --release-run-id ID] [--report-date YYYY-MM-DD] [--env-file PATH] [--output-dir PATH]",
          "",
          "Outputs a redacted production E2E release proof plan. Dry-run never performs network calls or remote mutations.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function validateReportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("--report-date must use YYYY-MM-DD.");
  }
}

function normalizeReleaseRunId(value) {
  const releaseRunId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)) {
    throw new Error("--release-run-id must be 3-128 URL-safe-ish characters.");
  }
  return releaseRunId;
}
