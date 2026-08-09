# Decision — Non-Production Teacher-Auth Login Bridge

- Date: 2026-08-09
- Decision owner: delegated to the implementing session by Dr. Peter Hu ("the S12 teacher-auth decision is yours to make")
- Workstream: S12 (backend/API auth contracts), with S11 coordination for the added tests
- Supersedes the open item in `coordination/reports/2026-08-09-learning-teaching-readiness-and-first-fixes.md` §3.1
- Status: **Decided and implemented.** Production behaviour is unchanged and pinned by tests.

---

## 1. The problem

Every teaching WRITE route — create course, create class, create/edit group, approve membership, `POST /api/teaching/operations`, the audit readback, course-cover — resolves its actor from the HMAC-signed teacher cookie pair (`uais_teacher_auth_claims` / `uais_teacher_auth_signature`) and nothing else. `/login` issues only the app-session cookie, which exactly one endpoint accepts (`GET /api/teaching/courses`, via its `readAuthenticatedAppSessionTeacher` fallback).

The only mint path, `POST /api/ai/teacher-auth/issue`, requires trusted-issuer proof headers or an OIDC bearer token, and no client component calls it. A teacher who signed in through the UI could therefore list courses and then failed 401 on every write — in local development as much as in production. `/teaching` was, in practice, read-only for everyone.

## 2. Decision

**Bridge the app-session login to a signed teacher session in local runtimes only, with no development fallback for the signing secret.**

Production keeps exactly one story: `trusted-cookie-issuer` or `oidc-jwks` mint teacher sessions, `issue-live-teacher-auth-cookie` remains owner-gated, and `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET` stays a quarantined-legacy name that production is not expected to set.

### 2.1 The rejected alternative, and why

The obvious implementation — mirroring `resolveUaisAppSessionSigningSecret`, i.e. a committed development fallback constant for the teacher secret shared by the mint and all ~20 verification sites — was **rejected on security grounds**, despite being the smaller and more symmetric change.

The teacher claims carry no issuer, audience, environment or deployment fingerprint; verification is a bare HMAC over the claims plus an expiry check. A committed fallback constant would therefore be a **published forgery key for teacher writes** on any host where none of `NODE_ENV`, `VERCEL_ENV` or `UAIS_DEPLOYMENT_ENV` is set to a recognised value — a marker-free self-hosted or containerised deploy, which this repo already ships a Dockerfile for. The app-session secret has that hole today; extending it to the credential that authorizes teaching writes materially widens it, and does so precisely where the blast radius is largest.

So: **no fallback constant.** If `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET` is unset, the bridge mints nothing and the login response says so by name. The cost is one line in `.env.local`; the benefit is that no committed value can ever verify a teacher cookie anywhere.

### 2.2 Guards

1. **Runtime gate is `isUaisAppDeployedRuntime`, not `isUaisAppProductionRuntime`.** The narrower predicate returns false for a Vercel *preview* build and for a self-hosted box that sets only `UAIS_DEPLOYMENT_ENV=staging`. The deployed predicate is the same one that already gates the app-session dev secret, so the bridge cannot mint anywhere a deployment exists.
2. **Provider must be `local-demo`.** A trusted-account provider may be plain-http on loopback in dev and can assert any role it likes; gating on the hard-coded demo table stops it becoming an unaudited teacher-minting oracle.
3. **Role must be `teacher`.** `admin` does not bridge — the claims type hard-codes `role: "teacher"` — even though admin shares the teacher landing route.
4. **Actor id must pass the narrowest downstream pattern** (`/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`, ≤120). The cookie module itself also accepts `@`, so an email-style account would otherwise mint a structurally valid session that every write route silently discards — the same 401 the bridge exists to remove.
5. **Lifetime is the app session's, verbatim.** `authenticatedAt`/`expiresAt` are copied from the app-session claims and the same `Max-Age` is used, so the write credential can neither outlive the session that authorized it nor strand a teacher mid-workflow.
6. **Sign-out clears both pairs.** `DELETE /api/auth/app-session` now emits `Max-Age=0` for the teacher cookies unconditionally. Without this, a signed-out browser kept standing write authority for the full TTL, and `src/proxy.ts` would keep treating that visitor as an authenticated teacher.
7. **Account switch clears a stale teacher cookie.** A successful non-bridging login emits the clears — but only when the request actually presents a teacher cookie, so an ordinary sign-in returns exactly the cookie set it always did.

## 3. What was implemented

| File | Change |
| --- | --- |
| `src/lib/server/local-teacher-auth-bridge.ts` | New. All gate logic, the mint call, the clear-header builder, and the stale-cookie detector, with the reasoning inline. |
| `src/app/api/auth/app-session/route.ts` | Calls the bridge after the app-session cookies are built; appends bridged and stale-clear headers; adds a value-free `localTeacherAuthBridge` diagnostic to the response body; clears teacher cookies on `DELETE`. |
| `tests/uais-app-session.test.ts` | +5 cases (see §5). |
| `tests/critical-user-flows-backend.test.ts` | +1 end-to-end case. |

No changes to `src/proxy.ts`, to any teaching route, to `teacher-auth-provider-contract.ts`, to the env-surface catalog, or to any owner-decision packet or evidence script. The existing source-shape regressions (`const isProductionRuntime = isUaisAppProductionRuntime(env)`, `secure: isProductionRuntime`, the single-reader shape and call order of every write route) are untouched.

**Note on the owner-decision machinery.** The existing packet (`decisionId: teacher-auth-provider-production-selector`) has `allowedProviderModes` of exactly `trusted-cookie-issuer` and `oidc-jwks`; a non-production bridge cannot be encoded there and would be rejected as `ownerApprovedProviderMode-not-allowed`. This narrative report is therefore the decision record. Nothing here changes the production selector question, which remains open and owner-owned.

## 4. How to use it locally

Set one variable in `.env.local` (any value; ≥32 characters is the convention used elsewhere):

```bash
UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=<choose a local-only value>
```

Then `npm run dev`, sign in as the demo teacher, and `/teaching` writes work: create a course, and the ownership record is merged automatically as a side effect of course creation, which in turn unblocks the operation routes for that course.

If writes still 401, the login response's `localTeacherAuthBridge.status` names the reason — `skipped-signing-secret-not-configured` is the usual one, and no secret value is ever serialized.

## 5. Evidence

All gates run after the change:

| Gate | Result |
| --- | --- |
| `npm run lint` | Pass (exit 0) |
| `npx tsc --noEmit` | Pass (exit 0) |
| `npm run test` | **2304 passed**, 5 skipped (was 2298 — +6 new cases) |
| `npm run build` | Compiled successfully, 23/23 static pages |

New regressions, chosen to prove the production-unchanged claim rather than just the happy path:

1. **Deployed runtimes mint nothing** — eight runtime shapes (`VERCEL_ENV=production`, `NODE_ENV=production`, `UAIS_DEPLOYMENT_ENV=production`, `VERCEL_ENV=preview`, `UAIS_DEPLOYMENT_ENV=preview`, `=staging`, a preview built as production, and the `local-production` lane) each assert exactly 2 Set-Cookie headers, no teacher cookie name, the unchanged `cookieNames` body field, and — decisively — that the verifier returns `undefined` even when handed the very secret the bridge would have used.
2. **Anti-fallback** — a dev login with the secret unset emits exactly 2 cookies and reports `skipped-signing-secret-not-configured`. This test fails if anyone reintroduces a built-in constant.
3. **Dev happy path** — 4 cookies; the teacher session verifies; `actorId === "Phoebe"`; `expiresAt` is byte-identical to the app session's.
4. **Student login** — 2 cookies, `skipped-non-teacher-role`; and with a stale teacher cookie presented, the clears are emitted and the session no longer verifies.
5. **Sign-out** — 4 `Max-Age=0` cookies covering both pairs.
6. **End to end** — a UI login's own cookie jar, with no hand-built credential anywhere in the test, reaches `POST /api/teaching/courses` for a 201, with ownership merged under `Phoebe`.

## 6. Residual risks and what was deliberately left undone

- **Static demo courses remain non-operable.** `teacher-research-methods` and `teacher-math-pedagogy` exist only in `src/data/uais.ts` and are never written to the course-management store, so no ownership record covers them. The investigated fix — a read-only auto-grant inside `createLocalUaisTeacherAiOwnershipAdapter` — was rejected for now because it needs a new env name (catalog plus `.env.local.example` churn) and grants ownership of course ids that have no row, which 404s as soon as course-management persistence is configured. The real flow self-heals: create a course through the UI and every operation on it works. Revisit only if the demo fixtures need to be operable.
- **Cross-environment replay is unmitigated by design.** The teacher cookie has no environment binding, so if an operator copies the *same* secret string into both `.env.local` and a deployed environment, a dev-minted cookie would verify there. Adding an `issuer` claim rejected in deployed runtimes would close this; it was not implemented because it changes the shared verifier that the production issue-route chain also uses, which is a larger contract change than this decision should carry. Mitigation is operational: use a distinct local-only value.
- **`scripts/core-journey-smoke.mjs` will not exercise the bridge** — `extractSessionCookies` keeps only the two app-session names, so any teaching write it attempts would still 401. Widening it to forward all cookies is S22-owned tooling work.
- **`src/proxy.ts` is unchanged**, so navigation gating still keys off the app session in dev exactly as before.

## 7. Follow-ups for other sessions

1. **S22** — widen `core-journey-smoke.mjs` cookie forwarding if the smoke should cover teaching writes.
2. **S19/S22** — the production selector decision (`trusted-cookie-issuer` vs `oidc-jwks`) is untouched and still owner-gated; this bridge neither answers nor prejudges it.
3. **S12** — if the demo fixtures must be operable, revisit the ownership auto-grant with an explicit env opt-in.
