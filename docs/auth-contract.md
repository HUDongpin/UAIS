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
2. **Secret gate.** No signing secret configured → **HTTP 503**.
3. **Credentials.** Missing account/password → 400; wrong credentials → 401.
4. On success, a signed session is minted and the caller is redirected to a
   role-appropriate, **same-origin** path (`normalizeReturnPath` rejects `//`
   and non-`/` targets; `isUaisRouteAllowedForRole` re-checks the role).

`DELETE /api/auth/app-session` clears both cookies (Max-Age=0).

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
| `UAIS_APP_SESSION_SIGNING_SECRET` | Enables minting + verifying sessions | Must be set in production |
| `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` | Allows the built-in demo accounts in production | Unset (demo login blocked in prod) |
| `UAIS_APP_AUTH_PROVIDER` (+ `_URL`, `_TOKEN`) | Switches to a trusted account provider instead of local-demo | `local-demo` |
| `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET` | Enables the trusted-teacher session path in the proxy | Optional |

## Residual notes

- In **local dev** (no `UAIS_APP_SESSION_SIGNING_SECRET`), the optimistic
  cookie-pair fallback still applies, so a forged pair can reach page shells
  locally. This is intentional developer convenience and is not a production
  exposure; production always configures the secret, which disables the fallback.
- The trusted-teacher (`teacher-auth-*`) split path remains available behind its
  own signing secret and is verified (not name-trusted). Consolidating or fully
  parking it is tracked as a follow-up in the next development plan.
