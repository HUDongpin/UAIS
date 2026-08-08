# UAIS Dedicated LRS Instance — Migration Runbook

- Date: 2026-08-02
- Audience: Dr. Peter Hu (owner)
- Related code: `scripts/lrs-tenant-isolation-audit.mjs`, `scripts/lrs-migrate-uais-statements.mjs`, `src/lib/learning-records/`
- Status: code ready; the provisioning step below requires owner action and owner credentials.

## Background

A 2026-08-02 audit found the configured LRS store is shared: ~18,200 statements, of which only 2 are real UAIS learner records and 9 are UAIS smoke statements; the rest belong to the separate AAIS application (verb IRIs under `www.aais.site`). Two protections now exist in code regardless of instance:

1. Every UAIS-produced statement is stamped with `https://uais.top/xapi/extensions/tenant-id = "uais"` (recorder-level, all producers).
2. All UAIS reads (`getXapiStatements`) drop statements that are not UAIS-produced (actor homePage `https://uais.top/xapi/actors` or the UAIS event-type extension), so analytics and learner profiles can no longer ingest AAIS statements even on the shared store. Caveat while still shared: the LRS applies query limits BEFORE this filter, so a page dominated by AAIS statements can leave analytics with fewer UAIS results than the limit suggests — another reason to complete this migration.

Moving to a dedicated instance completes tenant separation by storage, not just by convention.

## Owner step 1 — provision a dedicated LRS store (owner only)

Create a new store (or a new isolated tenant/credential pair) at your LRS provider. This needs your provider account and cannot be done by an AI session. You need three values: endpoint URL, Basic-auth username, Basic-auth password. Do not paste them into chat, reports, or Git — put them straight into `.env.local`.

If the new store lives at the SAME provider hostname as the current one (different path/credentials only), the migration script's same-origin safety guard will block by default; add `--allow-same-endpoint` in step 4 after double-checking the target path and credentials really point at the new store.

## Owner step 2 — add target variables to `.env.local`

Append (values redacted here by design):

```
UAIS_LRS_TARGET_ENDPOINT=...
UAIS_LRS_TARGET_USERNAME=...
UAIS_LRS_TARGET_PASSWORD=...
```

Note: the `UAIS_LRS_TARGET_*` names are migration-time only and are deliberately NOT registered in the B-21 env-surface catalog or `.env.local.example` (they should be removed again after cut-over). If they are ever promoted to standing configuration, register them via S19/S10 and bump the active-production cap in `tests/env-surface.test.ts`.

## Owner step 3 — verify the target store is empty and reachable

```bash
node scripts/lrs-tenant-isolation-audit.mjs --dry-run --env-file .env.local
```

Then run the same audit against the TARGET by temporarily pointing a copy of the env at it, or simply proceed — the migration itself is idempotent and reports per-statement results.

## Owner step 4 — migrate UAIS statements (dry-run first)

```bash
node scripts/lrs-migrate-uais-statements.mjs --dry-run --env-file .env.local
```

Expect `status: "ready"`. Then, with owner approval:

```bash
node scripts/lrs-migrate-uais-statements.mjs --live --approved --env-file .env.local --out coordination/reports/2026-08-02-lrs-migration.json
```

- Only UAIS app statements migrate by default; add `--include-smoke` to also carry over the 9 smoke statements and any other UAIS-actor statements.
- Statement ids are preserved; re-running is safe (identical re-POSTs are no-ops, conflicts are reported as `conflicts`, not failures).
- Foreign AAIS statements are never migrated.
- The script refuses a target whose origin equals the source (`target-endpoint-matches-source`) unless `--allow-same-endpoint` is passed.

## Owner step 5 — cut UAIS over to the dedicated instance

1. In `.env.local`: replace the `UAIS_LRS_ENDPOINT`/`UAIS_LRS_USERNAME`/`UAIS_LRS_PASSWORD` values with the dedicated-instance values, then delete the `UAIS_LRS_TARGET_*` lines.
2. Update the same three variables in Vercel (production) — note the deployed-env placement was never completed per the 2026-06 logs, so this is also the moment to close that gap.
3. Verify write/read against the new instance:

```bash
node scripts/lrs-live-write-read-smoke.mjs --live --approved --environment production --release-run-id uais-lrs-dedicated-cutover-2026-08-02 --env-file .env.local --out coordination/reports/2026-08-02-lrs-cutover-smoke.json
```

4. Verify isolation (should report `verdict: "dedicated"`, exit 0):

```bash
node scripts/lrs-tenant-isolation-audit.mjs --live --approved --expect-dedicated --env-file .env.local --out coordination/reports/2026-08-02-lrs-isolation-audit.json
```

## Rollback

Restore the previous `UAIS_LRS_*` values in `.env.local`/Vercel. Nothing is deleted from the old store by any of these steps; the migration only copies.

## Cost / rate-limit note

The audit pages `GET /statements` (default cap 20,000 statements at 100/page ≈ 200 requests); the migration adds one POST per selected statement (currently ~2–11). Both are bounded by `--max-statements` and are single-threaded.
