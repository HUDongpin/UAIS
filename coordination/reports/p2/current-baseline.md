# UAIS P2 current baseline

Evidence date: 2026-08-23 Asia/Hong_Kong

- Clean deployed Git SHA: `0e156b25b7b9a003a07b7f94cf7c8f8d7323ec3e`.
- Clean Git-archive SHA-256: `8e1f2bf51939b220e3032e41cdeb294ccfc40b9e45a810028df13ccdb1d660f2`.
- Branch: `codex/p1-p2-integration-candidate-20260822-final`.
- Runtime: Node 24.15.0; npm 11.12.1; Next.js 16.3.2.
- Local automated status: `PASS`.
- Isolated same-SHA deployment and 15-minute health: `PASS`.
- Complete staging acceptance and production readiness: `BLOCKED_ENV`.

The deployed candidate is the clean SHA above. The current working tree adds
an undeployed, fail-closed five-stage load harness plus refreshed evidence. No
claim about staging execution includes that local overlay.

## Fresh evidence

| Gate | Status | Result |
| --- | --- | --- |
| Full deterministic suite | `PASS` | Five sequential shards; 2,885 passed, 20 conditionally skipped, zero failed |
| Lint | `PASS` | Zero errors; one pre-existing internal-navigation warning |
| Production build | `PASS` | TypeScript and 24 static pages completed |
| Local E2E | `PASS` | 50 passed, 2 expected project skips, zero failed across desktop/mobile and both locales |
| Automated accessibility | `PASS` | 20/20 passed across desktop/mobile and both locales |
| Local Lighthouse | `PASS` | Five pages scored 99-100; all LCP/CLS/TBT budgets passed |
| Field INP p75 | `NOT_RUN` | Every performance result explicitly requires field or repeated-interaction evidence |
| P2 canonical evidence check | `PASS` | Seven required current reports present, status-valid, and redacted |
| Current-candidate closure gate | `BLOCKED_ENV` | Machine-readable manifest validates 11/11 gate rows, 11/11 workspace rows, exact HEAD/deployment binding, and 7/7 credential-source categories; only gate 2 passes |
| Dedicated DB suite | `BLOCKED_ENV` | Fresh exit 2: `UAIS_DB_TEST_DATABASE_URL` required; no test executed |
| Real provider/data journeys | `BLOCKED_ENV` | No approved credential sources or exact-deployment execution |

## External state

| Surface | Status | Current boundary |
| --- | --- | --- |
| Isolated Vercel staging project | `PASS` | `uais-staging` exists; current immutable deployment is `READY` and metadata-bound to the clean SHA/archive hash |
| Immutable deployment health | `PASS` | 16/16 app/database/migration samples passed at 60-second cadence over 961 seconds |
| Mutable `staging.uais.top` alias | `BLOCKED_ENV` | It points to an older deployment and cannot be used as current-SHA evidence |
| Dedicated DB tests/load/restore | `BLOCKED_ENV` | Staging environment contains generic source/restore database aliases with distinct non-production identifiers, but dedicated P2/test aliases and an approved source record are absent; local read-only connectivity probes timed out |
| Current PITR/OSS recovery | `NOT_RUN` | Historical logical restore evidence is not a current PITR/OSS drill |
| Five-stage load | `NOT_RUN` | Local harness is ready; 5, 20, 50, 100, and 200 stages were not executed |
| VoiceOver/Safari | `NOT_RUN` | macOS 26.5.2, Safari 26.5.2, and VoiceOver 10 are installed, but no approved staging identities/bypass or VoiceOver utterance attestation exists; the service was not started |
| Windows NVDA/Chrome | `BLOCKED_ENV` | No Windows host or local Windows VM execution surface is available |
| Production journey/readback | `NOT_RUN` | Current production and `origin/main` are both `fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`, not this candidate; no production authorization, login, DB/OSS readback, or mutation occurred |

## Evidence integrity

- Historical P1/P2 staging/load/restore JSON is retained only as historical
  audit material and cannot satisfy a current row.
- Local tests, Vercel `READY`, health checks, lab TBT, and UI completeness are
  different evidence classes.
- Secrets, database URLs, cookies, passwords, raw provider payloads, and user
  data are omitted.
- No Git push/merge, production project deployment, production database or OSS
  mutation, email, paid-provider call, production login, domain change, or
  production feature-flag change occurred.

The baseline is therefore locally validated and same-SHA staging-health
verified, but not staging-accepted, production-ready, or evidence that any of
the eleven teacher workspaces is `real-complete`.
