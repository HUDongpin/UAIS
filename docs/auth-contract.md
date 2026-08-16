# UAIS Auth Contract

One-page description of how UAIS authenticates and authorizes the core product
surface. Written for the Phase 2 "auth consolidation & secrets hygiene" work.
Scope: the app-session login model used by `/courses`, `/learning`,
`/learning/chatroom`, `/teaching`, and `/student-dashboard`.

## Session token

- The session is a **signed, opaque token**, not a readable identity cookie.
  Claims (`account`, `role`, `displayName`, `department`, `sessionId`,
  `authenticatedAt`, `expiresAt`) are base64url-encoded and carried in
  `uais_app_session`; an HMAC-SHA256 signature is carried in
  `uais_app_session_signature`.
  See `src/lib/server/uais-app-session.ts`.
- Verification (`readUaisAppSessionClaimsFromCookieValues`) requires: a
  configured secret, both cookies present, a **constant-time** signature match
  (`timingSafeEqual`), and a non-expired `expiresAt`. Any failure → `null`
  (treated as unauthenticated).
- Cookies are set `HttpOnly; SameSite=Lax; Path=/; Priority=High`, and `Secure`
  in production. TTL is 8 hours.

## Signing secret

- `resolveUaisAppSessionSigningSecret(env)` returns `UAIS_APP_SESSION_SIGNING_SECRET`
  when configured. In a **non-deployed** runtime only, it falls back to a
  development-only secret. In a **deployed** runtime (production / preview /
  staging) with no secret configured, it returns `undefined` — so no session can
  be minted or verified until the owner configures the real secret.
- **Minimum length: 32 characters in a deployed runtime.** A shorter value is
  refused exactly as an absent one is (`undefined` → no session), the same floor
  `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET` enforces. `scripts/app-auth-provider-readiness.mjs`
  has always *graded* anything shorter as `weak` and blocked the release on it;
  the runtime now refuses the same values, so a deployment that skipped the gate
  can no longer sign a cohort's sessions with a hand-typed key. A local runtime
  is unaffected — a short secret there signs cookies nobody else can reach.
- `classifyUaisAppSessionSigningSecret(env)` reports the same decision as
  `configured` / `development-fallback` / `missing` / `weak`, with the length
  floor and **never the value**. The login route returns it under
  `appSessionSigningSecret` on the 503, because "not configured" for a variable
  that is plainly set sends the owner looking in the wrong place.
- The secret is server-only. It must never be exposed via a `NEXT_PUBLIC_`
  variable, logs, reports, or screenshots.

## Login (`POST /api/auth/app-session`)

Enforced in order; each failure returns before any session is minted:

1. **Provider gate.** `resolveUaisAppAuthProviderContract` must report
   `productionStatus: "ready"`. With the default `local-demo` provider in a
   production runtime this is **`blocked` (HTTP 503)** unless the owner opts in
   with `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH`. This is what keeps the built-in
   demo accounts (`Phoebe`/`Peter`, password `12345`) from working in production
   by default.
2. **Secret gate.** No signing secret configured, or one below the 32-character
   floor in a deployed runtime → **HTTP 503**, with `appSessionSigningSecret.status`
   naming which of the two it was.
3. **Credentials.** Missing account/password → 400; wrong credentials → 401.
4. On success, a signed session is minted and the caller is redirected to a
   role-appropriate, **same-origin** path (`normalizeReturnPath` rejects `//`
   and non-`/` targets; `isUaisRouteAllowedForRole` re-checks the role).

`DELETE /api/auth/app-session` clears both cookies (Max-Age=0).

## Account provisioning and password reset

With `UAIS_APP_AUTH_PROVIDER=database-accounts`, the account universe is the
`uais_users` rows on the core database. Two operator scripts own its lifecycle;
they share `scripts/lib/uais-account-provisioning.mjs`, so the scrypt parameters,
the password encoding, the account charset, the minimum password length, the
database-URL source and the 0600 credential file have exactly one definition. A
second copy of the hasher would be silent in the worst way — the seeded password
would verify as a *wrong* password.

**Create (roster import).**

```bash
node -- scripts/seed-uais-accounts.mjs --roster ./roster.csv --out ./credentials.csv \
  [--env-file ./deployment.env] [--dry-run]
```

- `INSERT ... ON CONFLICT (account) DO NOTHING`: re-running can never reset a
  password a student has already changed. It therefore **cannot** repair one
  either — that is the reset script below.
- A roster `password` column shorter than **8 characters** is rejected with
  `password-shorter-than-minimum` and never seeded. A one-character placeholder
  used to seed verbatim, and `DO NOTHING` then made a second run unable to
  correct it.
- `--env-file` loads `KEY=VALUE` lines (`#` comments and blanks skipped, one
  matching pair of surrounding quotes stripped) and **wins over** the ambient
  environment. `--dry-run` reports `coreDatabase: "configured" | "missing"`
  without opening a connection, which is how an operator checks that the file
  pointed at the deployment they meant.

**Reset one password.**

```bash
node -- scripts/reset-uais-account-password.mjs \
  --account s2026001 --confirm s2026001 --out ./credential.csv [--env-file ./deployment.env]
```

- `--account` selects (an account **or** a registered email address, lower-cased
  to match the stored key); `--confirm` must repeat it exactly. A reset is not
  reversible, so the account is named twice.
- The new password is generated unless `--password` is given, is refused below 8
  characters, and is written **only** to the `--out` file (mode 0600). A
  generated password with no `--out` is refused rather than lost. `--password`
  is the weaker channel: a value on the command line lands in shell history and
  in the process table.
- It clears the account's rows in `uais_app_login_failures` — for the account
  **and** every address registered to it, because the lockout is keyed on the
  identifier the caller *submitted*. Clearing only the account would leave a
  student holding a brand-new password that still appears not to work.
- It changes `password_hash` and nothing else: it never creates an account,
  never re-activates a disabled or `invited` one (that case is reported as
  `account-not-active-sign-in-still-blocked`), and never edits login identifiers.
- Neither script ever prints a password, an account, or the database URL to
  stdout. Summaries carry statuses and counts only.

## Navigation gate (`src/proxy.ts`)

The proxy is a **navigation** gate (redirect unauthenticated users to `/login`,
redirect wrong-role users to their home). It is defense-in-depth, not the
authorization boundary — data-bearing routes verify the signed session
server-side independently.

- A request is treated as authenticated if it carries a **verified** app
  session (`appSessionUser`) or a **verified** trusted-teacher session.
- The unverified **cookie-pair presence** is only an *optimistic* fallback for
  the case where the proxy genuinely cannot verify a signature — i.e. no
  `UAIS_APP_SESSION_SIGNING_SECRET` is configured in its runtime. When a secret
  **is** configured (every production deployment), a forged/unverified cookie
  pair does **not** pass the gate. See the `appSessionSecretConfigured` guard in
  `proxy()` and the regression test in `tests/app-proxy-auth.test.ts`
  ("rejects a forged app-session cookie pair once a signing secret is configured").
- Role routing uses `isUaisRouteAllowedForRole`: `/courses` and `/learning` are
  common; `/teaching` is teacher/admin only; `/student-dashboard` is student
  only. Exact-prefix matching rejects lookalikes (e.g. `/coursesX`).

## Owner-controlled production switches

| Variable | Effect | Default posture |
| --- | --- | --- |
| `UAIS_APP_SESSION_SIGNING_SECRET` | Enables minting + verifying sessions | Must be set in production, ≥ 32 characters |
| `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` | Allows the built-in demo accounts in production | Unset (demo login blocked in prod) |
| `UAIS_APP_AUTH_PROVIDER` (+ `_URL`, `_TOKEN`) | Selects the account universe. `database-accounts` is the launch selector and authenticates against the `uais_users` rows on the core database, reading neither `_URL` nor `_TOKEN`; `trusted-account-provider` is the remaining future option and needs both | `local-demo`, which is refused in a production runtime |
| `UAIS_TEACHER_AUTH_PROVIDER` | Selects the teacher session provider. `database-account-cookie` is the launch selector: it mints the teacher cookie at login for an account the app provider already verified as `role=teacher`, so it needs no issuer URL and no second service. `trusted-cookie-issuer` and `oidc-jwks` remain future options | Unset, which blocks the teacher surface outright; `local-signed-cookie` is refused in production |
| `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET` | Signs the teacher session cookie — the only secret `database-account-cookie` needs. Also enables the trusted-teacher session path in the proxy | Must be set (≥ 32 characters) wherever teachers write; without it every teacher write answers 401 |

## Residual notes

- In **local dev** (no `UAIS_APP_SESSION_SIGNING_SECRET`), the optimistic
  cookie-pair fallback still applies, so a forged pair can reach page shells
  locally. This is intentional developer convenience and is not a production
  exposure; production always configures the secret, which disables the fallback.
- The trusted-teacher (`teacher-auth-*`) split path remains available behind its
  own signing secret and is verified (not name-trusted). Consolidating or fully
  parking it is tracked as a follow-up in the next development plan.
