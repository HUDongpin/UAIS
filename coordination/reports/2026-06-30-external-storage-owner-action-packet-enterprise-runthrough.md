# UAIS External Storage Owner Action Packet

Status: `owner-decision-needed`
Release gate: `blocked`
Queue rank: 3
Decision: `external-storage-production-service`

Do not inspect, print, or copy endpoint, credential, token, data-dir, or response-body values.

## Owner Decision

Confirm the approved remote HTTPS external-storage service and server-only env source.

Required service class: `approved-remote-https-external-storage-service`

## Required Server-Only Env Names

- `UAIS_TEACHER_AI_OWNERSHIP_BACKEND`
- `UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND`
- `UAIS_TEACHING_OPERATIONS_BACKEND`
- `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND`
- `UAIS_TEACHING_COURSE_ASSETS_BACKEND`
- `UAIS_EXTERNAL_STORAGE_BASE_URL`
- `UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN`
- `UAIS_EXTERNAL_STORAGE_SERVICE_MODE`
- `UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR`
- `UAIS_EXTERNAL_STORAGE_DATA_DIR`
- `UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS`
- `UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS`
- `UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY`
- `UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL`

## Current Evidence Summary

- Container build readiness: `ready`
- Local image build: `passed`
- Service readiness: `dry-run-blocked`
- Environment: `production`
- Health status: `missing`
- Health target: `missing`
- Production service identity: `missing`
- API contract version: `missing`
- Cache control: `missing`
- Durable backing store: `missing`
- Teaching operations schema: `missing`
- Teaching course management schema: `missing`
- Teaching course assets schema: `missing`
- Vercel env sync: `missing`

## Required Evidence

- `approved-remote-https-external-storage-service`
- `vercel-env-sync-evidence-with-external-storage-env-present`
- `external-storage-production-launch-contract`
- `external-storage-persistence-read-after-restart-proof`
- `external-storage-service-readiness-production-live-ready`
- `external-storage-smoke-live-passed`
- `same-release-run-id-bound-to-external-storage-readiness-and-smoke`

## Command Templates

- Dry-run env sync: `node scripts/vercel-env-sync.mjs --dry-run --scope external-storage --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <external-storage-vercel-env-sync-dry-run-evidence>`
- Approved env apply: `node scripts/vercel-env-sync.mjs --apply --approved --scope external-storage --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <external-storage-vercel-env-sync-evidence>`
- Approved service readiness: `node scripts/external-storage-service-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <external-storage-vercel-env-sync-evidence> --external-storage-production-launch-contract <external-storage-production-launch-contract-evidence> --external-storage-persistence <external-storage-persistence-evidence> > <external-storage-service-readiness-evidence>`
- Approved live smoke: `node scripts/external-storage-smoke.mjs --live --approved --environment production --env-file <approved-env-file> --teacher-id <approved-smoke-teacher-id> --release-run-id <release-run-id> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <external-storage-smoke-evidence>`

## Safe Next Actions

- `confirm-approved-remote-https-external-storage-service`
- `bind-server-only-external-storage-env-through-s19-vercel-env-sync`
- `run-approved-external-storage-persistence-read-after-restart-smoke`
- `run-external-storage-service-readiness-after-env-sync-launch-and-persistence-evidence`
- `run-external-storage-smoke-only-after-service-readiness-is-live-ready`

## Stop Conditions

- Stop if owner has not confirmed the approved remote HTTPS external-storage service and env source.
- Stop if approved env source is unavailable to S19.
- Stop if the external-storage endpoint is not remote HTTPS.
- Stop if Vercel env sync evidence is missing, mismatched, or not release-run-bound.
- Stop if production launch contract or persistence evidence is missing.
- Stop if live external-storage smoke would write to production without an approved smoke teacher id.

## Forbidden Until Approved

- `inspect-or-print-external-storage-secret-values`
- `run-live-external-storage-service-readiness`
- `run-live-external-storage-smoke`
- `run-production-smokes-dependent-on-external-storage`
