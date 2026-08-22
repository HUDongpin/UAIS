# UAIS P2 Current Performance Report

Evidence date: 2026-08-22 Asia/Hong_Kong
Planning baseline: `fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`
Validated P2 code SHA: `6e48ea8491a1542f54a2fff084f19fac1422c646`
Local Lighthouse laboratory status: `PASS`
Complete production performance status: `BLOCKED_ENV`

## Fixed local laboratory results

Command: `npm run test:p2:performance`
Evidence contract: `scripts/p2-performance-test.mjs`
Browser/runtime: pinned Chromium and Lighthouse on Node `v24.15.0`
Budgets: LCP ≤ 2,500 ms; CLS ≤ 0.10; TBT ≤ 200 ms; Lighthouse
Performance ≥ 85.

| ID | Status | Page | Performance score | LCP | CLS | TBT | Residual boundary | Responsible roles | Next step | Blocks production |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| P2-PERF-01 | `PASS` | `/login` | 100 | 662.795 ms | 0 | 0 ms | Local deterministic identity fixture, not staging auth | S06/S11/S12 | Repeat on isolated staging | Yes until staging/INP evidence |
| P2-PERF-02 | `PASS` | `/courses` | 100 | 612.381 ms | 0 | 0 ms | Local fixed course data, not database-backed staging | S02/S06/S11 | Repeat with staging dataset | Yes until staging/INP evidence |
| P2-PERF-03 | `PASS` | `/learning` | 100 | 629.133 ms | 0.001542 | 0 ms | Existing demonstration media is local | S03/S06/S11/S24 | Repeat with staging media path | Yes until staging/INP evidence |
| P2-PERF-04 | `PASS` | `/learning/chatroom` | 100 | 727.422 ms | 0.045812 | 0 ms | Deterministic provider state; no multi-user traffic | S04/S06/S11 | Repeat after group load on staging | Yes until staging/INP evidence |
| P2-PERF-05 | `PASS` | `/teaching` | 99 | 686.034 ms | 0.063639 | 0 ms | Deterministic teacher fixture; no persistent write | S05/S06/S11 | Repeat with staging data | Yes until staging/INP evidence |
| P2-PERF-06 | `NOT_RUN` | All five pages | INP p75 ≤ 200 ms | — | — | — | Lighthouse TBT is laboratory responsiveness evidence, not field/repeated-interaction INP p75 | S06/S11/S22 | Collect authorized existing analytics or a bounded staging interaction sample | Yes |
| P2-PERF-07 | `BLOCKED_ENV` | All five pages on canonical staging URL | Same complete budget | — | — | — | Independent Vercel staging project/database is not provisioned | S06/S11/S22 | Re-run the same SHA and visible fixture state on staging | Yes |

## Method and integrity controls

- The harness permits its managed local server by default. A remote target must
  be explicitly allowlisted and confirmed as staging; production hostnames are
  refused before the browser starts.
- Auth/session headers are written only to a mode-`0600` temporary file for the
  managed run and deleted in cleanup. Header values and response bodies are not
  emitted to the report.
- Raw Lighthouse files are removed after metric extraction. The canonical
  report contains only route names and aggregate performance metrics.
- The measured pages render their real visible local feature state. No content,
  interaction, image, or accessibility behavior was hidden or disabled to
  improve the score.
- Image dimensions and optimized Next.js image delivery prevent avoidable
  layout shifts; larger interactive modules remain loaded only when required by
  the user path.
- The run does not add or call a public Web Vitals endpoint and does not collect
  user-identifying telemetry.

All five local Lighthouse pages meet the measurable lab budgets, but this does
not satisfy the production performance gate. INP p75 remains `NOT_RUN`, and the
same candidate has not been measured on isolated staging under representative
database, media, and concurrent-user conditions.
