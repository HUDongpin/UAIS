# UAIS Pre-Deploy Checklist

Use this checklist before promoting a UAIS deployment to `www.uais.top`.

## Before Build

- Confirm the change package has a clear owner and rollback boundary.
- Confirm no real secrets, local credential documents, screenshots, or `.env*`
  files are staged.
- Confirm production local-demo auth is not being enabled.
- Confirm deployed environments have explicit `UAIS_APP_SESSION_SIGNING_SECRET`
  values.
- Confirm any new env var is documented with a redacted purpose and owner.
- Confirm the active production env surface in `docs/env-surface.md`; do not
  require quarantined legacy variables for the core POC flow without owner/S19/S22
  approval.
- Confirm B-05 observability variables from `docs/runbooks/observability.md`
  are present in the target deployment lane, with values redacted from evidence.
- For any B-11/B-12 database package, confirm `UAIS_CORE_DATABASE_URL` points to
  the correct preview/staging/production Postgres lane and run migrations only
  after backup/rollback evidence exists.

## Local Checks

Run the narrowest relevant tests, then the standard gates when practical:

```bash
npm run lint
npm run test
npm run build
```

If `npm run build` hangs or cannot finish, do not claim release readiness.
Record the exact last output and hand the blocker to S22.

`npm run test:db` is the database lane. The Postgres-backed stores - teaching
course management, chatroom transcripts, chatroom shares, and first-party
accounts with their login-failure lockout - have integration suites that skip
themselves unless `UAIS_CORE_DATABASE_URL` points at a reachable Postgres, which
is why `npm run test` alone never exercises a real database. Run this lane before
promoting any change to a migration, a Postgres store, or the login path, against
a throwaway instance rather than a deployment lane: `docker run --rm -d --name
uais-local-pg -e POSTGRES_PASSWORD=<local-only> -e POSTGRES_DB=uais_core -p
127.0.0.1:55432:5432 postgres:16`, then
`UAIS_CORE_DATABASE_URL="postgresql://postgres:<local-only>@127.0.0.1:55432/uais_core"
npm run test:db`. The suites apply the migrations themselves through
`scripts/apply-core-migrations.mjs`, so a schema drift fails the lane instead of
the deploy; the lane runs its files serially because they share one database and
concurrent first-time migration runs race each other. Never point this lane at
staging or production: it writes and deletes its own rows. Reported skips are not
passes - if the output says the suites were skipped, the lane did not run.

## Smoke Checks

For a preview or staging deployment:

- `GET /healthz` returns HTTP 200 and `cache-control: no-store`.
- External uptime points to the target lane's `/healthz` endpoint.
- Sentry receives a test event in the target lane without DSNs, tokens, cookies,
  local paths, request bodies, or student content in the evidence.
- `/login` loads.
- A signed student session cannot open `/teaching`.
- A signed teacher session can reach `/teaching` only when the production auth
  provider is ready.
- Core route responses do not include local paths, secrets, tokens, or demo
  passwords.

## Promotion

- Follow `docs/runbooks/staging-preview.md`: preview first, staging second,
  production last.
- Promote preview to staging first when data or auth behavior changed.
- Promote staging to production only after smoke checks are recorded.
- Record deployment URL, commit/ref, operator, check results, and rollback target
  in `coordination/reports/`.

## Rollback Readiness

Before promotion, identify:

- The last known good production deployment.
- The operator who can restore it.
- The validation command:

```bash
curl -i https://www.uais.top/healthz
```

Use `docs/runbooks/production-rollback.md` if the promoted deployment fails.
