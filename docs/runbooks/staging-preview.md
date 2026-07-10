# UAIS Preview And Staging Runbook

Status: B-09 deployment-lane contract.
Created: 2026-07-08.

UAIS must not use production as the first full-system test environment. Every
release that changes auth, storage, routing, AI, observability, privacy, or
core user journeys should move through:

1. Preview deployment.
2. Staging alias or staging-marked preview deployment.
3. Production promotion.

This runbook documents the contract. It does not mutate Vercel settings or
store secrets in Git.

## Lane Contract

| Lane | Purpose | Required evidence before promotion |
| --- | --- | --- |
| Preview | Build the exact review slice and expose it at a non-production URL. | Deployment URL exists, redacted env coverage is applied to preview, `/healthz` passes, auth smoke passes, and the critical-flow smoke/matrix is current. |
| Staging | Exercise the production-like configuration on a stable non-production alias or staging-marked preview deployment. | Staging URL exists, `UAIS_DEPLOYMENT_ENV=staging` or equivalent lane marker is applied, `/healthz` passes, auth smoke passes, critical flows pass, and Sentry/uptime are pointed at staging. |
| Production | Promote only after preview and staging are both green. | Production URL exists, production env is applied, `/healthz` passes, auth smoke passes, critical flows pass, rollback target is known, and owner/operator approval is recorded. |

## Required Promotion Order

Production readiness is blocked unless both preview and staging evidence are
present and current for the same release slice.

Do not use a narrow local test as proof of staging. Staging must be a deployed
non-production lane with the same auth/session, storage, observability, and
privacy stop-condition checks expected in production.

## Minimum Smoke Set

- `GET /healthz` returns HTTP 200 and `cache-control: no-store`.
- `/login` loads on the lane URL.
- Shared demo auth is blocked in deployed preview/staging/production lanes.
- Signed student session cannot open `/teaching`.
- Signed teacher session can reach `/teaching` only when the auth provider is
  production-ready for that lane.
- Core route responses omit local paths, secrets, tokens, cookies, DSNs, and
  demo passwords.
- The B-16 critical-flow matrix is current for login, enrol, learn, chat, and
  teacher CRUD.

## Vercel Notes

- Vercel Preview deployments are acceptable for the preview lane.
- Staging may be a separate Vercel project, a stable preview alias, or another
  owner-approved non-production deployment. It must have a stable URL and a
  clear lane marker.
- Production env apply evidence must include both production and preview target
  coverage. Staging evidence is an additional gate, not a substitute for
  preview coverage.
- All evidence must be redacted: no env values, tokens, cookies, deployment
  secrets, provider keys, or local private paths.

## Operator Decisions Still Required

- The canonical staging URL or Vercel project/alias.
- The exact staging env source handle for S19, without values in chat or docs.
- Whether staging shares the production Sentry project with a distinct
  `SENTRY_ENVIRONMENT=staging`, or uses a separate Sentry project.
- Who can approve promotion from staging to production.
