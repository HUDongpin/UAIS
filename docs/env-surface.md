# UAIS Environment Surface

Status: B-21 env-surface shrink and quarantine map.
Created: 2026-07-08.

This document separates the environment variables needed for the core UAIS POC
from variables retained for historical release gates, future enterprise modules,
or optional live AI work. It does not contain real values and it does not inspect
`.env.local`.

## Source Of Truth

- Catalog: `src/lib/release/env-surface.ts`
- Test: `tests/env-surface.test.ts`
- Example template: `.env.local.example`

## Tiers

- `active-production`: core auth, managed Postgres, LRS, Sentry, uptime, and
  durable-storage variables that may be part of a production POC deployment after
  S19/S22 approval. Durable storage is not optional once group chatrooms are
  live - courses, chatroom transcripts and share links all refuse local JSON in a
  production runtime - but it needs no storage-specific configuration: a
  production runtime with `UAIS_CORE_DATABASE_URL` persists them on the managed
  Postgres by default. The storage trio
  (`UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND`, `UAIS_EXTERNAL_STORAGE_BASE_URL`,
  `UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN`) left quarantine because it is now a
  supported production choice rather than a legacy name, and is required only
  when a deployment selects `external` instead. Verify either path with
  `npm run release:chatroom-readiness`.
- `optional-live-ai`: DeepSeek, DashScope/Qwen, AI access, and live-AI spend
  guard variables. The provider credentials stay blocked until the owner approves
  live provider use, cost, and rate-limit risk for a specific task. The
  `UAIS_LEARNING_CHATROOM_RATE_LIMIT_*` names are the exception: they tune a
  guard that is already enforced with safe defaults when they are unset, so
  leaving them unconfigured is safe and setting the mode to `off` is not. The
  reserved group-chatroom names below also sit in this tier.
- `quarantined-legacy`: the teacher-auth issuer/OIDC split, the remaining
  external-storage service-side names, the external-append teaching provider, and
  enterprise evidence-gate variables, plus the local JSON
  data-directory paths that only apply outside production. They are retained for
  historical scripts/tests and local/test persistence, but are not required for
  the core POC production surface.

## Launch Auth Selectors

The launch configuration authenticates against the managed Postgres the
deployment already requires, so it needs no external identity service:

- `UAIS_APP_AUTH_PROVIDER=database-accounts` — logins are checked against the
  `uais_users` rows. `UAIS_APP_AUTH_PROVIDER_URL` and
  `UAIS_APP_AUTH_PROVIDER_TOKEN` are read only by `trusted-account-provider` and
  are therefore conditional, not required — the same treatment the
  external-storage endpoint pair gets. Provisioning and password resets for those
  rows are `scripts/seed-uais-accounts.mjs` and
  `scripts/reset-uais-account-password.mjs`; see `docs/auth-contract.md`.
- `UAIS_APP_SESSION_SIGNING_SECRET` — at least 32 characters, the same floor the
  teacher session secret carries. A deployed runtime refuses a shorter value and
  mints no session at all, so this is a launch-blocking value rather than a
  best-effort one; a local runtime still accepts anything.
- `UAIS_TEACHER_AUTH_PROVIDER=database-account-cookie` — teacher sessions are
  minted at login for accounts already verified as `role = 'teacher'`. It needs
  `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET` (at least 32 characters) and
  nothing else: no issuer URL, no second secret. Both names left quarantine
  because a deployment without them serves a teacher who can read the course
  list and then 401s on every write.
- `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` — must be unset in production. It is the
  only switch that lets the `local-demo` provider (the fallback for an unset
  `UAIS_APP_AUTH_PROVIDER`) mint sessions in a production runtime, which would
  put the repo's public demo accounts on the live site.
- `trusted-account-provider`, `trusted-cookie-issuer` and `oidc-jwks` stay
  supported and catalogued as future options; none of them has a deployed
  service today.

`UAIS_CORE_DATABASE_URL` is required in the BUILD environment as well as at
runtime: `npm run vercel-build` applies the migrations from there, and `/healthz`
reports `checks.migrations` as `behind` (503) for a deployment whose database
never received them.

## Durable Learning-Record Outbox

P1 learning events are committed to Postgres before an API success response and
then mirrored to the LRS by a protected outbox dispatcher. The dispatcher uses
`UAIS_LEARNING_RECORD_OUTBOX_SECRET`, a server-only value of at least 32
characters. It is required in a deployment that runs the P1 learning loop and
must never be placed in a `NEXT_PUBLIC_*` variable, request log, xAPI statement,
or evidence report. LRS credentials remain separate; pausing or failing the LRS
dispatcher does not roll back classroom submissions or feedback stored in
Postgres.

## Local JSON Data Directories

`UAIS_TEACHING_COURSES_DATA_DIR` and `UAIS_LEARNING_CHATROOM_TRANSCRIPTS_DATA_DIR`
are quarantined, not active-production, because every production runtime path
asserts external storage and answers 503 for local JSON persistence. They apply
to development, tests, and non-production lanes only:

- `UAIS_TEACHING_COURSES_DATA_DIR` defaults to
  `.tmp/uais-teaching-course-management-db` under the working directory.
- `UAIS_LEARNING_CHATROOM_TRANSCRIPTS_DATA_DIR` splits transcripts off the course
  records. When unset it falls back to `UAIS_TEACHING_COURSES_DATA_DIR`, and only
  then to `.tmp/uais-learning-chatroom-transcripts-db`.

Leave both unset in deployed lanes; a deployment that needs them is a signal that
external storage is not configured.

## Group-Chatroom Names

These `optional-live-ai` names belong to the group learning chatroom rollout
(see
`coordination/reports/2026-08-08-learning-chatroom-group-implementation-plan.md`,
decisions D6 and D9). As of 2026-08-08 all four are read by
`src/app/api/learning/chatroom/route.ts`:

- `UAIS_LEARNING_CHATROOM_GROUPS_MODE`: group-chatroom feature flag. Group
  rooms stay disabled (403 `feature-not-enabled` for `groupId` requests)
  unless this is explicitly `on`.
- `UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_MODE`: history-read (GET) guard
  switch, enforced unless set to `off`.
- `UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_MINUTE`: default 30.
- `UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_DAY`: default 2000.

## P1 Teacher Feedback AI

`UAIS_LEARNING_FEEDBACK_AI_ENABLED` is a server-only, exact-`true` opt-in for
teacher-requested AI feedback drafts. It remains `false` or unset until the
owner and S19 approve a UAIS-specific provider credential source, cost/rate
limit boundary, and target environment. Enabling it also requires the existing
server-only `DEEPSEEK_API_KEY`; neither value is exposed to the browser or
recorded in evidence. When disabled or unavailable, teachers retain the full
manual feedback and decision path.

## Isolated Staging INP Evidence

The current-candidate INP lane is deliberately quarantined from the `uais`
production project. It can run only in the separate `uais-staging` Vercel
project, against a database carrying the enabled
`isolated-p2-staging-source` guard row. Every name below must remain unset in
production:

- `UAIS_DB_TEST_DATABASE_URL`, `UAIS_P1_LOAD_TEST_DATABASE_URL`,
  `UAIS_P2_STAGING_DATABASE_URL`, and
  `UAIS_P2_STAGING_RESTORE_DATABASE_URL` select disposable or isolated staging
  databases. Their values never enter logs or evidence.
- The mutation-capable `npm run test:db` lane is fail-closed. DB tests remain
  `BLOCKED_ENV` until all of the following are supplied for the same approved
  target: `UAIS_DB_TEST_DATABASE_URL`, a non-production
  `UAIS_DB_TEST_NEON_PROJECT_ID`, `UAIS_DB_TEST_DSN_FINGERPRINT`, a secret-like
  `UAIS_DB_TEST_DSN_FINGERPRINT_NONCE` of at least 32 characters, and the exact
  `UAIS_DB_TEST_LIVE_MUTATION_CONFIRMATION` acknowledgement
  `I_CONFIRM_UAIS_DB_TEST_MUTATES_ONLY_AN_ISOLATED_NON_PRODUCTION_DATABASE`
  required by `scripts/run-db-tests.mjs`. The fingerprint binds the normalized
  host, port, database and username to the independent project identity and
  nonce. After those static checks pass, the runner still requires both enabled
  `isolated-uais-db-test` and `isolated-p2-staging-source` database
  guard rows with the normal replication role before either child starts. The
  first authorizes the general mutation lane and is rechecked in each migration
  transaction; the second authorizes the staging-INP store, which rechecks it on
  every lifecycle operation. A URL by itself is never permission to inspect or
  mutate a database.
- The mutation-capable `npm run test:load:p1` lane selects only
  `UAIS_P1_LOAD_TEST_DATABASE_URL` and reuses the same independently supplied
  `UAIS_DB_TEST_NEON_PROJECT_ID`, DSN fingerprint, secret nonce, and exact live
  mutation confirmation. Before migration it additionally requires the enabled
  `isolated-p1-load-test` row in `public.uais_environment_guard` with
  `session_replication_role=origin`; both the migration child and the one-use
  load-test capability repeat that authorization. The URL alone, a generic DB
  alias, or a direct Vitest invocation cannot enable the 200-student writes.
- `NEON_PROJECT_ID` declares the isolated source database identity independently
  of its URL. `RESTORE_NEON_PROJECT_ID` does the same for the isolated restore target
  used by `scripts/p2-staging-build.mjs`; source, restore, and the known
  production identity must all be distinct. That two-database workflow also
  requires `UAIS_DEPLOYMENT_ENV=staging`,
  `UAIS_LEARNING_CHATROOM_GROUPS_MODE=on`, and the enabled
  `isolated-p2-staging-source` and
  `isolated-p2-staging-restore` guard rows before it migrates either target.
  That two-target orchestrator gives each migration child only its own DSN and
  guard through an allowlisted environment. Its Next-build child retains the
  source runtime DSN but receives no restore, DB-test, P1-load, or generic DB
  target. Child output is captured and dynamically redacted for every
  secret-like value before it can reach an operator or CI log.
- The `uais-staging` Vercel build uses
  `scripts/vercel-staging-build-guard.mjs`. The default `vercel-build` dispatcher
  routes by exact Vercel project ID: the production project retains its existing
  migration/build path, the isolated staging project enters this guard, and an
  unknown Vercel project fails closed. Missing Vercel system variables are also
  ambiguous because a project can disable their automatic exposure; they no
  longer imply a local run. A deliberate local `npm run vercel-build` requires
  the one-command exact
  `UAIS_LOCAL_VERCEL_BUILD_CONFIRMATION=I_CONFIRM_UAIS_VERCEL_BUILD_IS_LOCAL_ONLY`
  opt-in, which must never be persisted in any Vercel project. `npm run build`
  remains the ordinary local source-build command. `vercel.staging.json` additionally injects
  the non-secret `UAIS_STAGING_CONFIG_ATTESTATION` build marker; the guard rejects
  its absence before database inspection, so a deployment that omits the staging
  config cannot enable collection without the hourly expiry schedule. Do not set
  that marker as a project-wide environment value. The guard requires the exact
  staging project, `UAIS_DEPLOYMENT_ENV=staging`,
  `UAIS_LEARNING_CHATROOM_GROUPS_MODE=on`, `UAIS_P2_STAGING_DATABASE_URL`, and a
  non-production `NEON_PROJECT_ID`. Before invoking any migration, it connects
  through the dedicated URL and requires the enabled
  `public.uais_environment_guard` row for `isolated-p2-staging-source` plus
  `session_replication_role=origin`; the migration runner repeats the same check
  in its first transaction before any DDL and immediately before each independent
  LangGraph setup. The unverified identity string cannot
  authorize the URL by itself.
  `UAIS_CORE_DATABASE_URL`, `DATABASE_URL`, and `POSTGRES_URL` must all be unset
  at entry. Before that inspection it also verifies the candidate Git SHA against
  Vercel's SHA, the immutable deployment host, the recomputed deployable-content
  digest, RUM opt-in, SHA-bound cohort, key version, operator allowlist, and four
  distinct strong secrets for HMAC, app session, expiry cron, and protection
  bypass. The wrapper exposes the dedicated URL as `UAIS_CORE_DATABASE_URL`
  only to the migration child, then removes every generic alias again before
  the Next build. A populated generic alias blocks the build as `BLOCKED_ENV`.
- `P2_CANDIDATE_GIT_SHA`, `P2_CANDIDATE_CONTENT_SHA`,
  `P2_IMMUTABLE_DEPLOYMENT_URL`, `UAIS_DEPLOYMENT_BASE_URL`, and
  `UAIS_DEPLOYMENT_ENV=staging` bind evidence to one immutable deployment. The
  Git SHA must equal Vercel's deployed commit SHA; mutable aliases are refused.
  Generate the content digest from the clean deployment source with
  `node scripts/p2-staging-candidate-content.mjs`. `next.config.ts` recomputes
  the same allowlisted-source digest during the staging build, fails on a
  mismatch, and compiles the verified value into the server artifact. A
  syntactically valid but self-asserted digest therefore cannot enable capture.
- The read-only `scripts/p2-staging-build.mjs --guard-only` receipt requires the
  source and restore ledgers to match every current repository migration by
  exact version and SHA-256 checksum. Empty, missing, extra, reordered, or
  checksum-mismatched rows are `BLOCKED_ENV`, never `PASS`. Even an exact match
  is labeled `preflightOnly`; it does not prove that a restore ran, that restored
  data was read back, or that PITR is available.
- `UAIS_STAGING_INP_RUM_ENABLED` is an explicit two-mode staging selector.
  Set it to `no` for a base same-SHA staging deployment: the build still requires
  the isolated project, dedicated guarded database, exact Git/content binding,
  immutable host, strong app-session/protection credentials, and a distinct
  `CRON_SECRET`, but the reporter and collection route remain disabled. Set it
  to `yes` only for a bounded field-INP cohort; any missing or unknown value
  blocks the staging build. The base mode keeps the hourly expiry endpoint so
  any earlier cohort data continues to receive its 48-hour purge lifecycle.
  `UAIS_STAGING_INP_COHORT_ID` identifies one bounded run and must have the form
  `p2-inp-<full 40-character candidate Git SHA>-<unique 1..16 character suffix>`.
  Cohort IDs are one-use identifiers and are never reused after purge.
- `UAIS_STAGING_INP_HMAC_SECRET` signs route attestations and pseudonymous
  evidence keys. `UAIS_STAGING_INP_HMAC_KEY_VERSION` is its non-secret rotation
  label and is bound into the attestation, cohort and sample identity. Operators
  must change the version whenever the secret changes; reusing a version for a
  different secret is invalid configuration and is not detected by the label
  alone.
  `UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES` must contain 3-20 unique approved
  adult staging account digests; raw account identifiers never enter deployment
  configuration or evidence.
- `CRON_SECRET` protects the hourly expiry purge endpoint and must contain at
  least 32 characters. Collection remains disabled unless it is present and
  distinct from the HMAC, app-session, and protection-bypass secrets.
  `P2_VERCEL_PROTECTION_BYPASS_SECRET` remains a separate deployment-access
  credential and is never reused as the purge secret.

The proxy creates a server-issued, `HttpOnly` route-attestation cookie only for
a real `GET` document navigation on the exact immutable host after validating
the app session, role, approved operator and server-classified pathname. The
cookie is also `Secure`, `SameSite=Strict`, limited to 30 minutes and capped by
the app-session expiry. The client request accepts exactly four scalar fields:
`id`, `viewportClass`, `navigationType`, and `valueMs`. The client payload cannot
supply a journey; the collection route derives the journey from the signed
attestation and the role from the current verified app session, while requiring
the attestation to bind that same role. The attestation is also bound to the
release, cohort, collector key version, operator allowlist fingerprint and
session. On collection, the signed journey must also match the current
same-origin document referrer; a second browser tab that overwrites the shared
cookie is rejected instead of relabeling the first tab's sample. The referrer is
used only for this fixed-bucket comparison and is never persisted.

The app route never creates the TTL-bound staging evidence tables. Run the
guarded lifecycle tool with `node --import tsx scripts/p2-staging-inp-rum.mjs`:
`setup` performs explicit schema creation, creates the cohort and freezes its
48-hour deadline; repeating setup cannot extend that deadline, and `persist`
never creates or reopens a cohort.
`readiness` is non-closing; `finalize` requires the exact cohort confirmation
and always attempts exact purge plus a separate raw-sample-row readback. The
purge must report `rawSampleRowsZero=true` while readback reports
`cohortTombstoneRetained=true`: raw samples are deleted, but the purged cohort
tombstone remains so its one-use run identifier cannot be silently reopened.
The only connection-local temporary tables are the canonical DDL copies used
during setup catalog comparison. The
hourly cron exists only in `vercel.staging.json`; after verifying the linked
scope/project is exactly `uais-staging`, isolated staging deployments must use
`vercel deploy --prod --project uais-staging --local-config vercel.staging.json`.
Here `--prod` means the production target of the separate staging project; it
never authorizes or targets the UAIS production project. The default
`vercel.json` contains no cron, so this repository does not register the
schedule in the production `uais` project. Expiry cleanup requires only
the isolated staging identity, staging database, immutable host, database
source guard, and `CRON_SECRET`; it continues after collection is disabled or
candidate/operator/session configuration is rotated. A 12/12 result (six
role-appropriate journeys across two viewport classes, each `n >= 30`, at least
3 distinct approved operators, and `p75 <= 200ms`) is reported only as bounded
current-SHA isolated-staging RUM. It is not production field INP evidence or
CrUX evidence.

## Operating Rule

When a deployment package adds or changes an env name:

1. Add it to `src/lib/release/env-surface.ts`.
2. Put it in exactly one tier.
3. Document the owner, purpose, value kind, and whether it is server-only.
4. Keep real values out of Git, reports, screenshots, and chat.
5. Do not move a quarantined name into `active-production` without owner/S19/S22
   approval and a redacted deployment-lane evidence note.

## Production Stop Conditions

Stop the release if:

- A secret-like value appears in a public `NEXT_PUBLIC_*` name.
- `UAIS_CORE_DATABASE_URL` is missing in a deployment lane that claims B-11/B-12
  database readiness.
- A new env name is present in `.env.local.example` but missing from the B-21
  catalog.
- A quarantined legacy env name is required to pass the core POC flow without an
  owner-approved scope expansion.
- Sentry, uptime, or auth values are present in evidence with unredacted values.
