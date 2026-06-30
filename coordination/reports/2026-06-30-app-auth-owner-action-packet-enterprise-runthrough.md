# UAIS App Auth Owner Action Packet

Status: `owner-decision-needed`
Release gate: `blocked`
Queue rank: 1
Decision: `app-auth-provider-production-selector`

Do not inspect, print, or copy credential values.

## Owner Decision

Confirm production app auth provider mode and approved server-only env source.

Accepted options: `trusted-account-provider`

## Required Server-Only Env Names

- `UAIS_APP_SESSION_SIGNING_SECRET`
- `UAIS_APP_AUTH_PROVIDER`
- `UAIS_APP_AUTH_PROVIDER_URL`
- `UAIS_APP_AUTH_PROVIDER_TOKEN`

## Current Evidence Summary

- Evidence status: `dry-run-blocked`
- Environment: `production`
- Provider mode: `trusted-account-provider`
- Endpoint security: `remote-https`
- Vercel env sync: `missing`
- Release-run binding: `missing`
- Required app-auth env: `missing`

## Command Templates

- Dry-run env sync: `node scripts/vercel-env-sync.mjs --dry-run --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-dry-run-evidence>`
- Approved env apply: `node scripts/vercel-env-sync.mjs --apply --approved --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-evidence>`
- Approved app-auth readiness: `node scripts/app-auth-provider-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> > <app-auth-provider-readiness-evidence>`

## Stop Conditions

- Stop if owner has not approved the app auth provider mode and env source.
- Stop if approved env source is unavailable to S19.
- Stop if live provider readiness would call a remote endpoint without explicit approval.
- Stop if Vercel env sync evidence is missing, mismatched, or not release-run-bound.

## Forbidden Until Approved

- `inspect-or-print-app-auth-credential-values`
- `run-live-app-auth-provider-network-call`
- `run-production-smokes-dependent-on-app-auth`
