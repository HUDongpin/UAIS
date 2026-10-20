# UAIS Observability Runbook

Status: B-05 observability contract.
Created: 2026-07-08.

UAIS now has a redacted `/healthz` endpoint and conditional Sentry SDK
initialization for client, server, and edge runtimes. `/healthz` reports app
liveness plus the two dependency facts the product cannot work without: that
the core database answers, and that it carries this build's migrations. Real
Sentry and uptime values are owner/S19/S22 controlled and must be configured
outside Git.

## Required Environment

- `SENTRY_DSN`: server/edge Sentry DSN.
- `NEXT_PUBLIC_SENTRY_DSN`: browser Sentry DSN.
- `SENTRY_ORG`: Sentry organization slug for source-map upload.
- `SENTRY_PROJECT`: Sentry project slug for source-map upload.
- `SENTRY_AUTH_TOKEN`: CI/deploy token for source-map upload. Never expose this
  through `NEXT_PUBLIC_`.
- `SENTRY_ENVIRONMENT`: deployment lane such as `preview`, `staging`, or
  `production`.
- `SENTRY_RELEASE`: release id when not using the Vercel commit SHA.
- `SENTRY_TRACES_SAMPLE_RATE`: number from `0` to `1`; default is `0.1`.
- `SENTRY_ENABLE_LOGS`: optional `true`/`false` flag for Sentry Logs.
- `UAIS_UPTIME_CHECK_URL`: external uptime monitor target, normally
  `https://www.uais.top/healthz`.
- `UAIS_UPTIME_PROVIDER`: label only, such as `better-stack`, `sentry-cron`, or
  another approved monitor.

## Privacy Defaults

- `sendDefaultPii` is `false` in the UAIS Sentry initialization options.
- Session replay and user feedback widgets are not enabled in this baseline.
- Source-map upload is disabled unless `SENTRY_AUTH_TOKEN` is present.
- Readiness evidence must report only variable names and present/missing state.
  Do not print DSNs, auth tokens, cookies, local paths, request bodies, or
  student content.

## Verification

Run the local contract tests after changing observability files:

```bash
npm run test -- tests/observability-readiness.test.ts tests/app-healthz.test.ts
```

Before promoting a preview/staging deployment:

```bash
curl -i "$UAIS_UPTIME_CHECK_URL"
```

Expected healthy result (treat as success):

- HTTP 200.
- `cache-control: no-store`.
- JSON body includes:
  - `status: "ok"`
  - `service: "uais"`
  - `checkedAt` (ISO timestamp)
  - `checks.app`: `"ok"`
  - `checks.database`: `"ok"`, or `"not-configured"` only outside a production
    runtime (a local developer must not need Postgres for `/healthz` to pass)
  - `checks.migrations`: `"ok"`, or `"not-configured"` only outside a production
    runtime
  - `redaction` with `secrets`, `localFiles`, and `databaseUrl` all `"omitted"`
- Optional `gitCommitSha`: a 7-character SHA taken from `VERCEL_GIT_COMMIT_SHA`
  when that value is present and valid (hex, 7–40 characters). The field is
  omitted when the env var is missing or invalid. The JSON body never includes
  the full SHA when the env value is longer than 7 characters.
- No secret values, local paths, raw cookies, tokens, connection strings,
  driver errors, or student content.

Expected unhealthy result (treat as failure; monitors act on the status code):

- HTTP **503**, not 200-with-a-warning.
- JSON `status: "degraded"` (not `"ok"`).
- Same `service`, `checks` object, cache, and redaction rules as above.
- Typical `checks` values that produce 503:
  - `database: "unreachable"` (connection failed, timed out, or never settled)
  - `database: "not-configured"` on a production runtime
  - `migrations: "behind"` (database is reachable but missing this build's
    schema; optional `migrationCurrency` lists `expected` count and `missing`
    in-repo version names, with `valueRedacted: true`)
  - `migrations: "unknown"` (ledger unreadable or never applied; no
    `migrationCurrency` block)

Do not claim the site is healthy from `checks.app: "ok"` alone. App liveness
can be green while the database or migrations are not.

## Production Stop Conditions

Do not claim B-05 production readiness if:

- `UAIS_UPTIME_CHECK_URL` is not configured in the external uptime provider.
- Sentry DSN/project/source-map env values are missing from the deployment lane.
- Sentry events or logs contain raw student content, cookies, DSNs, tokens, or
  local filesystem paths.
- `/healthz` returns cacheable content, HTTP 503 / `status: "degraded"`, or
  HTTP 200 without `status: "ok"` and healthy `checks.database` /
  `checks.migrations`.
