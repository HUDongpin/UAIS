# UAIS P2 Current Operations Report

Evidence date: 2026-08-22 Asia/Hong_Kong
Planning baseline: `fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`
Validated P2 code SHA: `6e48ea8491a1542f54a2fff084f19fac1422c646`
Local deterministic operations status: `PASS`
Staging and production operations status: `BLOCKED_ENV`

## Acceptance ledger

| ID | Status | Operation | Evidence/command | Failure or residual boundary | Responsible roles | Next step | Blocks production |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P2-OPS-01 | `PASS` | Default offline suite is bounded and reproducible | `npm test` | Five sequential shards passed: 197 files total, 2,717 assertions passed, 18 conditional skips; each shard has a 300-second deadline | S10/S11 | Preserve deterministic classification and deadlines | Yes if regressed |
| P2-OPS-02 | `PASS` | Docker/external-process readiness is explicit and bounded | `npm test`; focused readiness regressions | Default dry-run starts no Docker; explicit client/daemon probes have startup, health, and total deadlines plus cleanup diagnostics | S10/S22 | Keep external execution outside default unit lane | Yes if regressed |
| P2-OPS-03 | `BLOCKED_ENV` | Explicit external database suite | `npm run test:external` | Ended in 1.68 seconds with five suites and zero tests before any connection because isolated `UAIS_CORE_DATABASE_URL` is absent | S10/S11/S12 | Supply only an isolated staging database reference, then run explicit lane | Yes |
| P2-OPS-04 | `BLOCKED_ENV` | Independent Vercel project `uais-staging` and independent Neon branch/database | External control-plane review | No project/database was created or mutated; isolation IDs and redacted variable parity cannot be proven locally | S19/S22 | Prove project binding and database ID/host differ from production before any write | Yes |
| P2-OPS-05 | `BLOCKED_ENV` | Fifteen-minute `/healthz` steady-state observation | One request per minute, retaining status, latency, and request ID only | No isolated staging deployment or canonical staging URL exists | S22 | Correlate 15 samples with deploy, DB, Sentry, and function logs | Yes |
| P2-OPS-06 | `BLOCKED_ENV` | Sentry/uptime alert trigger, delivery, deduplication, recovery, and owner acknowledgement | Redacted control-plane evidence | Staging environment marker and alert delivery path have not been authorized/configured | S19/S22 | Exercise one safe synthetic failure and recovery | Yes |
| P2-OPS-07 | `BLOCKED_ENV` | Backup/snapshot restore into a new target | Staging recovery drill below | No isolated database or snapshot target exists | S12/S22 | Execute non-overwriting recovery and verify relationships/counts/migrations | Yes |
| P2-OPS-08 | `BLOCKED_ENV` | Twenty-four-hour staging stability observation | Candidate deployment timeline | No staging deployment was performed | S11/S22 | Begin only after local, a11y, load, alert, and restore prerequisites | Yes |
| P2-OPS-09 | `INHERITED_DEBT` | Dependency vulnerability inventory | `npm audit` | 40 findings: 1 low, 14 moderate, 24 high, 1 critical. No auto-fix or forced major upgrade was applied | S10/S22/security owner | Triage reachability and upgrade plan; critical/high risk needs explicit closure | Yes |
| P2-OPS-10 | `PASS` | Production/non-production mutation boundary | Git and command review | No push, merge, deploy, Vercel/Neon/domain/Sentry/env mutation, live provider call, or production feature-flag change occurred | S10/S22/S25 | Preserve until separate authorization | Yes if violated |

## Required staging isolation preflight

Before any write-capable staging command, S19/S22 must record only names and
redacted `present`/`missing` states and verify:

1. The Vercel project is `uais-staging`, not the production `uais` project.
2. Database host, database name, or Neon branch ID differs from production.
3. Staging session/auth secrets are distinct; no value is printed or copied to
   this repository.
4. `SENTRY_ENVIRONMENT` resolves to the staging marker.
5. Groups are enabled only in staging; production
   `UAIS_LEARNING_CHATROOM_GROUPS_MODE` remains `off`.
6. Automated/load AI mode is deterministic stub; live mode is fail-closed.
7. General Git previews remain disabled and the candidate SHA is deployed
   manually only to the independent staging project.
8. A run-ID cleanup method and database rebuild/delete procedure are known.

If database isolation cannot be proven, migration, fixture creation, load, and
recovery commands must stop before the first write.

## Incident runbook

### `/healthz` anomaly

1. Record UTC/local time, status, latency, request ID, candidate SHA, and current
   deployment ID; do not retain a response body containing user data.
2. Continue the bounded probe to distinguish one transient 503 from sustained
   failure. A single sample is an anomaly, not a diagnosis.
3. Correlate the same interval with deployment events, database health,
   migration state, Sentry errors, and Vercel Function logs.
4. If failures persist, stop promotion and new writes, identify the failing
   dependency, and notify the named release owner.
5. Record recovery samples and cause; do not declare recovery from one isolated
   successful request.

### Database outage or migration failure

1. Freeze further migrations, fixture creation, and load traffic.
2. Verify target project/database identity using redacted IDs before inspecting
   schema state.
3. Compare applied migration records with the candidate manifest. Never retry a
   partially applied non-idempotent migration blindly.
4. Restore or roll back only through the pre-tested staging procedure and only
   within the authorized environment.
5. Validate login, course relationships, group isolation, message counts,
   learning progress, and migration status before reopening writes.

### AI provider outage, timeout, or cost anomaly

1. Disable live-provider mode and retain the deterministic stub or a clear
   recoverable unavailable state.
2. Confirm request deadline, rate limit, hard budget/cost cap, and circuit-
   breaker state through redacted control-plane evidence.
3. Do not automatically retry rejected or timed-out requests at high frequency.
4. Escalate unexpected spend to S19/S22 and the provider owner; rotate a
   credential only through its approved secret manager and responsibility map.
5. Never paste provider responses, prompts, keys, or private chat into reports.

### Error-rate or export-failure spike

1. Segment sanitized metrics by route, status class, deployment, and staging
   environment; do not retain export/chat bodies.
2. Check unhandled promise rejections and critical browser console errors.
3. Reproduce with a test identity and deterministic data, then either correct
   the candidate or stop promotion.
4. Confirm the alert sends a deduplicated trigger and recovery notification to
   the named owner.

### Test-data cleanup failure

1. Stop subsequent load, restore, and release steps.
2. Query only by test prefix/run ID and record created, cleaned, and residual
   counts.
3. Remove data using the staging-only cleanup contract; never broaden a delete
   target based on an unresolved variable or wildcard.
4. Resume only when residual count is zero or the isolated staging database is
   safely rebuilt.

### Rollback and feature flags

1. Production rollback, push, merge, deployment, and alias changes require a
   separate owner authorization; this report is preparation, not authority.
2. Bind rollback to the last known-good deployment and its migration
   compatibility; appoint release and rollback owners before promotion.
3. Stop any group enablement on the first persistent health, data-isolation,
   migration, or P1/P2 error. Production groups remain `off` throughout P2.
4. After rollback, run consecutive health and core-route probes and document
   deployment identity separately from Git identity.

## Recovery drill acceptance contract

The staging drill must create representative users, courses, groups, messages,
and progress; take a recoverable snapshot; damage only tagged staging fixtures;
restore into a new target; and verify login, relationships, group isolation,
message counts, progress, and schema/migration state. Record RPO, RTO, actual
recovery duration, lost record count, operator, snapshot/target redacted IDs,
and rollback steps. Restoring over the source staging database is not accepted.

No external operations were performed during this local implementation. The
local harness is ready to fail closed, but the project is not staging-validated
or production-ready until all `BLOCKED_ENV`, `NOT_RUN`, and security debt gates
above are resolved.
