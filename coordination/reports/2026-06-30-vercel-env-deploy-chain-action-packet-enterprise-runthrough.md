# UAIS Vercel Env Deploy Chain Action Packet

Status: `waiting-for-upstream-owner-decisions`
Release gate: `blocked`
Queue rank: 4
Decision: `vercel-env-deploy-and-smoke-chain`
Sequencing: `project-readiness-before-env-apply-before-production-deploy-before-smokes`

Do not run env apply, production deploy, or live smokes until upstream owner decisions are live-ready and approval is explicit.

## Owner Question

Approve S19 Vercel env sync/apply before production deploy and deployed smokes.

## Upstream Decisions

- `app-auth-provider-production-selector`: `owner-decision-needed`
- `teacher-auth-provider-production-selector`: `owner-decision-needed`
- `external-storage-production-service`: `owner-decision-needed`

## Current Evidence Summary

- Chain status: `waiting-for-upstream-owner-decisions`
- Vercel project selection: `satisfied`
- Blocked requirement count: 9
- Env apply: `missing`
- Production deployment: `missing`
- Deployed smokes: `missing`
- Release-run binding: `missing`

## Required Evidence

- `vercel-project-readiness-current`
- `vercel-env-sync-apply-production-and-preview`
- `vercel-production-deployment-evidence`
- `deployment-domain-reachability`
- `deployment-route-smoke-live-passed`
- `teacher-workflow-deployment-smoke-live-passed`
- `teacher-workflow-browser-smoke-live-passed`
- `teacher-workflow-live-generation-smoke-live-passed`
- `learning-ppt-playback-deployment-smoke-live-passed`
- `teaching-operations-route-smoke-live-passed`
- `teaching-operation-detail-browser-smoke-live-passed`
- `teaching-course-management-route-smoke-live-passed`
- `same-release-run-id-bound-to-env-deploy-and-smokes`

## Command Templates

- Approved env apply: `node scripts/vercel-env-sync.mjs --apply --approved --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-evidence>`
- Approved production deploy: `node scripts/vercel-production-deployment-evidence.mjs --live --approved --deploy --environment production --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --vercel-env-sync <vercel-env-sync-evidence> --release-run-id <release-run-id> > <vercel-production-deployment-evidence>`
- Deployment reachability: `node scripts/deployment-reachability-diagnostics.mjs --live --approved --environment production --base-url <deployment-url> --domain-reachability-evidence --release-run-id <release-run-id> > <deployment-domain-reachability-evidence>`
- Protected route smoke: `node scripts/ai-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> > <deployment-route-smoke-evidence>`
- Teacher page smoke: `node scripts/teacher-workflow-deployment-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --cookie <approved-teacher-auth-cookie> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <teacher-workflow-deployment-smoke-evidence>`
- Teacher browser smoke: `node scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <teacher-workflow-browser-smoke-evidence>`
- Live generation smoke: `node scripts/teacher-workflow-live-generation-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <teacher-workflow-live-generation-smoke-evidence>`
- Learning playback smoke: `node scripts/learning-ppt-playback-deployment-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <learning-ppt-playback-deployment-smoke-evidence>`
- Ordinary teaching route smoke: `node scripts/teaching-operations-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --course-id <approved-smoke-course-id> --cookie <approved-teacher-auth-cookie> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teaching-operations-backend external --teaching-course-management-backend external > <teaching-operations-route-smoke-evidence>`
- Operation detail browser smoke: `node scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --api-mode live-teaching-operations > <teaching-operation-detail-browser-smoke-evidence>`
- Course management route smoke: `node scripts/teaching-course-management-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --other-teacher-id <approved-other-teacher-id> --student-id <approved-student-id> --cookie <approved-teacher-auth-cookie> --other-teacher-cookie <approved-other-teacher-auth-cookie> --student-cookie <approved-student-auth-cookie> --release-run-id <release-run-id> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teacher-ai-ownership-backend external --course-management-backend external --course-assets-backend external --teaching-operations-backend external > <teaching-course-management-route-smoke-evidence>`

## Safe Next Actions

- `confirm-s19-vercel-env-apply-approval`
- `run-redacted-vercel-env-sync-apply-with-approved-project-and-release-run-id`
- `run-production-deployment-only-after-env-sync-evidence-is-applied`
- `run-deployed-route-smokes-only-after-production-deployment-is-proven`
- `run-ordinary-teaching-smokes-only-after-auth-storage-and-deployment-evidence-are-live-ready`

## Stop Conditions

- Stop if app-auth, teacher-auth, or external-storage readiness is not live-ready.
- Stop if owner has not approved S19 Vercel env apply and S22 production deploy.
- Stop if Vercel env sync evidence is missing, mismatched, or not release-run-bound.
- Stop if production deployment evidence is missing or not bound to the release run.
- Stop if any live smoke would print deployment URLs, Vercel secrets, teacher-auth cookies, or response bodies.
- Stop if live provider-generation smoke would mutate a remote provider without explicit owner approval.

## Forbidden Until Approved

- `run-vercel-env-apply-without-owner-approval`
- `run-vercel-production-deploy-without-owner-approval`
- `run-live-provider-generation-smoke-before-browser-smoke-and-owner-approval`
- `run-deployed-route-smokes-before-production-deployment-evidence`
- `print-or-log-vercel-env-secret-values`
