# UAIS current-candidate closure ledger

Evidence date: 2026-08-23 Asia/Hong_Kong

## Candidate identity and evidence boundary

- Clean deployed Git SHA: `0e156b25b7b9a003a07b7f94cf7c8f8d7323ec3e`.
- Clean Git-archive SHA-256: `8e1f2bf51939b220e3032e41cdeb294ccfc40b9e45a810028df13ccdb1d660f2`.
- Isolated Vercel project: `uais-staging`; this is not the production `uais` project.
- Immutable deployment ID: `dpl_8yQGJ5irPzpfnJU8aCLpJ9DRNrVi`.
- Control-plane state: `READY`; deployment metadata carries the exact Git and archive hashes above.
- Immutable health observation: `PASS`; 16/16 app/database/migration samples passed at 60-second cadence over 961 seconds. The 4,587 ms CLI end-to-end p95 includes CLI startup/auth and is not field-performance acceptance.
- The deployment used the staging project's production target only. It did not push or merge Git, change `uais.top`, or deploy the production `uais` project.
- `staging.uais.top` still resolves to an older deployment. Evidence collected through that mutable alias is not current-candidate evidence unless a time-bounded control-plane lookup proves the alias pointed to the immutable deployment during the run.
- The working tree now contains a local, undeployed load-harness patch that adds the cumulative `5 -> 20 -> 50 -> 100 -> 200` invite/join ramp. It is not part of the deployed SHA and cannot be represented as staging-executed.
- `coordination/reports/p2/current-candidate-closure.json` is the canonical machine-readable companion. `npm run release:p2:closure` validates the exact binding, 11 requested gates, 11 workspace rows, 7 credential-source categories, and the undeployed-overlay boundary; its current expected result is exit 2 / `BLOCKED_ENV`.
- Read-only production control-plane audit found `origin/main` and the current `uais.top` deployment both bound to `fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`. That proves the production baseline identity only. It also proves that production is not running this candidate SHA; no authenticated journey or database/OSS readback was performed.

## Eleven requested closure gates

| # | Current status | Current-candidate evidence | Remaining acceptance condition |
| --- | --- | --- | --- |
| 1 | `BLOCKED_ENV` | The default deterministic suite, lint, and build pass. A read-only DB guard mode now exists and passes focused contract tests. | `npm run test:db` has not executed because no approved dedicated guarded DB credential could be obtained. The linked staging environment has generic source/restore aliases but lacks the dedicated test/P2 aliases; local read-only probes time out. This remains `BLOCKED_ENV`, not `PASS`. |
| 2 | `PASS` | The clean SHA is bound by Vercel metadata to the isolated immutable deployment above. | Preserve this binding in every later external evidence record; a mutable staging alias alone is insufficient. |
| 3 | `BLOCKED_ENV` | Retained P1/P2 staging JSON is classified as historical. | A new exact-deployment restore run must supersede the retained failed restore result; historical JSON cannot be promoted into current evidence. |
| 4 | `BLOCKED_ENV` | Only redacted environment-variable presence was inspected. | Record owner-approved sources and target environments for OSS, Function Compute, DirectMail, DeepSeek/DashScope, LRS, database, and deployment credentials. |
| 5 | `BLOCKED_ENV` | Current-SHA local contract tests cover failover, LRS outbox retry, export, local backup restore, and disposable voice revocation. | Execute real provider, mail, OSS, knowledge-index, export, narration, and voice-revocation journeys using approved staging-only identities and credentials. |
| 6 | `BLOCKED_ENV` | The local load harness now implements the cumulative `5 -> 20 -> 50 -> 100 -> 200` join ramp and preserves the final 200-user, 40-group, 10-minute phase. | Execute every ramp stage against the exact current deployment and guarded staging DB, then prove thresholds and zero residue. |
| 7 | `BLOCKED_ENV` | Local contract tests cover retry, failure, restore refusal, and deletion/revocation behavior. | Execute PITR, OSS recovery, job replay, provider outage, and deletion reconciliation against isolated external targets. Logical dump/restore is not PITR or OSS recovery. |
| 8 | `NOT_RUN` | Automated Chromium/axe and local laboratory performance evidence exists. macOS 26.5.2, Safari 26.5.2, and VoiceOver 10 are installed; VoiceOver was not started because there are no approved staging identities/bypass and the computer-accessibility tree is not a VoiceOver utterance attestation. No Windows or Windows VM execution surface exists. | Complete human Safari + VoiceOver and Windows + NVDA journeys and collect current-candidate field INP p75 from an approved privacy-safe analytics source. |
| 9 | `NOT_RUN` | Read-only control-plane evidence binds current production `uais.top` to `fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`, matching `origin/main` but not candidate `0e156b25b7b9a003a07b7f94cf7c8f8d7323ec3e`. No production login, database/OSS readback, or mutation occurred. | Obtain separate immediate owner authorization, then promote an approved candidate and run only the minimal reversible teacher journey and readback against that exact production SHA. |
| 10 | `BLOCKED_ENV` | Local source and tests implement substantial P1/P2 domain projections and fail-closed external adapter boundaries. | Complete and externally verify course ACL, collaborators, relational backfill, structured content, KB, agents, quizzes/formative grades, analytics, exports, and voice across the intended Wave 1-5 scope. |
| 11 | `BLOCKED_ENV` | The workspace ledger below explicitly prevents local UI or contract-test evidence from being called `real-complete`. | Every workspace must satisfy its own database, provider, accessibility, load/recovery, and production-readback gates before promotion. |

## Teacher workspace ledger

| Workspace | Current ledger status | Evidence that exists | Missing before `real-complete` |
| --- | --- | --- | --- |
| Course settings | `implemented-unverified` | Server action/domain projection and local persistence tests | Dedicated DB, course ACL/ownership readback, staging and approved production journey |
| Agents | `implemented-unverified` | Agent-plan and permission-preflight projections; provider fail-closed tests | Approved live DeepSeek/DashScope source, real agent run, budget/failure/recovery evidence |
| Knowledge base | `implemented-unverified` | Knowledge-index projection and mocked external-adapter tests | Approved OSS/index source, real ingest/index/query/delete and reconciliation |
| Content | `implemented-unverified` | Structured content/unit-draft projections and local tests | Relational backfill, real publish/readback, OSS recovery, deletion reconciliation |
| Administrators | `implemented-unverified` | Admin settings and collaboration-invite/outbox contracts | Real course ACL/collaborator enforcement, approved DirectMail delivery/bounce/replay |
| Students | `implemented-unverified` | Roster/group projections and local/API tests | Dedicated relational DB, backfill proof, exact-deployment 5-to-200 load and cleanup |
| Data export | `implemented-unverified` | Export manifest/redaction contracts and local readback tests | Real export object generation, OSS readback, expiry/delete reconciliation, accessibility |
| Dashboard | `implemented-unverified` | Dashboard state/snapshot projections and local tests | Real relational analytics, data reconciliation, current-candidate load and field performance |
| Quiz board | `implemented-unverified` | Quiz assessment/item-review projections and local tests | Real quiz/formative-grade persistence, analytics readback, teacher acceptance |
| Grading | `implemented-unverified` | Grade queue/feedback/release/rollback contracts and local tests | Approved provider execution, gradebook readback, notification/replay and failure drill |
| Invite code | `implemented-unverified` | Invite draft/publication, join, approval, and group contracts | Exact-deployment DB/load run, ACL/readback, zero-residual cleanup, production authorization |

No row in this ledger is `real-complete`.

## Credential-source inventory

| Capability | Recorded owner-approved source | Current result |
| --- | --- | --- |
| OSS | none | `BLOCKED_ENV` |
| Function Compute | none | `BLOCKED_ENV` |
| DirectMail | none | `BLOCKED_ENV` |
| DeepSeek/DashScope | none for UAIS | `BLOCKED_ENV` |
| LRS | none | `BLOCKED_ENV` |
| Dedicated DB tests/load/restore | no usable approved source recorded for this run | `BLOCKED_ENV` |
| Deployment | existing authenticated Vercel CLI session was usable for isolated staging, but its owner-approved credential source is not documented | `BLOCKED_ENV` for credential-source closure |

Credential values, database URLs, session cookies, passwords, and provider payloads are intentionally omitted.

## Fresh local verification

- `npm run release:clean-check`: `PASS` before the new local load-harness patch.
- `npm test`: `PASS`; five deterministic sequential shards, 2,885 passed, 20 conditionally skipped, zero failures. A narration-speed assertion that only raced inside the full shard now waits for its existing React effect; no playback behavior changed.
- `npm run lint`: `PASS` with zero errors and one pre-existing internal-navigation warning.
- `npm run build`: `PASS`; Next.js 16.3.2, TypeScript and 24 static pages completed.
- `npm run test:p2:performance`: `PASS` for all five local pages; scores 99-100, LCP 591-731 ms, CLS 0-0.06364, TBT 0. INP p75 remains `NOT_RUN` on every page.
- `npm run test:p2:a11y`: 20/20 automated desktop/mobile, Chinese/English tests `PASS`; human VoiceOver/NVDA/keyboard/reflow gates remain open.
- `npm run test:p2:e2e`: 50 passed, 2 expected project skips, zero failed across desktop/mobile and both locales; staging journeys remain blocked.
- Targeted failure/replay/export/restore/voice suite: 4 files, 244 tests passed. This is local/mock evidence, not live-provider or disaster-recovery evidence.
- A focused source-remediation audit rechecked the five environment-independent `/teaching` defects recorded on 2026-08-18. Export-package and per-page audio downloads use the protected fetch/download path; the two teacher controls that called admin-only readiness/smoke routes remain removed; class forwarding, translation, copy affordance, and the scannable invitation QR fixes remain present. The former dead `修改封面 / Modify the cover` button is not rendered; the current candidate exposes only the persisted, signed-receipt AI-cover path. A teacher-upload branch was not invented because its size limit, MIME allowlist, moderation policy, OSS target, and audit contract still require owner decisions and an approved storage source.
- The broader Wave 1-5 source audit found an explicitly documented teacher-reviewed group-suggestion prefill seam, while the real group CRUD and server-side suggestion partition paths already exist separately. Connecting that seam or adding other domain behavior would require a reviewed cross-workspace acceptance package; auto-assignment is intentionally forbidden. This is additional evidence that the takeover cannot promote requirement 10 or any workspace to `real-complete`, not evidence that the broader domain scope is complete.
- Load ramp/same-deployment/DB-guard/closure gate: expected RED regressions reproduced, then 23/23 targeted tests `PASS` after implementation, including rejection of a historical restore record promoted to `PASS`.
- `npm run release:p2:closure`: expected exit 2 / `BLOCKED_ENV`; 1/11 requested gates passes (same-SHA immutable deployment), 0/11 teacher workspaces are `real-complete`, and 0/7 owner-approved source categories are recorded.
- Immutable deployment health: 16/16 samples `PASS` over 961 seconds.

This ledger is fail-closed: a local pass never substitutes for a database, provider, assistive-technology, load, recovery, or production gate.
