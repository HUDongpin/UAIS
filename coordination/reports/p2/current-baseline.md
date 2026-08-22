# UAIS P2 Current Baseline

Evidence date: 2026-08-22 Asia/Hong_Kong
Planning baseline: `fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`
S10 isolation baseline: `0eb5f1dc44ccfb8d77c94cb1b6919f4236302c92`
Validated P2 code SHA: `6e48ea8491a1542f54a2fff084f19fac1422c646`
Local automated status: `PASS`
Production readiness: `BLOCKED_ENV`

| Field | Value |
| --- | --- |
| Branch | `codex/p2-quality-ux-a11y-ops` |
| Worktree | `/Volumes/Starship/UAIS/.worktrees/p2-quality-ux-a11y-ops` |
| Runtime | Node `v24.15.0`; npm `11.12.1` |
| Browser projects | Chromium `1440×900` and `390×844`; `zh-CN` and `en-US` |
| Test identities | `p2-student-a`, `p2-student-b`, `p2-teacher-a` |
| Test course | `p2-quality-pilot`; existing public 19-page demonstration deck/audio |
| Git boundary | Local commits only; no push, merge, deployment, or production mutation |

## Current local evidence

| ID | Status | Command | Result | Production blocker |
| --- | --- | --- | --- | --- |
| P2-BASE-01 | `PASS` | `npm run lint` | ESLint completed with no errors | Yes if regressed |
| P2-BASE-02 | `PASS` | `npm test` | Five sequential bounded shards; 197 files total, 2,717 passed assertions, 18 conditional skips | Yes if regressed |
| P2-BASE-03 | `PASS` | `npm run test:critical` | 6 files, 106/106 tests passed | Yes if regressed |
| P2-BASE-04 | `PASS` | `npm run build` | Next.js 16.2.9 build passed; TypeScript passed; 24/24 static pages generated | Yes if regressed |
| P2-BASE-05 | `PASS` | `npm run test:p2:e2e` | 50 passed, 2 desktop-only mobile-navigation skips, 0 failed | Yes if regressed |
| P2-BASE-06 | `PASS` | `npm run test:p2:a11y` | 20/20 tests passed; 72 redacted axe state attachments across 18 unique states; 0 violations at every impact level | Yes if regressed |
| P2-BASE-07 | `PASS` | `npm run test:p2:performance` | Five pages passed fixed lab budgets; scores 99–100 | Yes if regressed |
| P2-BASE-08 | `BLOCKED_ENV` | `npm run test:external` | Ended in 1.68s before tests; isolated `UAIS_CORE_DATABASE_URL` not present | Yes |
| P2-BASE-09 | `BLOCKED_ENV` | `npm run test:provider:live` | No network request; budget/rate/timeout/monitoring/approved credential evidence absent | Yes |
| P2-BASE-10 | `PASS` | `npm run test:p2:gate` | All eight bounded local stages completed and the final evidence check passed | Yes if regressed |

## Determinism corrections proven during implementation

- Default Vitest runs with `fileParallelism: false` through five sequential
  shards, each with a 300-second process deadline and fail-fast behavior.
- `tests/p2/browser/**` belongs only to Playwright and is excluded from Vitest.
- Docker readiness dry-run starts no Docker process. Explicit Docker client and
  daemon probes have startup/health deadlines and diagnostic cleanup.
- Smoke loaders honor an explicit `NODE_PATH` Playwright runtime before the
  pinned local dependency; an invalid explicit runtime fails closed.
- `.next/**`, `.tmp/**`, `.worktrees/**`, and `worktrees/**` are excluded from
  ESLint; nested worktrees are excluded from Vitest.

## Environment and evidence boundaries

- Independent Postgres/Neon staging database: `BLOCKED_ENV`; no connection
  value was read or printed.
- Independent Vercel project `uais-staging`: `BLOCKED_ENV`; not created or
  mutated.
- VoiceOver/Safari manual run: `NOT_RUN`.
- Windows NVDA/Chrome manual run: `BLOCKED_ENV` on this macOS host.
- Field or repeated-interaction INP p75: `NOT_RUN`; Lighthouse TBT is not used
  as a substitute.
- Sentry/uptime alert delivery, 15-minute health observation, restore drill,
  200-user execution, and 24-hour observation: `BLOCKED_ENV` until isolated
  staging exists.
- `npm audit` reports inherited dependency debt: 40 findings (1 low,
  14 moderate, 24 high, 1 critical). No forced upgrade was applied; this must
  be triaged before production authorization.
- No credential, production account, production database, private course
  material, real provider call, push, merge, deploy, domain change, or feature
  flag mutation occurred.
