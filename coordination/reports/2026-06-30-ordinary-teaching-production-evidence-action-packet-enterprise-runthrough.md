# UAIS Ordinary Teaching Production Evidence Action Packet

Status: `waiting-for-live-evidence`
Release gate: `blocked`
Queue rank: 5
Decision: `ordinary-teaching-production-evidence`
Sequencing: `external-storage-and-auth-readiness-before-live-ordinary-teaching-smokes`

Do not run ordinary-teaching live smokes until auth, storage, deployment, and reachability evidence are release-run-bound.

## Owner Question

Run ordinary-teaching live smokes only after auth, storage, and deployment evidence are ready.

## Upstream Evidence

- `app-auth-provider-readiness`
- `teacher-auth-provider-readiness`
- `external-storage-service-readiness`
- `vercel-production-deployment`
- `deployment-domain-reachability`

## Current Evidence Summary

- Teaching operations route smoke: `dry-run-blocked`
- Operation detail browser smoke: `dry-run-blocked`
- Teaching course management route smoke: `dry-run-blocked`
- Release-run binding: `missing`
- Teacher-auth binding: `missing`
- App-auth binding: `missing`
- External-storage binding: `missing`
- Vercel deployment binding: `missing`
- Deployment origin: `missing`
- Operation detail API mode: `fixture-backed-contract`
- Course management backend: `missing`

## Required Evidence

- `app-auth-provider-readiness-production-live-ready`
- `teacher-auth-provider-readiness-production-live-ready`
- `external-storage-service-readiness-production-live-ready`
- `vercel-production-deployment-evidence`
- `deployment-domain-reachability`
- `issued-teacher-auth-cookie-bound-to-ordinary-teaching-smokes`
- `live-teaching-operations-route-smoke`
- `live-teaching-operation-detail-browser-smoke`
- `live-teaching-course-management-route-smoke`
- `same-release-run-id-bound-to-ordinary-teaching-evidence`
- `same-vercel-production-deployment-bound-to-ordinary-teaching-smokes`

## Command Templates

- Teaching operations route smoke: `node scripts/teaching-operations-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --course-id <approved-smoke-course-id> --cookie <approved-teacher-auth-cookie> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teaching-operations-backend external --teaching-course-management-backend external > <teaching-operations-route-smoke-evidence>`
- Operation detail browser smoke: `node scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --api-mode live-teaching-operations > <teaching-operation-detail-browser-smoke-evidence>`
- Teaching course management route smoke: `node scripts/teaching-course-management-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --other-teacher-id <approved-other-teacher-id> --student-id <approved-student-id> --cookie <approved-teacher-auth-cookie> --other-teacher-cookie <approved-other-teacher-auth-cookie> --student-cookie <approved-student-auth-cookie> --release-run-id <release-run-id> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teacher-ai-ownership-backend external --course-management-backend external --course-assets-backend external --teaching-operations-backend external > <teaching-course-management-route-smoke-evidence>`

## Safe Next Actions

- `confirm-ordinary-teaching-live-smoke-prerequisites`
- `wait-for-auth-storage-and-vercel-deployment-evidence`
- `run-live-teaching-operations-route-smoke-after-auth-storage-deployment-readiness`
- `run-live-operation-detail-and-course-management-smokes-with-issued-teacher-auth-cookie`
- `collect-release-run-bound-ordinary-teaching-evidence-for-enterprise-audit`

## Stop Conditions

- Stop if auth, storage, deployment, or reachability evidence is missing or not release-run-bound.
- Stop if issued teacher-auth cookies or approved smoke ids are unavailable.
- Stop if owner has not approved live ordinary-teaching smokes and provider-backed side effects.
- Stop if local or dry-run smoke evidence is being treated as production live evidence.
- Stop if any command would print deployment URLs, teacher-auth cookies, backend secrets, env values, or response bodies.

## Forbidden Until Approved

- `run-live-ordinary-teaching-smokes-before-auth-storage-and-deployment-readiness`
- `call-live-teaching-operations-api-without-issued-teacher-auth-cookie`
- `run-provider-backed-side-effect-smokes-without-owner-approval`
- `accept-local-production-smoke-as-production-live-evidence`
- `print-or-log-teacher-auth-cookie-or-backend-secret-values`
