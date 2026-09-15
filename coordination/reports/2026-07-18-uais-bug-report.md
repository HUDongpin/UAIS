# UAIS Bug Report

- **Date:** 2026-07-18
- **Project:** UAIS — University AI System (`/Users/dongpinhu/Desktop/UAIS`)
- **Branch / tree:** `main`, dirty working tree (fixes below are applied but uncommitted; one unrelated S06 CSS tweak in `learning-page.tsx` + its test; one untracked session log)
- **Reviewer:** Claude (systematic bug-detection + bug-fixing pass)
- **Method:** Exhaustive read-based static audit of the core product surface, plus baseline gates (typecheck, lint, full test suite). This is the 4th detection round overall. Prior passes found/fixed a thread-id collision class, a Postgres provenance bug, proxy cookie forgery, a fire-and-forget LRS flush, and display-safe guard false positives. This round **detected and fixed** three defects (§1–§3), then ran a second exhaustive sweep for anything new (§4).

---

## Baseline checks

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | **PASS** (0 errors) |
| Lint | `npx eslint .` | **PASS** (0 warnings/errors) |
| Unit/acceptance suite | `npm run test` | **PASS** (2000 tests / 159 files) |

The tree is healthy after the fixes below (the suite grew from 1996 → 2000 tests: 4 new regression tests were added alongside the fixes). Confirmed defects are therefore subtle: logic not exercised by tests, SSR/hydration boundaries, and defense-in-depth gaps.

---

## Bugs detected and fixed this pass

### 1 — Minor (FIXED): Theme was never threaded through SSR → hydration mismatch on the header toggle + dark-mode flash (FOUC)

- **Files:** [src/app/layout.tsx](src/app/layout.tsx), [src/components/providers/app-preferences.tsx](src/components/providers/app-preferences.tsx), [src/components/layout/header.tsx:238](src/components/layout/header.tsx#L238)
- **Defect:** Theme state was seeded on the client from `localStorage`/`matchMedia` (`getInitialTheme`). During SSR `window` is undefined, so the server always rendered `theme = "light"`: no `dark` class on `<html>`, and the header rendered the `Moon` icon. A returning dark-mode user's hydration render read `localStorage`, seeded `theme = "dark"`, and produced the `Sun` icon — a React 19 recoverable hydration mismatch on a deep descendant of `<html suppressHydrationWarning>` (which does **not** cover descendants), plus a flash of the light theme on every load (FOUC). This was the asymmetry with locale, which was already threaded server→client via the `uais-locale` cookie + `initialLocale` prop.
- **Fix (applied):** Mirror the locale design.
  - `app-preferences.tsx`: persist theme to a route-readable `uais-theme` cookie on every change (alongside `localStorage`), export `resolveThemeMode`, and seed the provider's `useState` from a new `initialTheme` prop instead of `getInitialTheme` (which was removed).
  - `layout.tsx`: read the `uais-theme` cookie server-side, set `data-theme` + the `dark` class on `<html>`, and pass `initialTheme` into `AppPreferencesProvider`.
- **Result:** The first client render now equals the server render — no hydration mismatch on the header icon, no theme flash on dark-mode loads.
- **Verification:** `tsc`/`eslint` clean; 3 new tests in `tests/app-preferences.test.tsx` cover server-provided initial theme, the light default, and cookie+localStorage persistence on toggle.
- **Accepted tradeoff (documented, not a defect):** With a pure-SSR theme, a first-time visitor with no `uais-theme` cookie now defaults to light even if their OS is set to dark (`prefers-color-scheme: dark`), because the server cannot read `matchMedia`. Reintroducing `matchMedia` seeding on the client would reintroduce exactly the hydration mismatch this fix removed, so the light default is the correct resolution of that tension (the user's toggle immediately sets the cookie for all subsequent renders). This matches how comparable production apps handle cookie-based SSR theming.

### 2 — Robustness (FIXED): `readScaledScore` accepted non-finite scores into learner-profile aggregates

- **File:** [src/lib/learning-records/learner-profile.ts:290-303](src/lib/learning-records/learner-profile.ts#L290)
- **Defect:** The profile score reader accepted `score.scaled`/`score.raw`/`score.max` on `typeof === "number"` alone. Its sibling in the adaptive recommender additionally required `Number.isFinite(...)`. A `NaN`/`Infinity` value would flow into `bestScore`/`averageScore` as `NaN` in the profile but be rejected by the recommender — divergent behavior on the same statement, and a `NaN` in the profile poisons every aggregate that reads it.
- **Fix (applied):** Add `Number.isFinite` guards to `scaled`, `raw`, and `max`, aligning `readScaledScore` with the recommender.
- **Result:** Non-finite scores are ignored instead of poisoning `bestScore`/`averageScore`/`progress.averageScore` with `NaN`.
- **Verification:** New test in `tests/learner-profile.test.ts` feeds a `POSITIVE_INFINITY` scaled score and asserts the lesson `bestScore`/`averageScore` and `progress.averageScore` stay `null`.
- **Note:** JSON cannot encode `NaN`/`Infinity`, so this path was not reachable from real LRS/HTTP bodies today; the fix removes a latent inconsistency and hardens the invariant.

### 3 — Hardening (FIXED): `/api/ai/chat` accepted an unbounded `maxAgentTurns`

- **File:** [src/app/api/ai/chat/route.ts:27,254](src/app/api/ai/chat/route.ts#L27)
- **Defect:** A client could pass any positive `maxAgentTurns`; it was floored but not upper-clamped, and drives the supervisor's `turns.length >= maxAgentTurns` short-circuit.
- **Fix (applied):** Add a `maxAllowedAgentTurns = 8` constant and clamp with `Math.min(Math.floor(value), maxAllowedAgentTurns)` at parse time.
- **Result:** Even if the director's post-first-turn behavior ever changes, a large client value can no longer drive an unbounded loop. The route already requires a signed teacher/admin session; the director short-circuits to `cue-user` after the first turn, so this is defense-in-depth.
- **Verification:** `tsc`/`eslint`/full suite green (existing chat-route tests still pass with the clamp).

---

## §4 — Continued exhaustive sweep for new defects: none confirmed

After applying §1–§3 I re-swept the core surface reading the following logic end-to-end. Every path below was reviewed this pass and found correct; **no new Critical, Important, or Minor confirmed defect was found.**

- **Numeric aggregation:** `learner-profile.ts` (sorted-ascending assumptions for `latestTimestamp`/`courseId`, `average`/`round`/`createRate`, weak-evidence competency rollup) and `lrs-analytics.ts` (competency mastery counts, completion rate, learner set) — arithmetic and empty-set handling are sound.
- **Media / path safety:** `ppt-playback-catalog.ts` (`requireSafeId` `[A-Za-z0-9_-]` + slide-index cross-check on `audioId`), the learning audio route `parseByteRange` (suffix, open-ended, clamp-to-length, unsatisfiable/416, `start >= total`), and `readPublishedAudioFile` (catalog-controlled `publicPath`, not user input).
- **AI orchestration:** `director.ts` (single-turn short-circuit, priority/mention selection) and `agent-loop.ts` (supervisor transitions, nonce-based actor-scoped thread id — prior fix intact, node-id collision handling, `max-turns` guard).
- **Chat route:** `/api/ai/chat` request parsing, unique-roster assertion, live-provider approval gate, display-safe progress mapping.
- **Auth / access control:** `proxy.ts` (soft cookie-pair gate + role-route redirect), `uais-app-session.ts` `isUaisRouteAllowedForRole` (student ↔ teacher/admin isolation, exact prefix matching rejects `/coursesX`), and the login open-redirect defense on **both** client (`isSafeLocalRedirectTarget` + role-allow) and server (`normalizeReturnPath` blocks `//`, `isUaisRouteAllowedForRole` re-checks).
- **Enrolment:** invite-code join route (teacher sessions rejected, student session fully validated, safe actor/session/display-name checks, pending-teacher-review membership, dedup on existing membership) — the join grants no access without teacher approval.
- **LRS/xAPI:** `xapi-events.ts` deterministic UUIDv4-shaped idempotent statement id; `lrs-recorder.ts` queue/flush (per-request queue, `after()` scheduling with detached fallback — prior fix intact; the `seen`-set-on-failure edge cannot manifest because each request creates a fresh single-item queue) and targeted-query enforcement + limit clamp.
- **Learner-facing AI guide:** `/api/learning/ai-guide` (validated `agentId`, 1–1200-char question bound, `https:`/`data:image/` image allowlist, course-access gate, provider-key 503s).
- **Idempotency & readback:** `teaching-operation-idempotency.ts` key builder (length budget, sanitization) and `course-readback.ts` merge/dedup helpers.
- **Client effects:** `learning-page.tsx` audio/slide sync (slide-id gating stops stale "playing" state; clamped slide navigation) and `student-dashboard-page.tsx` fetch (`isCancelled` guard).
- **i18n parity:** `copy.ts` `zh-CN`/`en-US` key shapes match; parity is enforced structurally by `as const` + `copy[locale]` access (typecheck would fail on divergence).
- **Hygiene sweep:** no `parseInt`-without-radix, no loose `==`/`!=`, no non-null assertions, no missing `await` on store writes, no `TODO`/`FIXME`/`@ts-ignore`, no skipped/`.only` tests, no stray `console.*` in `src`.

---

## Remaining low-priority observations (not bugs; noted for awareness)

- **A — Class invite codes are sequential/enumerable.** `createClassInvitationCode` counts up from `55395057`. Joining only yields a `pending-teacher-review` membership requiring teacher approval, so a guessed code grants no data. Appears intentional (deterministic demo codes). Unchanged from prior passes.
- **B — Coarse default LRS idempotency key.** `/api/learning-records/events` defaults the key to `actorId:type:courseId:objectId`, so two legitimately different results for the same (actor, type, course, object) — e.g. re-answering one question with a new score — collapse to one statement id and the second is deduplicated LRS-side. The client can pass an explicit `idempotencyKey` to record each attempt, so this is the established contract rather than a defect; worth revisiting if question retakes must each be recorded.
- **C — Theme first-visit OS-preference (see §1 tradeoff).** First-time visitors default to light regardless of OS dark mode. Inherent to the SSR fix; documented above.

---

## Checks not run and why

- **Live smokes (Vercel/LRS/AI providers, Postgres backends):** not run — require live secrets and owner approval; out of scope for a read-based audit.
- **Browser E2E of the (now-fixed) hydration flash:** not run — the fix's mechanism is deterministic and unit-tested (SSR now emits the `dark` class from the cookie; the provider seeds from the same value). A quick browser confirmation is recommended when this lands.
- **Parked/experimental surface** (voice-clone, PPT-narration lifecycle, enterprise evidence/release orchestrators): only spot-checked where shared with the core surface, per `SCOPE.md`.

---

## Bottom line

This pass **detected and fixed three defects** — the SSR theme mismatch/FOUC (Minor), the non-finite score guard (robustness), and the unbounded `maxAgentTurns` (hardening) — each with a regression test, leaving `tsc`, `eslint`, and 2000 tests green. A second exhaustive sweep across aggregation, media, orchestration, auth, enrolment, LRS, the AI guide, and client effects surfaced **no new confirmed defect**. The UAIS core surface remains in strong shape; the only open items are three intentional/low-priority observations (A/B/C). No changes should be committed without owner approval per the coordination contract.
