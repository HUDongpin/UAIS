# UAIS P2 current release gate

Evidence date: 2026-08-23 Asia/Hong_Kong

- Clean deployed Git SHA: `0e156b25b7b9a003a07b7f94cf7c8f8d7323ec3e`.
- Clean Git-archive SHA-256: `8e1f2bf51939b220e3032e41cdeb294ccfc40b9e45a810028df13ccdb1d660f2`.
- Isolated immutable staging deployment: `dpl_8yQGJ5irPzpfnJU8aCLpJ9DRNrVi` in the `uais-staging` project.
- Current completion boundary: `same-SHA staging deployment and health verified; external acceptance incomplete`.
- Ready for production: `BLOCKED_ENV`.

The deployed SHA remains clean and immutable. A later local working-tree patch
adds a fail-closed `5 -> 20 -> 50 -> 100 -> 200` load ramp and exact-deployment
targeting; that patch is not deployed and is not represented as staging
evidence.

## Current gate ledger

| Gate | Status | Fresh evidence | Remaining boundary |
| --- | --- | --- | --- |
| Candidate local suite | `PASS` | Deterministic `npm test` passed all five shards: 2,885 passed, 20 conditionally skipped, zero failed; lint passed with zero errors and one pre-existing warning; Next.js 16.3.2 build and 24 static pages passed | External integrations are excluded from this local classification |
| Isolated same-SHA deployment | `PASS` | Vercel control-plane state `READY`; deployment metadata matches the exact Git SHA and archive hash above | The staging project uses its own production target; this is not the production `uais` project or `uais.top` |
| Fifteen-minute deployment health | `PASS` | 16/16 immutable-deployment `/healthz` samples passed over 961 seconds; app, database, and migrations all returned `ok` | CLI end-to-end p95 4,587 ms includes CLI startup/auth and is not field or route-performance acceptance |
| Machine closure ledger | `BLOCKED_ENV` | `release:p2:closure` validates the exact SHA/deployment binding, all 11 requested gates, all 11 teacher workspaces, and all 7 credential-source categories without network or secret values; it reports only gate 2 as `PASS` | It deliberately exits 2 until all remaining gates pass, every workspace is `real-complete`, approved source handles are recorded, and the local overlay is deployed |
| Dedicated DB suite | `BLOCKED_ENV` | Fresh `npm run test:db` exited 2 with `dedicated-db-test-database-url-required` | No approved usable `UAIS_DB_TEST_DATABASE_URL`; this is not `PASS` |
| Current restore/recovery | `BLOCKED_ENV` | Historical load/restore JSON remains preserved and classified as historical; the retained current-candidate restore result is not a pass | Execute exact-deployment PITR and OSS recovery plus relationship/count/migration checks |
| Credential-source closure | `BLOCKED_ENV` | Redacted presence-only inventory performed | Owner-approved UAIS sources are still unrecorded for OSS, Function Compute, DirectMail, DeepSeek/DashScope, LRS, DB, and deployment credentials |
| Real provider/data journeys | `BLOCKED_ENV` | 4 local/mock contract files, 244 tests passed for failover, outbox retry, export, local restore, and disposable voice revoke | Real provider, mail, OSS, KB, export, narration, and voice-revocation execution remains absent |
| Five-stage load | `BLOCKED_ENV` | Local harness and gates implement cumulative 5, 20, 50, 100, 200 invite/join stages and final 200-user group load | Not executed against an approved guarded DB and the exact deployment; no live thresholds or zero-residue proof |
| Failure/replay/deletion drills | `BLOCKED_ENV` | Local failure and retry contracts pass | No current PITR, OSS restore, live job replay, provider outage, or delete-reconciliation drill |
| Human accessibility and field INP | `NOT_RUN` | Existing automated Chromium/axe and laboratory evidence is retained as local evidence only. Safari and VoiceOver are installed locally, but no approved staging identities/bypass or human utterance attestation exists; no Windows/NVDA surface or field-INP data source is available | Safari + VoiceOver, Windows + NVDA, and field INP p75 remain open |
| Production journey/SHA/readback | `NOT_RUN` | Read-only audit binds current `uais.top` deployment and `origin/main` to `fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`; this differs from candidate `0e156b25b7b9a003a07b7f94cf7c8f8d7323ec3e`. No authenticated journey, DB/OSS readback, or mutation occurred | Requires separate immediate owner authorization after the other blocking gates close |
| Full Wave 1-5 domain acceptance | `BLOCKED_ENV` | Source implements substantial domain projections and fail-closed adapters | Course ACL, collaborators, relational backfill, structured content, KB, agents, formative grades, analytics, export, and voice are not fully externally verified |
| Eleven teacher workspaces | `BLOCKED_ENV` | Current ledger explicitly marks every workspace `implemented-unverified` | No workspace may be promoted to `real-complete` from local UI/contract evidence alone |

## Boundary decision

The current candidate has a real isolated, immutable same-SHA staging
deployment and a fresh 15-minute health observation. It has not completed the
dedicated DB, current restore, credential-source, real-provider, five-stage
load, recovery/failure, human AT, field INP, production, or full-domain gates.
No push, merge, production project deployment, production migration, domain
change, production login, paid-provider call, email, OSS write, or production
feature-flag change was performed.

Historical JSON, a local `PASS`, Vercel `READY`, or a passing health endpoint
cannot substitute for the unresolved gates above.
