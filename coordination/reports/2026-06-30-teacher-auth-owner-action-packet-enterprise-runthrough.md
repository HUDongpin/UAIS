# UAIS Teacher Auth Owner Action Packet

Status: `owner-decision-needed`
Release gate: `blocked`
Queue rank: 2
Decision: `teacher-auth-provider-production-selector`

Do not inspect, print, or copy credential or cookie values.

## Owner Decision

Confirm production teacher auth provider mode and approved server-only env source.

Accepted options: `trusted-cookie-issuer`, `oidc-jwks`

## Required Server-Only Env Names

Current mode: `trusted-cookie-issuer`

- `UAIS_TEACHER_AUTH_PROVIDER`
- `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET`
- `UAIS_TEACHER_AUTH_ISSUER_SECRET`

Trusted-cookie issuer mode:

- `UAIS_TEACHER_AUTH_PROVIDER`
- `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET`
- `UAIS_TEACHER_AUTH_ISSUER_SECRET`

OIDC JWKS mode:

- `UAIS_TEACHER_AUTH_PROVIDER`
- `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET`
- `UAIS_TEACHER_AUTH_OIDC_ISSUER`
- `UAIS_TEACHER_AUTH_OIDC_AUDIENCE`
- `UAIS_TEACHER_AUTH_OIDC_JWKS_URL`
- `UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM`

## Current Evidence Summary

- Evidence status: `dry-run-blocked`
- Environment: `production`
- Provider mode: `trusted-cookie-issuer`
- Vercel env sync: `missing`
- Release-run binding: `missing`
- Trusted route-chain evidence: `proved`
- Trusted issuer route smoke: `missing`
- Route-smoke deployment binding: `missing`
- Trusted-cookie round trip: `proved`

## Required Evidence

- `vercel-env-sync-evidence-with-teacher-auth-env-present`
- `trusted-teacher-auth-route-chain-contract`
- `deployed-teacher-auth-issuer-route-smoke`
- `teacher-auth-provider-readiness-production-live-ready`
- `same-release-run-id-bound-to-teacher-auth-readiness`

## Command Templates

- Dry-run env sync: `node scripts/vercel-env-sync.mjs --dry-run --scope teacher-auth --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <teacher-auth-vercel-env-sync-dry-run-evidence>`
- Approved env apply: `node scripts/vercel-env-sync.mjs --apply --approved --scope teacher-auth --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <teacher-auth-vercel-env-sync-evidence>`
- Approved teacher-auth readiness: `node scripts/teacher-auth-provider-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <teacher-auth-vercel-env-sync-evidence> --trusted-teacher-auth-route-chain <trusted-teacher-auth-route-chain-evidence> --route-smoke <teacher-auth-issuer-route-smoke-evidence> > <teacher-auth-provider-readiness-evidence>`

## Safe Next Actions

- `confirm-production-teacher-auth-provider-mode`
- `bind-server-only-teacher-auth-env-through-s19-vercel-env-sync`
- `run-approved-teacher-auth-provider-readiness-after-env-sync`
- `run-deployed-teacher-auth-issuer-route-smoke-after-production-deploy`
- `run-production-smokes-only-after-teacher-auth-readiness-is-live-ready`

## Stop Conditions

- Stop if owner has not approved the teacher auth provider mode and env source.
- Stop if approved env source is unavailable to S19.
- Stop if production deployment evidence is unavailable for the issuer route smoke.
- Stop if live teacher-auth readiness would issue a reusable teacher-auth cookie without explicit approval.
- Stop if Vercel env sync evidence is missing, mismatched, or not release-run-bound.

## Forbidden Until Approved

- `inspect-or-print-teacher-auth-credential-values`
- `issue-live-teacher-auth-cookie`
- `run-live-teacher-auth-provider-network-call`
- `run-production-smokes-dependent-on-teacher-auth`
