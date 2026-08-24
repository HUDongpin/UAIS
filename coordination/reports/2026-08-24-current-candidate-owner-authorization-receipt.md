# Current-candidate owner authorization receipt

- Date: 2026-08-24 Asia/Hong_Kong
- Responsible integration role: S22
- Status: `PARTIAL_CONFIG_SOURCE_ONLY`
- Values: redacted and not recorded

## Authorized boundary

The owner explicitly authorized an exact-pathspec local commit of the current
candidate overlay and a redeployment of the resulting SHA to the isolated
`uais-staging` project. This authorization does **not** authorize a push to
`main`, a production deployment, a production database mutation, or a
production teacher journey.

The owner approved these isolated-staging configuration names/sources:

- `UAIS_DB_TEST_DATABASE_URL`
- `UAIS_P2_STAGING_DATABASE_URL`
- `UAIS_P2_STAGING_RESTORE_DATABASE_URL`
- `P2_VERCEL_PROTECTION_BYPASS_SECRET`
- `UAIS_DEPLOYMENT_ENV=staging`
- `UAIS_LEARNING_CHATROOM_GROUPS_MODE=on`

## Redacted live observation

- The candidate worktree is linked to the separate `uais-staging` Vercel
  project, not the UAIS production project.
- The authenticated, read-only Vercel environment inventory command completed
  for that linked project.
- It observed zero environment-variable names in both the production target of
  the staging project and its preview target.
- The current process contains none of the approved staging names, and the
  candidate worktree has no `.env.local` file.

Therefore the owner has approved the names and target boundary, but no usable
secret/DSN values or owner-controlled value source are currently available to
this session. Dedicated DB testing remains `BLOCKED_ENV`; a same-SHA staging
deployment would fail closed before database inspection and is not attempted.

## Additional fail-closed inputs required by the implementation

Before a mutation-capable DB run or staging deployment, the approved target must
also provide the redacted attestations and lifecycle credentials documented in
`docs/env-surface.md`, including the DB-test fingerprint/confirmation fields,
non-production database identities, both required internal database guard rows,
candidate Git/content binding, a one-use cohort, HMAC/key version, approved adult
operator hashes, app-session signing, and a distinct expiry cron secret. No value
may be copied into Git, reports, screenshots, or command output.

## Sources not supplied or approved in this authorization

No UAIS-specific value source was supplied for OSS, Function Compute,
DirectMail, DeepSeek/DashScope, LRS, knowledge indexing, export, narration, or
voice-revocation providers. MAIS-MVP credentials remain out of scope and must
not be reused. Those live-provider and side-effect loops remain blocked rather
than inferred from contract tests.

The existing P1 load lane also selects `UAIS_P1_LOAD_TEST_DATABASE_URL`; that
name was not among the approved sources above. It is now catalogued as
production-quarantined, but its value remains unavailable, so the real 200-user
database load is still `BLOCKED_ENV`.

## Proof boundary

This receipt records authorization and redacted absence only. It is not evidence
of a real database PASS, a deployment, a provider call, load execution, restore,
PITR, accessibility assistive-technology run, field INP, production journey, or
any `real-complete` teacher-workspace ledger entry.
