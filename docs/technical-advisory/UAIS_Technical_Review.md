# UAIS — Senior Technical Advisory & Recovery Review

**Prepared for:** Dr. Peter Hu (Founder), the junior developer maintaining UAIS, future engineers, and product stakeholders.
**Subject:** UAIS — adaptive learning & teaching platform, proof of concept, live at www.uais.top.
**Stack reviewed:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind v4, Vitest, Vercel.
**Review type:** static senior-level code, architecture, security, and process review.
**Date:** 8 July 2026 · **Classification:** Confidential.

> This markdown is the version-controllable copy of the review. The formatted report is `UAIS_Senior_Technical_Advisory_Report.docx`; the trackable issues, backlog, roadmap, and checklist are in `UAIS_Issue_Register_and_Backlog.xlsx`; the one-pager is `UAIS_Executive_Summary.md`; the target design is `UAIS_Target_Architecture.md`.

---

## A. Executive summary

UAIS is a promising idea on a fragile foundation. The live product — a bilingual university teaching site (course plaza, learner playback, human–AI chatroom, teacher workspace) — is small, focused, and credible-looking. Underneath it is **~66,000 lines of TypeScript, 56 API routes, 143 test files, 78 environment variables, and a 38 KB, 25-agent coordination protocol** wrapped around what is in substance a **two-course demo backed by mock data with no real database.**

The central finding is that effort was **misallocated**: over-built in ceremony (audit endpoints, "evidence gates," restore-drills, retention-readiness, release protocols) and under-built where it counts (a real database, real authentication, a maintainable core). This is dangerous because it looks production-ready while the fundamentals that protect real users and data are missing.

**Three biggest risks:** (1) no durable database, so real data can be silently lost/corrupted; (2) authentication that does not actually authenticate, plus shared demo credentials apparently live in production; (3) a codebase that is hard to change safely (8,153-line file, UI/logic entanglement, tests aimed at ceremony not user flows).

**Bottom line:** partially refactor. Keep the frontend and stack; replace persistence and auth with real ones behind the abstractions that already exist; cut the ceremony; redirect testing to real journeys. Spend the next quarter on foundations, not features.

---

## B. Current system assessment

**Architecture.** One Next.js 16 App Router app (React 19, TS strict, Tailwind v4) on Vercel, bilingual with Simplified Chinese default. Routing, pages, and API endpoints all live in `src/app`; shared code in `src/data`, `src/i18n`, `src/lib`, `src/components`. This modern baseline is a genuine strength. Request protection is `src/proxy.ts` (in Next 16 the `middleware.ts` convention was renamed to `proxy.ts`, so this file is the live edge gate). **Two** auth mechanisms coexist: a signed HMAC "app session" cookie and a separate "teacher OIDC" cookie chain.

**Persistence is the weak point.** No relational database, ORM, or migrations. Domain data starts as a 553-line mock (`src/data/uais.ts`); server "stores" persist to local JSON directories and serialize writes with in-process `Map`s. An optional "external storage" HTTP backend exists but may be unconfigured in production. A large family of endpoints simulates enterprise durability (backups, restore-drills, lifecycle audits, retention-readiness) without a real datastore beneath.

**Development maturity.** Fingerprints of rapid AI-assisted ("vibe") coding by a junior developer: very verbose auto-generated identifiers, parallel/overlapping layers (a "store", an "external-store", and a "route-service" for the same concern), and much aspirational/ceremonial code. `AGENTS.md` describes a 25-agent nightly-meeting protocol — impressive as an artifact, far heavier than a 1–2 person team needs. Tooling is modern and mostly healthy. The problem is **proportion, not absence**: the machinery dwarfs the product.

**Genuinely good:** modern supported stack; clean central bilingual i18n; sensible module boundaries and a storage-contract abstraction (the exact seam needed to add a real DB without rewriting pages); API routes that already do their own signed-session + ownership checks; a working, presentable live site.

**Concerning:** no durable data layer; an auth gate that doesn't authenticate + shared demo creds apparently in prod; God-files and UI/logic entanglement; testing/process aimed at ceremony; a config/scope surface far larger than a POC can justify.

---

## C. Major issues (ranked)

Severity = impact on users/data. Priority = window in the 3-month plan. Full detail (evidence, why, risk, fix, effort, owner) is in the DOCX report and the workbook's **Issue Register** tab.

| ID | Issue | Severity | Effort | Owner | Priority |
|---|---|---|---|---|---|
| I-01 | No real database — data in mock files, JSON, in-memory maps | **Critical** | Large | Senior | Month 1–2 |
| I-02 | Login gate bypassable with two arbitrary cookies (`proxy.ts`) | **Critical** | Small | Senior | Weeks 1–2 |
| I-03 | Demo creds hardcoded & apparently enabled in production | **Critical** | Medium | Senior | Weeks 1–2 |
| I-04 | God-files up to 8,153 lines | High | Large | Senior + junior | Month 2 |
| I-05 | Scope sprawl — enterprise ceremony around a tiny product | High | Medium | Senior + product | Weeks 3–4 |
| I-06 | Two overlapping authentication systems | High | Medium | Senior | Month 2 |
| I-07 | No admin role; RBAC only teacher/student | Medium | Small–Med | Senior | Month 2 |
| I-08 | Business logic entangled with UI in page components | High | Large | Senior + junior | Month 2–3 |
| I-09 | Tests aimed at release/audit ceremony, not user flows | High | Medium | Junior | Weeks 3–4 → M3 |
| I-10 | No error tracking / structured logging / uptime monitoring | High | Small | DevOps | Weeks 1–2 |
| I-11 | Hardcoded dev signing secret; loose key files | High | Small | DevOps/owner | Weeks 1–2 |
| I-12 | No staging/preview separation — prod is the only env | High | Small–Med | DevOps | Weeks 3–4 |
| I-13 | File/JSON persistence + per-process queues don't scale | High | Large | Senior | Month 2 |
| I-14 | Large client bundles from huge client components | Medium | Medium | Junior + senior | Month 3 |
| I-15 | Adaptive learning aspirational, not wired to real data | High | Large | Senior | Month 3 |
| I-16 | API surface undocumented; validation uneven | Medium | Medium | Senior | Month 2 |
| I-17 | Docs not matched to a small team; onboarding runbook missing | Medium | Small | Senior/junior | Weeks 3–4 |
| I-18 | No simple rollback runbook; build artifacts committed | Medium | Small | DevOps | Weeks 1–2 |

### The three Critical issues, in brief

- **I-01 No real database.** `src/data/uais.ts` is mock; stores write to local JSON dirs and coordinate with per-process `new Map()` queues. Vercel's serverless filesystem is ephemeral and not shared across instances → unreliable persistence; "backups/restore-drills" are simulations. **Fix:** managed Postgres + ORM + migrations behind the existing storage-contract abstraction.
- **I-02 Auth gate bypass.** `proxy.ts`: `authenticated = Boolean(appSessionUser) || trustedTeacherSession || appSessionCookiePair`, and `hasUaisAppSessionCookiePair()` only checks the two cookie **names** are non-empty — no signature check. Two junk cookies pass the gate. Mitigant: API routes verify signed sessions + ownership independently, so today this is primarily a UI-gate/defense-in-depth failure. **Fix:** remove the presence-only fallback; require a validated signature; add a test.
- **I-03 Demo creds in prod.** `uais-app-auth-provider.ts` hardcodes `Phoebe/12345` (teacher) and `Peter/12345` (student); the live login accepts them, implying `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` is on. Anyone with the shared password acts as a teacher and sees student data. **Fix:** disable prod demo auth; issue individual hashed-password accounts via a real provider; rotate secrets.

---

## D. 3-month recovery roadmap

**Weeks 1–2 — Stabilization & risk reduction** (low-risk; doesn't touch product code)
Fix the auth bypass (B-01); disable prod demo auth (B-02); require a real session secret / fail closed (B-03); rotate secrets & remove key files (B-04); add Sentry + `/healthz` + uptime (B-05); write the rollback runbook (B-06).
*Done when:* a forged cookie pair can't reach protected pages; `Phoebe/12345` fails in prod; errors/outages alert within minutes; rollback takes < 2 minutes.

**Weeks 3–4 — Architecture cleanup & documentation**
Declare core scope; quarantine experiments (B-07); write CONTRIBUTING + architecture map, shrink AGENTS.md (B-08); stand up staging + preview envs (B-09); design the schema (B-10); start the critical-flow tests (B-16).
*Done when:* a new dev can run UAIS from the docs; in-scope vs parked is documented; PRs get preview URLs; a reviewed schema exists.

**Month 2 — Core refactoring & feature foundation**
Postgres + ORM + migrations behind the storage-contract (B-11); migrate core entities off file/JSON (B-12); one session model + admin role (B-13); split the two most-changed God-files (B-14); standardize API validation + API.md (B-15); privacy baseline (B-22).
*Done when:* core data survives redeploys and concurrent writes; one cookie governs access with roles enforced; refactored files under budget with tests green.

**Month 3 — Hardening, testing & controlled expansion**
Finish critical-flow tests as CI gate (B-16); persist learner profiles/events (B-17); minimal deterministic recommendation service (B-18); performance + accessibility passes (B-19/B-20); shrink env surface (B-21).
*Done when:* CI blocks journey-breaking merges; per-student progress is queryable; a reproducible next-step recommendation exists; a small invited cohort uses UAIS behind the readiness checklist.

---

## E. Recommended target architecture

Full details and diagrams: `UAIS_Target_Architecture.md`. In short: keep the Next.js frontend (thin client components); **one** signed-session auth model with roles `student/teacher/admin` and signature verification in middleware; a small service layer with shared `zod` validation; **managed Postgres** (Neon/Supabase/Vercel Postgres) + Prisma/Drizzle + migrations, introduced behind the existing storage-contract; LLM providers behind the existing interface for **generation only**, with a **deterministic** recommendation service over persisted learner data; Sentry + logs + uptime + `/healthz`; Vercel Preview → Staging → Production lanes; experimental modules quarantined. Minimal entities: `users, courses, lessons, enrollments, assessments, submissions, learning_events (xAPI-shaped), learner_profiles, recommendations`. This is deliberately **not** an enterprise architecture.

---

## F. Refactoring strategy

**Refactor first (in order):** (1) safety-critical, low-risk work that avoids the big UI files — auth gate, secrets, observability; (2) the persistence layer, introduced **behind the existing storage-contract** so pages don't change; (3) auth consolidation to one model + roles; (4) the two God-files that change most, split into components + services, guarded by the new critical-flow tests.

**Leave alone (for now):** stable-but-verbose code off the critical path (ugliness alone isn't a reason to touch it); the aspirational modules (voice-clone, PPT-narration, enterprise audit/evidence) — quarantine under `experimental/`, don't invest; the bilingual i18n and visual design, which work well.

**Don't break the live site:** work on branches with Preview deploys; validate on staging; migrate data with **expand → migrate → contract** (keep the old path until parity is proven); put risky changes behind feature flags; land critical-flow tests before big refactors; never mix a refactor with a behavior change in one PR.

---

## G. Minimum production-readiness checklist

Clear every item before inviting real users (especially minors). Trackable version with backlog refs is in the workbook's **Readiness Checklist** tab.

- **Security:** middleware requires a verified signed session; prod demo auth off, individual hashed-password accounts; session secret required in every deployed env (fail closed); secrets in a manager, no key files in the repo, keys rotated; roles enforced in middleware and API.
- **Data:** core data in a managed DB with migrations (redeploy- and concurrency-safe); a real tested backup/restore; documented data-handling (collected, stored, retained, deletable).
- **Deployment:** separate Preview/Staging/Production with isolated data/secrets; clean reproducible `npm run build` in CI; build artifacts out of version control; documented, timed rollback.
- **Testing:** automated tests for the five critical journeys as the CI merge gate.
- **Monitoring:** Sentry + external uptime with alerting; a health endpoint and basic structured logs.
- **Documentation:** CONTRIBUTING.md + a one-page architecture map; a short API.md for core routes; env vars documented.
- **User experience:** visible loading/error states and labelled forms on every core screen; responsive and acceptable on classroom Wi-Fi/mobile.
- **Privacy:** login/terms/privacy copy matches actual processing; consent is meaningful.

---

## H. Suggested backlog

22 assignable tickets (B-01 … B-22) with descriptions, acceptance criteria, priority, phase, owner, and the issue each addresses are in the workbook's **Backlog** tab and Section H of the DOCX. Priorities: **P0** = do first/blocker (B-01…B-05), **P1** = high, **P2** = important but later.

---

## I. Risks, assumptions & open questions

**Assumptions (not verified in a static review):** production demo auth is enabled (inferred from the shared `Phoebe/12345` and the live login; the site was **not** exploited to confirm); hosting is Vercel serverless; file/JSON stores are the active production persistence (if a real external storage service is connected, I-01/I-13 severity drops — **confirm this first**); build/test/lint were not run here.

**Open questions for the owner:** Is any real database/external storage connected in production today? How many users, by when, and any minors? Is uais.top a reusable template or a single product? Which AI providers are approved for production (cost/rate limits)? What compliance/residency rules apply (China PIPL; GDPR for international students)? Keep or retire the 25-agent workflow?

**Residual risks even after the plan:** a small team carrying both product and platform work (slower features in Months 1–2); data migration always carries some risk (mitigated by expand/contract + staging); AI provider behavior/cost can change (keep the interface thin, AI out of the system-of-record).

---

## J. Final recommendation

**Partially refactor.** Do **not** rebuild from scratch — the frontend, stack, bilingual product, design, and existing abstractions are real assets, and a rewrite resets the clock for no good reason. Do **not** keep extending the current codebase as-is — building on ephemeral storage, an auth gate that doesn't authenticate, and 8,000-line files compounds risk and debt.

The middle path: over three months, (1) fix and consolidate authentication; (2) replace file/JSON persistence with a real managed database behind the existing storage abstraction so the UI is undisturbed; (3) aggressively cut or quarantine the enterprise ceremony; and (4) redirect testing to the few journeys students and teachers actually use. Split the two God-files that change most; leave the rest until they need changing. Sequenced as in Section D — stabilize, organize, rebuild the foundation, harden — this keeps the live POC running throughout while making it safe to change. By quarter's end UAIS should be a smaller, clearer, genuinely persistent, properly authenticated application a junior developer can extend with confidence — and on which real adaptive-learning features can finally be built.
