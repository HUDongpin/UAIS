# UAIS P2 current load report

Evidence date: 2026-08-23 Asia/Hong_Kong
Clean deployed Git SHA: `0e156b25b7b9a003a07b7f94cf7c8f8d7323ec3e`
Actual current-candidate load status: `BLOCKED_ENV`

## Implemented execution contract

- Cumulative invite/join stages: 5, 20, 50, 100, and 200 users.
- Every stage records added users, target users, request/success/failure counts,
  success rate, 5xx rate, retries, p95, and maximum latency.
- Every stage fails fast if success is below 99%, 5xx is above 0.5%, or p95 is
  above two seconds.
- After the ramp, the existing final phase keeps 200 users in 40 groups of five
  for ten minutes with deterministic no-agent traffic and group-isolation
  readback.
- Source and restore cleanup remain run-ID scoped and require zero residual
  tagged rows.
- Live execution must target the exact origin in
  `P2_IMMUTABLE_DEPLOYMENT_URL`; the mutable `staging.uais.top` alias is
  rejected before network use.
- A protected Vercel deployment additionally requires an in-memory
  `P2_VERCEL_PROTECTION_BYPASS_SECRET`. The harness sends it only as the bypass
  header and never includes it in output.

## Current evidence

| Gate | Status | Evidence | Boundary |
| --- | --- | --- | --- |
| Ramp implementation | `PASS` | Expected RED regressions reproduced; focused P2 operations gate is 23/23 | Local harness only |
| Dry-run plan | `PASS` | Emits `[5,20,50,100,200]`, final 40 x 5 x 10-minute plan, and `networkUsed=false` | No database, account, or route was exercised |
| Immutable-target refusal | `PASS` | Mutable staging alias and missing protection bypass both stop in preflight | Safety behavior only |
| Immutable deployment health | `PASS` | 16/16 `/healthz` samples passed over 961 seconds | Health is not load evidence |
| Dedicated DB prerequisite | `BLOCKED_ENV` | `npm run test:db` requires `UAIS_DB_TEST_DATABASE_URL`; the Vercel staging environment also lacks both dedicated P2 database aliases | Generic source/restore aliases are not substituted; no approved usable source was available |
| 5-user stage | `NOT_RUN` | No exact-deployment execution | Blocks load acceptance |
| 20-user stage | `NOT_RUN` | No exact-deployment execution | Blocks load acceptance |
| 50-user stage | `NOT_RUN` | No exact-deployment execution | Blocks load acceptance |
| 100-user stage | `NOT_RUN` | No exact-deployment execution | Blocks load acceptance |
| 200-user final stage | `NOT_RUN` | No exact-deployment execution | Blocks load acceptance |
| Zero-residual cleanup | `NOT_RUN` | No new fixtures were created | Must be zero after every real run |

Preserved P1/P2 staging load JSON belongs to earlier candidates or dirty
snapshots and remains historical. It does not satisfy any `NOT_RUN` row above.
No throughput, latency, success-rate, isolation, or cleanup result is claimed
for the current candidate.
