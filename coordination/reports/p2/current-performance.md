# UAIS P2 current performance report

Evidence date: 2026-08-23 Asia/Hong_Kong
Clean deployed Git SHA: `0e156b25b7b9a003a07b7f94cf7c8f8d7323ec3e`
Local Lighthouse laboratory status: `PASS`
Field INP status: `NOT_RUN`
Complete production performance status: `BLOCKED_ENV`

## Fresh local laboratory results

Command: `npm run test:p2:performance`

Budgets: Lighthouse performance >= 85; LCP <= 2,500 ms; CLS <= 0.10;
TBT <= 200 ms.

| Page | Status | Performance | LCP | CLS | TBT | INP p75 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `/login` | `PASS` | 100 | 635.814 ms | 0 | 0 ms | `NOT_RUN` |
| `/courses` | `PASS` | 100 | 591.256 ms | 0 | 0 ms | `NOT_RUN` |
| `/learning` | `PASS` | 100 | 630.024 ms | 0.001542 | 0 ms | `NOT_RUN` |
| `/learning/chatroom` | `PASS` | 100 | 726.933 ms | 0.045812 | 0 ms | `NOT_RUN` |
| `/teaching` | `PASS` | 99 | 731.285 ms | 0.063639 | 0 ms | `NOT_RUN` |

Every page returned the explicit INP reason
`field-or-repeated-interaction-evidence-required`. TBT is laboratory evidence
and is not an INP substitute.

## External performance gates

| Gate | Status | Current evidence | Remaining boundary |
| --- | --- | --- | --- |
| Immutable deployment health | `PASS` | 16/16 `/healthz` samples passed over 961 seconds | Health and CLI latency are not page-performance or INP evidence |
| Exact-deployment Lighthouse | `BLOCKED_ENV` | The isolated deployment is `READY`, but browser access requires an approved Vercel protection bypass | Re-run the same five pages against the exact immutable URL with staging identities and dataset |
| Field INP p75 | `NOT_RUN` | The app includes Vercel Analytics, but the installed Vercel CLI exposes no field-INP retrieval command and no approved dashboard/API evidence source or current-candidate distribution was supplied | Collect an authorized, privacy-safe dataset with enough representative interactions and report p75 by route/device |
| Loaded staging performance | `NOT_RUN` | The 5 -> 200 load has not executed | Repeat browser measurements during/after the approved load and correlate to the exact deployment |
| Production performance | `NOT_RUN` | Read-only control-plane audit binds production to `fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`, not the current candidate; no journey or field dataset was collected | Requires separate owner authorization after staging gates pass |

## Integrity controls

- The local harness used its managed loopback server and fixed test identities.
- Production targets are rejected; remote staging requires explicit confirmation
  and allowlisting.
- Temporary auth header files are mode `0600`; values are omitted and removed.
- Raw Lighthouse reports are removed after aggregate extraction.
- No field dataset, private analytics payload, user identifier, credential,
  cookie, or response body is retained.

The five local pages meet their laboratory budgets. Complete performance
acceptance remains `BLOCKED_ENV` because exact-deployment browser performance,
representative load, field INP p75, and production evidence are still absent.
