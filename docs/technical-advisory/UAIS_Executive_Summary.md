# UAIS — Executive Summary (One Page)

**Prepared for:** Dr. Peter Hu, Founder / Project Owner
**Subject:** UAIS adaptive learning & teaching platform (proof of concept, live at www.uais.top)
**Date:** 8 July 2026 · **Classification:** Confidential

> This is the plain-language summary. The full report is `UAIS_Senior_Technical_Advisory_Report.docx`; the trackable issue list and backlog are in `UAIS_Issue_Register_and_Backlog.xlsx`.

## The situation in one paragraph

UAIS is a promising idea on a fragile foundation. The live product — a bilingual university teaching site with a course plaza, a learner playback view, a human–AI chatroom, and a teacher workspace — is small, focused, and looks credible. Underneath it sits an enormous amount of "enterprise-looking" scaffolding: roughly **66,000 lines of code, 56 API routes, 143 test files, 78 configuration settings, and a 38 KB, 25-agent coordination protocol** — wrapped around what is, in substance, a **two-course demo backed by mock data with no real database.** The core problem is not too little engineering; it is engineering aimed in the wrong direction.

## The three biggest risks

1. **No real database.** Accounts, enrolments, gradebooks, and learning records live in mock files, local JSON, and in-memory maps. On the current hosting these are not durable and not shared between server instances, so **real data can be silently lost or corrupted** as soon as people use the site. The "backup" and "restore" features are simulations.
2. **Authentication is not yet trustworthy.** The login gate accepts the mere *presence* of two cookies as "logged in" (no real check), and a shared demo password (`Phoebe / 12345`) is built into the code and appears to work in production — so **anyone with the password can act as a teacher and see student data.**
3. **The code is hard to change safely.** Several files run to thousands of lines (one is **8,153 lines**), product logic is tangled into the screens, and the tests mostly check release paperwork rather than the things students and teachers actually do.

## What to do about it (next 3 months)

| Phase | Focus | Outcome |
|---|---|---|
| **Weeks 1–2** | Stop the bleeding: fix the auth gate, disable the production demo login, secure secrets, add error + uptime monitoring | Low-risk; doesn't touch the big files |
| **Weeks 3–4** | Get organised: freeze scope & park experiments, write an onboarding runbook, add a staging environment, design the database | The project becomes legible and safe to onboard into |
| **Month 2** | Build the missing foundation: a real database (behind existing seams), one clean login model, split the two worst files | Data finally persists; auth is coherent |
| **Month 3** | Harden & expand carefully: real tests for the 5 key journeys, minimal adaptive-learning data foundation, performance & accessibility, invite a small real cohort | Ready for real users behind a checklist |

## The bottom line

**Partially refactor — do not rebuild, and do not keep piling features on as-is.** The frontend, the modern technology stack, the bilingual product, and the visual design are real assets worth keeping. The persistence and login layers must be replaced with real ones (the code already has the right "seams" to do this without disturbing the screens), the enterprise ceremony should be cut back hard, and testing should be redirected to real user journeys. Spend the next quarter on **foundations, not features.** Do that, and UAIS becomes a smaller, clearer, genuinely persistent, properly secured application that a junior developer can safely extend — and on which real adaptive-learning features can finally be built.
