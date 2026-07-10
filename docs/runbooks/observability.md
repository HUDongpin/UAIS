# UAIS Observability Runbook

Status: B-05 observability contract.
Created: 2026-07-08.

UAIS now has a redacted `/healthz` liveness endpoint and conditional Sentry SDK
initialization for client, server, and edge runtimes. Real Sentry and uptime
values are owner/S19/S22 controlled and must be configured outside Git.

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

Expected liveness result:

- HTTP 200.
- `cache-control: no-store`.
- JSON body includes `status: "ok"` and `service: "uais"`.
- No secret values, local paths, raw cookies, tokens, or student content.

## Production Stop Conditions

Do not claim B-05 production readiness if:

- `UAIS_UPTIME_CHECK_URL` is not configured in the external uptime provider.
- Sentry DSN/project/source-map env values are missing from the deployment lane.
- Sentry events or logs contain raw student content, cookies, DSNs, tokens, or
  local filesystem paths.
- `/healthz` fails or returns cacheable content.
