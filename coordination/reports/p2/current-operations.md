# UAIS P2 current operations report

Evidence date: 2026-08-23 Asia/Hong_Kong
Clean deployed Git SHA: `0e156b25b7b9a003a07b7f94cf7c8f8d7323ec3e`
Current operations boundary: `same-SHA staging health verified; disaster and provider operations blocked`

## Current operations ledger

| Operation | Status | Fresh evidence | Remaining boundary |
| --- | --- | --- | --- |
| Isolated deployment identity | `PASS` | `uais-staging` immutable deployment is `READY`; metadata matches Git and archive hashes | Preserve exact ID/SHA on all later evidence |
| Steady health | `PASS` | 16/16 app/database/migration health samples passed at 60-second cadence over 961 seconds | This is not a 24-hour soak or alert-delivery drill |
| Dedicated DB integration | `BLOCKED_ENV` | Fresh runner refused to launch without `UAIS_DB_TEST_DATABASE_URL`. Redacted staging inventory found generic source/restore aliases with distinct non-production Neon identifiers, but no dedicated P2/test aliases; read-only local `SELECT 1` probes timed out | Record the approved source, bind dedicated aliases, then run the read-only guard and DB suite from a network surface that can reach the databases |
| Read-only DB guard | `BLOCKED_ENV` | New `--guard-only` path verifies both internal environment guards and both migration ledgers, emits counts only, and exits before migrations/build. Focused RED→GREEN test passes; staging `vercel env run` exits 2 before DB access because dedicated aliases, staging marker, and groups mode are absent | Execute this undeployed guard in the isolated Vercel runtime only after owner-approved source intake and source deployment authorization |
| Current restore | `BLOCKED_ENV` | Retained failed/historical restore evidence was not promoted | Execute non-overwriting current-candidate restore and verify schema, relationships, counts, checksums, login, RPO/RTO, and zero residue |
| PITR | `NOT_RUN` | Logical dump/restore evidence, where present historically, is explicitly not classified as PITR | Execute provider PITR into a distinct target |
| OSS recovery | `NOT_RUN` | No approved OSS source or recovery target | Upload tagged object, delete/damage only test data, restore/read back, and reconcile cleanup |
| Job replay | `BLOCKED_ENV` | Local LRS outbox retry/dead-letter tests pass | Execute real isolated outbox/provider replay with idempotent readback |
| Provider outage/recovery | `BLOCKED_ENV` | Local failover and partial-failure contracts pass | Trigger one bounded staging failure, observe alert/fallback, recover, and reconcile provider state |
| Delete reconciliation | `BLOCKED_ENV` | Local disposable voice-revoke contract passes | Execute approved real voice/object/index deletion and prove provider/local/ledger agreement |
| Sentry/uptime alert path | `BLOCKED_ENV` | Staging env inventory lacks the required monitoring configuration | Configure approved staging-only alert target and prove trigger, dedupe, delivery, recovery, and acknowledgement |
| Twenty-four-hour soak | `NOT_RUN` | Only the bounded 15-minute health run exists | Begin only after DB/load/restore/provider/alert gates pass |
| Production operation | `NOT_RUN` | No production action occurred | Separate immediate owner authorization is required |

## Safety boundary

- Production Git refs, project, domain, database, OSS, provider accounts, and
  feature flags were not changed.
- Credential values, URLs containing credentials, cookies, passwords, raw
  provider payloads, and user data are not retained.
- Exact-deployment execution is fail-closed; a mutable staging alias cannot be
  used as same-SHA evidence.
- Historical staging/load/restore JSON is preserved for audit but cannot be
  upgraded to current evidence.
- Generic `DATABASE_URL`/`POSTGRES_URL` aliases are never promoted into the
  dedicated DB-test or P2 source/restore contract.

The operational gate remains `BLOCKED_ENV` until every external drill above is
executed with approved sources and current-candidate evidence.
