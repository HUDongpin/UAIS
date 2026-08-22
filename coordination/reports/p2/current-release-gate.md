# UAIS P2 Current Release Gate

Evidence date: 2026-08-22 Asia/Hong_Kong
Planning baseline: `fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`
Validated P2 code SHA: `6e48ea8491a1542f54a2fff084f19fac1422c646`
Current completion boundary: `local automated validated`
Staging validation: `BLOCKED_ENV`
Ready for production: `BLOCKED_ENV`

| ID | Status | Gate and evidence | Failure or residual boundary | Responsible roles | Next step | Blocks production |
| --- | --- | --- | --- | --- | --- | --- |
| P2-GIT-01 | `PASS` | S10 isolation commit `0eb5f1d`; isolated branch/worktree; P2 code commits `2466851`, `ccfb90a`, and `6e48ea8` | Local commits only; final documentation commit remains to be created | S10/S25 | Use exact pathspec and prove both worktrees clean | Yes if regressed |
| P2-LOCAL-01 | `PASS` | `npm run lint` | No errors | S10/S11 | Preserve | Yes if regressed |
| P2-LOCAL-02 | `PASS` | `npm test`: five bounded sequential shards; 197 files; 2,717 passed; 18 conditional skips | Default lane is local/offline; external integration is deliberately separate | S10/S11 | Preserve classification/deadlines | Yes if regressed |
| P2-LOCAL-03 | `PASS` | `npm run test:critical`: 6 files, 106/106 passed | No local failure | S11 | Re-run unchanged candidate | Yes if regressed |
| P2-LOCAL-04 | `PASS` | `npm run build`: Next.js 16.2.9, TypeScript pass, 24/24 static pages | No local failure | S10/S22 | Re-run unchanged candidate | Yes if regressed |
| P2-LOCAL-05 | `PASS` | Aggregate `npm run test:p2:gate` | All bounded stages passed in order: lint, default tests, critical, build, E2E, axe, Lighthouse, and evidence validation | S10/S11/S22 | Preserve the exact aggregate contract | Yes if regressed |
| P2-UX-01 | `PASS` | `npm run test:p2:e2e`: 50 passed, 2 expected desktop skips, 0 failed across desktop/mobile and both locales | Staging auth/data/runtime not exercised | Route owners/S11 | Repeat on isolated staging | Yes until staging proof |
| P2-A11Y-01 | `PASS` | `npm run test:p2:a11y`: 20/20 passed, 72 state attachments across 18 unique states, zero axe violations at all impact levels | Chromium automation is not a human assistive-technology sign-off | S09/S11 | Re-run staging and complete manual gates | Yes until manual/staging proof |
| P2-A11Y-02 | `NOT_RUN` | Human keyboard-only matrix | No qualified manual run recorded | S09/S11 | Execute both locales and key responsive states | Yes |
| P2-A11Y-03 | `NOT_RUN` | VoiceOver + Safari student/teacher journeys | No manual run recorded | S09/S11 | Execute checklist in `current-a11y.md` | Yes |
| P2-A11Y-04 | `BLOCKED_ENV` | NVDA + Chrome student/teacher journeys | No Windows/NVDA host is available in the current environment | S09/S11 | Execute on authorized Windows host | Yes |
| P2-A11Y-05 | `NOT_RUN` | 200% reflow, reduced-motion, target-size, and color-cue review | Human perceptual review not recorded | S06/S09/S11 | Complete manual checklist | Yes |
| P2-PERF-01 | `PASS` | `npm run test:p2:performance`: five local pages meet Lighthouse score/LCP/CLS/TBT budgets | Local laboratory only | S06/S11 | Repeat on isolated staging | Yes until staging/INP proof |
| P2-PERF-02 | `NOT_RUN` | INP p75 ≤ 200 ms | No field or bounded repeated-interaction p75 evidence; TBT is not a substitute | S06/S11/S22 | Collect approved staging/analytics evidence | Yes |
| P2-EXT-01 | `BLOCKED_ENV` | `npm run test:external` | Isolated `UAIS_CORE_DATABASE_URL` absent; explicit lane exited before tests | S11/S12/S22 | Run only against proven staging database | Yes |
| P2-STAGE-01 | `BLOCKED_ENV` | Independent `uais-staging` project, database, secrets, and canonical URL | No external staging resources were created or modified | S19/S22 | Provision and prove isolation with redacted IDs | Yes |
| P2-LOAD-01 | `BLOCKED_ENV` | Actual 200-user invite/group load and zero-residual cleanup | Guard/dry-run pass; no actual staging executor or data | S11/S14/S22 | Run only after isolation proof | Yes |
| P2-AI-01 | `BLOCKED_ENV` | At most three real-provider requests with budget/rate/timeout/monitoring controls | No approved UAIS credential source or control-plane proof | S07/S19/S22 | Obtain separate owner authorization if still required | Yes |
| P2-OPS-01 | `BLOCKED_ENV` | Fifteen-minute health checks and alert trigger/recovery | No staging deployment/monitoring path | S19/S22 | Execute on isolated staging | Yes |
| P2-OPS-02 | `BLOCKED_ENV` | Backup/snapshot restore into a new target | No isolated database/snapshot target | S12/S22 | Execute and record RPO/RTO/counts | Yes |
| P2-OPS-03 | `BLOCKED_ENV` | Twenty-four-hour staging observation | No candidate staging deployment | S11/S22 | Start after earlier staging gates pass | Yes |
| P2-SEC-01 | `INHERITED_DEBT` | `npm audit`: 1 low, 14 moderate, 24 high, 1 critical | Reachability/upgrade triage is incomplete; no forced dependency change was made | S10/S22/security owner | Close or explicitly mitigate all production-relevant findings | Yes |
| P2-EVID-01 | `PASS` | Seven canonical current reports contain only allowed status terms and redacted evidence | Must be rechecked after the final report update | S10/S11 | Run `node scripts/p2-evidence-check.mjs` | Yes if regressed |
| P2-EVID-02 | `PASS` | `npm run release:package-gate` with an eight-line exact pathspec file | 8 dirty entries matched 8 pathspecs; zero missing, stale, duplicate, wildcard, mismatch, or retained intermediate-map findings; `releaseReady` correctly remained false | S10/S22/S25 | Stage exactly the same eight paths | Yes if regressed |
| P2-PROD-01 | `BLOCKED_ENV` | Push, merge, deployment, alias, production migration, live smoke, and production observation | Explicitly outside current authorization; none occurred | Release owner/S22/S25 | Seek separate authorization only after all blocking gates pass | Yes |

## Boundary decision

The candidate has reached `local automated validated`: deterministic local
quality, browser journeys, axe, and Lighthouse laboratory checks pass. It has
not reached `staging validated` because no isolated Vercel project/database was
provisioned or exercised. It is not `ready for production` because manual
keyboard, VoiceOver, NVDA, reflow/target checks, INP p75, external DB tests,
actual load, monitoring/alerts, recovery, 24-hour observation, and dependency
risk triage remain open.

Groups remain off in production. No push, merge, deployment, production
migration, domain/alias change, production smoke, or live-provider request has
occurred. Allowed ledger statuses are `PASS`, `FAIL`, `BLOCKED_ENV`, `NOT_RUN`,
and `INHERITED_DEBT`; a local `PASS` never substitutes for an external gate.
