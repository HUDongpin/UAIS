# UAIS Production Owner Decision Queue

Status: `owner-decisions-required`
Release gate: `blocked`
Blocked requirements: 19
Owner decisions queued: 8
Accepted live evidence: 0
Missing enterprise live targets: 16

Do not treat this report as release-ready evidence while the release gate is blocked.

| Rank | Decision | Category | Status | Next owner question |
| --- | --- | --- | --- | --- |
| 1 | `app-auth-provider-production-selector` | owner-decision | owner-decision-needed | Confirm production app auth provider mode and approved server-only env source. |
| 2 | `teacher-auth-provider-production-selector` | owner-decision | owner-decision-needed | Confirm production teacher auth provider mode and approved server-only env source. |
| 3 | `external-storage-production-service` | owner-decision | owner-decision-needed | Confirm the approved remote HTTPS external-storage service and server-only env source. |
| 4 | `vercel-env-deploy-and-smoke-chain` | env-deploy-chain | waiting-for-upstream-owner-decisions | Approve S19 Vercel env sync/apply before production deploy and deployed smokes. |
| 5 | `ordinary-teaching-production-evidence` | live-evidence | waiting-for-live-evidence | Run ordinary-teaching live smokes only after auth, storage, and deployment evidence are ready. |
| 6 | `manual-ppt-playback-acceptance` | human-qa | human-qa-needed | Complete human PPT playback acceptance after production deployment and bind it to the release run. |
| 7 | `enterprise-live-evidence-audit` | evidence-audit | waiting-for-live-evidence | Run the enterprise live evidence audit only after all approved production live evidence files exist. |
| 8 | `production-release-run` | final-release-binding | waiting-for-upstream-evidence | Do not bind the production release-run ID until the release gate is ready. |

## Safe Next Actions

### 1. `app-auth-provider-production-selector`

Safe: `confirm-production-app-auth-provider-mode`, `bind-server-only-app-auth-env-through-s19-vercel-env-sync`, `run-approved-app-auth-provider-readiness-after-env-sync`, `run-ordinary-teaching-smokes-only-after-app-auth-readiness-is-live-ready`

Forbidden until approved: `inspect-or-print-app-auth-credential-values`, `run-live-app-auth-provider-network-call`, `run-production-smokes-dependent-on-app-auth`

### 2. `teacher-auth-provider-production-selector`

Safe: `confirm-production-teacher-auth-provider-mode`, `bind-server-only-teacher-auth-env-through-s19-vercel-env-sync`, `run-approved-teacher-auth-provider-readiness-after-env-sync`, `run-deployed-teacher-auth-issuer-route-smoke-after-production-deploy`, `run-production-smokes-only-after-teacher-auth-readiness-is-live-ready`

Forbidden until approved: `inspect-or-print-teacher-auth-credential-values`, `issue-live-teacher-auth-cookie`, `run-live-teacher-auth-provider-network-call`, `run-production-smokes-dependent-on-teacher-auth`

### 3. `external-storage-production-service`

Safe: `confirm-approved-remote-https-external-storage-service`, `bind-server-only-external-storage-env-through-s19-vercel-env-sync`, `run-approved-external-storage-persistence-read-after-restart-smoke`, `run-external-storage-service-readiness-after-env-sync-launch-and-persistence-evidence`, `run-external-storage-smoke-only-after-service-readiness-is-live-ready`

Forbidden until approved: `inspect-or-print-external-storage-secret-values`, `run-live-external-storage-service-readiness`, `run-live-external-storage-smoke`, `run-production-smokes-dependent-on-external-storage`

### 4. `vercel-env-deploy-and-smoke-chain`

Safe: `confirm-s19-vercel-env-apply-approval`, `run-redacted-vercel-env-sync-apply-with-approved-project-and-release-run-id`, `run-production-deployment-only-after-env-sync-evidence-is-applied`, `run-deployed-route-smokes-only-after-production-deployment-is-proven`, `run-ordinary-teaching-smokes-only-after-auth-storage-and-deployment-evidence-are-live-ready`

Forbidden until approved: `run-vercel-env-apply-without-owner-approval`, `run-vercel-production-deploy-without-owner-approval`, `run-live-provider-generation-smoke-before-browser-smoke-and-owner-approval`, `run-deployed-route-smokes-before-production-deployment-evidence`, `print-or-log-vercel-env-secret-values`

### 5. `ordinary-teaching-production-evidence`

Safe: `confirm-ordinary-teaching-live-smoke-prerequisites`, `wait-for-auth-storage-and-vercel-deployment-evidence`, `run-live-teaching-operations-route-smoke-after-auth-storage-deployment-readiness`, `run-live-operation-detail-and-course-management-smokes-with-issued-teacher-auth-cookie`, `collect-release-run-bound-ordinary-teaching-evidence-for-enterprise-audit`

Forbidden until approved: `run-live-ordinary-teaching-smokes-before-auth-storage-and-deployment-readiness`, `call-live-teaching-operations-api-without-issued-teacher-auth-cookie`, `run-provider-backed-side-effect-smokes-without-owner-approval`, `accept-local-production-smoke-as-production-live-evidence`, `print-or-log-teacher-auth-cookie-or-backend-secret-values`

### 6. `manual-ppt-playback-acceptance`

Safe: `package-manual-ppt-playback-evidence-for-human-review`, `verify-powerpoint-and-wps-playback-after-production-deployment`, `bind-manual-ppt-record-to-release-run-and-vercel-deployment`, `confirm-target-cloned-voice-label-and-per-slide-audio`, `submit-human-accepted-playback-record-for-release-gate`

Forbidden until approved: `mark-manual-ppt-accepted-before-human-playback`, `reuse-manual-ppt-record-from-different-release-run`, `reuse-manual-ppt-record-from-different-vercel-deployment`, `accept-missing-target-voice-label-or-slide-audio`, `log-private-ppt-package-paths-or-audio-urls`

### 7. `enterprise-live-evidence-audit`

Safe: `wait-for-approved-production-live-evidence-files`, `run-enterprise-live-evidence-audit-after-all-target-evidence-exists`, `reject-filename-only-or-blocked-evidence-records`, `verify-shared-release-run-id-across-production-live-evidence`, `attach-audit-summary-before-final-release-run`

Forbidden until approved: `mark-enterprise-audit-ready-with-missing-required-targets`, `accept-filename-only-production-live-evidence`, `accept-mismatched-release-run-id-production-evidence`, `publish-audit-with-local-private-paths-or-raw-urls`, `treat-local-or-dry-run-evidence-as-live-production-evidence`

### 8. `production-release-run`

Safe: `wait-for-final-release-gate-ready`, `bind-one-public-release-run-id-after-all-production-evidence-is-ready`, `verify-owner-checklist-has-no-waiting-or-blocked-decisions`, `publish-release-run-summary-with-redacted-evidence-only`

Forbidden until approved: `bind-release-run-id-while-release-gate-blocked`, `mix-production-evidence-from-multiple-release-run-ids`, `include-local-private-paths-or-secret-values-in-release-run-summary`, `treat-owner-decisions-required-as-release-ready`
