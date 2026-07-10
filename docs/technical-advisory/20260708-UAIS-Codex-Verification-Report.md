# UAIS Codex Verification Report

**Date:** 2026-07-08 HKT  
**Reviewer:** Codex, S10 technical advisory verification  
**Scope:** Independent verification of `docs/technical-advisory/` materials for the UAIS proof-of-concept.

## 1. Materials reviewed

- `docs/technical-advisory/UAIS_Technical_Review.md`
- `docs/technical-advisory/UAIS_Target_Architecture.md`
- `docs/technical-advisory/UAIS_Executive_Summary.md`
- `docs/technical-advisory/UAIS_Senior_Technical_Advisory_Report.docx`
- `docs/technical-advisory/UAIS_Issue_Register_and_Backlog.xlsx`

## 2. Verification method

The review used non-destructive checks only. No feature code was edited, no Git staging or commits were performed, and no production login was attempted with shared demo credentials. Evidence sources included current source files, package/config files, local Next.js 16 documentation in `node_modules/next/dist/docs/`, DOCX/XLSX extraction, live unauthenticated HTTP/TLS checks, and project gate commands.

The repository was already dirty before this review. `npm run release:clean-check` failed because of uncommitted/untracked files, including unrelated auth/API/test changes and the advisory folder itself. This is a release-hygiene caveat for all conclusions below.

## 3. Executive verification conclusion

The existing advisory is directionally correct on the largest engineering risks: the current UAIS codebase is too large for the product surface, persistence is not backed by an implemented relational database adapter, and the auth/proxy surface is not ready for real users.

However, the advisory needed several important corrections before it could be relied on as a final technical due-diligence report:

1. The deployment URL in the assignment and the advisory do not match. `https://www.uais.top` currently serves the Vercel/Next.js UAIS login surface. `https://www.uais.site` currently presents an Apache/PHP UDAI login page and fails normal TLS verification from this environment.
2. The proxy auth bypass is not hypothetical. Current `src/proxy.ts` treats the mere presence of `uais_app_session` and `uais_app_session_signature` cookies as authenticated even when `getUaisAppSessionUserFromCookieString(...)` fails to validate a signed session.
3. The production-demo-auth claim should be stated more carefully. Source code contains local demo accounts and a production override flag, but this review did not perform a live credential login test. The safe conclusion is: production demo auth is code-supported and must be confirmed/disabled in production.
4. The "no real database" finding is verified, but the report should acknowledge the real LRS/xAPI learning-record subsystem. UAIS has an xAPI event catalog, LRS queue/query code, analytics summarizers, and LRS smoke tests. That is meaningful learning analytics plumbing, but it is not a durable relational application database or system of record.
5. The numeric surface should be updated: `src/` contains 66,068 TypeScript/TSX lines; `src/app` has 56 route handlers; `tests/` has 143 files; a broad current scan found 122 distinct env/config names across `src`, `scripts`, and `tests`.

## 4. Verified claims and corrections

| Advisory claim | Verification result | Evidence |
|---|---:|---|
| Stack is Next.js 16, React 19, TypeScript strict, Tailwind v4, Vitest, Vercel. | Verified. | `package.json` lists Next `16.2.9`, React `19.2.4`, Tailwind v4 packages, Vitest `4.1.9`, Vercel CLI, and `@vercel/analytics`. |
| `proxy.ts` is the live Next 16 request gate. | Verified. | Local Next docs state Middleware is called Proxy starting in Next 16 and the convention is `proxy.ts`. |
| Proxy can be bypassed by arbitrary app-session cookie pair. | Verified active risk. | `src/proxy.ts` computes `authenticated = Boolean(appSessionUser) || trustedTeacherSession || appSessionCookiePair`; `hasUaisAppSessionCookiePair` checks only cookie-name presence. `tests/app-proxy-auth.test.ts` currently expects this optimistic allow behavior. |
| API routes independently verify auth and ownership. | Mostly verified for core teaching routes. | `src/app/api/teaching/courses/route.ts` reads signed app/teacher sessions and filters by teacher/student ownership; `src/app/api/teaching/operations/route.ts` rejects missing teacher sessions and checks course ownership. This reduces but does not remove proxy risk. |
| No implemented managed relational DB. | Verified. | No Prisma/Drizzle/schema/migration footprint found. `src/lib/ai/storage-backend-contract.ts` marks `postgres`/`managed` as `adapterStatus: "not-implemented"` and `productionStatus: "blocked"`. |
| Persistence uses local JSON / external JSON-style storage. | Verified. | Teaching stores use `readFile`, `writeFile`, `rename`, `database.json`, per-process queues, and JSON/JSONL append/snapshot semantics. |
| Hardcoded demo accounts exist. | Verified in source. | `src/lib/server/uais-app-auth-provider.ts` defines local demo teacher/student accounts in source. The final report should not print real or shared passwords. |
| Production demo auth appears enabled. | Needs softer wording. | Code supports `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH`; this review did not test production credentials. Confirm Vercel env before stating enabled as fact. |
| No admin/operator role. | Verified in app-session RBAC. | `UaisAppRole = "teacher" | "student"`; route home/allowlist logic covers only teacher/student. LangGraph and LRS types have admin/educator/learner concepts, but app-session RBAC does not. |
| Scope sprawl / large files. | Verified. | `src/` TS/TSX total: 66,068 LOC. Largest files include `teaching-page.tsx` 8,153 LOC, `teaching-course-management-store.ts` 7,309 LOC, `teaching-operations-store.ts` 4,926 LOC, `external-storage-route-service.ts` 4,144 LOC, and `api/teaching/operations/route.ts` 4,121 LOC. |
| 56 API routes and 143 test files. | Verified. | Route handler count under `src/app`: 56. File count under `tests/`: 143. |
| 78 environment variables. | Needs update. | A broad current scan found 122 distinct env/config names across `src`, `scripts`, `tests`, and `next.config.ts`. |
| Learning analytics is aspirational only. | Needs nuance. | UAIS has LRS/xAPI modules: `xapi-events.ts`, `lrs-recorder.ts`, `lrs-analytics.ts`, LRS routes, and tests/smokes. The gap is durable product data and production binding, not absence of all analytics code. |
| `www.uais.top` is live UAIS. | Verified. | `https://www.uais.top` returns Vercel/Next.js, redirects `/` to `/login`, and serves the UAIS Chinese login page. |
| `www.uais.site` is the UAIS POC. | Not verified; likely wrong or misconfigured. | `https://www.uais.site` fails normal TLS verification here; with TLS verification disabled it serves an Apache/PHP page titled `UDAI`, not the Next.js UAIS app. |

## 5. Highest-priority findings

### P0-1. Production URL mismatch and TLS/domain confusion

The advisory and assignment should not treat `www.uais.site` and `www.uais.top` as interchangeable. From this environment on 2026-07-08, `.top` is the Vercel/Next UAIS app, while `.site` is a different Apache/PHP UDAI application and has TLS verification problems. This is a go-live blocker for any proof-of-concept communication.

**Recommended fix:** decide the canonical POC host, point DNS/TLS to the correct Vercel deployment, and update the advisory, workbook, README, privacy/terms, and screenshots to use one canonical URL.

### P0-2. Presence-only proxy authentication remains active

The middleware/proxy fallback allows protected page navigation when two app-session cookie names are merely present. Because Next docs explicitly warn not to rely on Proxy/layout/page checks alone for authorization, it is good that API routes do server-side checks; still, the UI gate must fail closed.

**Recommended fix:** remove `appSessionCookiePair` from the authenticated condition; require `appSessionUser` from a validated signature or a verified teacher-session path; invert the existing test to reject forged cookies.

### P0-3. Production demo-auth status must be confirmed, not inferred

The source supports local demo accounts and an explicit production override flag. The report is correct to treat shared demo login as unacceptable for real users, but the final wording should say production enablement is not confirmed by this review unless Vercel/env evidence is checked.

**Recommended fix:** verify Vercel env state with redacted output only; disable `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` in production; move real users to individual accounts.

### P0-4. No implemented relational system of record

The project has meaningful storage abstractions and an external storage service, but current managed/postgres modes are not implemented and local/JSON mechanisms remain central. LRS/xAPI records are useful analytics events, not a replacement for normalized application state.

**Recommended fix:** introduce managed Postgres with migrations behind the existing storage abstraction; keep LRS as the learning-event sink and analytics layer.

## 6. Gate status

| Check | Result |
|---|---|
| `git status --short --untracked-files=all` | Dirty before review. Unrelated modified `src/` and `tests/` files were present; advisory files were untracked. |
| `npm run release:clean-check` | Failed because worktree is dirty. |
| `npm run lint` | Passed. |
| `npm run test` | Failed before executing tests. Primary error: `Cannot find module './dpub/docAbstractRole'` from `@testing-library/dom` / `aria-query`; Vitest then reported worker startup timeouts/cancellations. |
| `npm run build` | Started but did not complete within the review window; stopped after a prolonged quiet `Creating an optimized production build ...` phase. Result inconclusive. |

## 7. Changes required in the advisory deliverables

The Codex clean/tracked report should:

1. Replace the production URL wording with a verified deployment note: `www.uais.top` currently hosts the Vercel/Next UAIS app; `www.uais.site` currently appears misconfigured or unrelated.
2. Keep I-02 as Critical and state it as verified active behavior.
3. Keep I-03 as Critical but revise "apparently enabled in production" to "code-supported; production environment must be confirmed; disable before real users."
4. Keep I-01 as Critical but acknowledge the LRS/xAPI analytics layer as real and separate from the missing relational system of record.
5. Update numeric surface metrics to 66,068 source TS/TSX LOC, 56 route handlers, 143 test files, and 122 env/config names by broad scan.
6. Add the current gate status and dirty-worktree caveat.
7. Add a domain/TLS/DNS item to the readiness checklist and backlog.

## 8. Final due-diligence recommendation

The final recommendation remains: partially refactor, do not rebuild, and do not continue adding features on the current foundation. The first release package should be narrower than the original roadmap suggests: fix canonical deployment, remove the proxy auth bypass, confirm/disable production demo auth, preserve API-level auth checks, and make a real database decision. Only after those are closed should UAIS invite real learners or treat learning analytics as production evidence.
