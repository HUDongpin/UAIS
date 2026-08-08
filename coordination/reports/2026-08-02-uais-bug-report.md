# UAIS Bug Report

- **Date:** 2026-08-02 (overnight run started 2026-08-01)
- **Project:** UAIS — University AI System (`/Users/dongpinhu/Desktop/UAIS`)
- **Branch / tree:** `main`, fixes below are applied but **uncommitted** for owner review (per the coordination contract, nothing was staged, committed, branched, or pushed). The `AGENTS.md` +2 modification predates this run (owner's own change) and was left untouched.
- **Reviewer:** Claude — multi-agent run: Fable 5 as coordinator / quality evaluator, Opus 5 subagents as detection and implementation engineers (2 detection sweeps, 4 fix engineers, 1 baseline-gate runner, 1 final adversarial diff reviewer).
- **Method:** 5th detection round overall. Exhaustive read-based static audit split across two Opus 5 detection engineers (recent Phase 3/4 refactor surface; stable core surface), every finding independently verified in code by the coordinator before any fix was dispatched, one-writer-per-file scheduling across four parallel fix engineers, mutation-tested regression tests (each new test was shown to fail against the pre-fix code), and full gates re-run over the combined tree.

---

## Environment incident (blocking, repaired mid-run)

Before any gate could run, all three baseline checks (`tsc`, `eslint`, `vitest`) hung indefinitely. Root cause (verified, not inferred): **macOS had evicted 8,592 of 61,997 `node_modules` files to iCloud Drive** ("dataless" files, 36.4 MB of content off-disk) because the disk is at **97% capacity**, and iCloud materialization was wedged (`fileproviderd` thrashing). Any read of an evicted file blocked forever. `src/`, `tests/`, `public/`, `scripts/` had zero dataless files — source was never at risk.

**Repair applied:** the broken `node_modules` was renamed aside, `npm ci` reinstalled 843 packages from the lockfile in 11 s, and the broken tree was deleted. A first in-place `npm ci` attempt failed with `ENOTEMPTY` (iCloud file provider racing the delete) — the rename-aside approach is the reliable path if this recurs.

**Owner actions needed (the repair is temporary):**
1. **Free disk space.** At 97% full, macOS will keep evicting files; tonight's fix will not survive sustained disk pressure.
2. **Exclude `node_modules` (or the whole dev folder) from iCloud Desktop & Documents sync.** A synced `node_modules` will cause this class of outage again.

---

## Baseline checks

| Check | Before fixes (post-repair) | After all fixes |
| --- | --- | --- |
| Typecheck `npx tsc --noEmit` | PASS (0 errors) | **PASS** (0 errors) |
| Lint `npx eslint .` | 0 errors, **2 warnings** (→ bug #1) | **PASS** (0 errors, 0 warnings) |
| Suite `npm run test` | 2008 passed / 5 skipped (2013) | **2035 passed / 5 skipped (2040)** — +27 regression tests |
| Production build `npm run build` | not run pre-fix | **PASS** — all routes `ƒ` dynamic, as expected |

The 5 skips are env-gated Postgres/cutover integration suites (by design, no live DB). Hygiene greps (console.*, ts-ignore/eslint-disable, .only/.skip, TODO/FIXME) are all clean across `src/`.

---

## Bugs detected and fixed this pass (15 across 4 rounds; #1–#7 below are round 1, #8–#15 are documented in the review-rounds section)

### 1 — P2 (FIXED): stale imports left in the teaching operations route by the Phase 3 extraction
- **File:** [src/app/api/teaching/operations/route.ts](src/app/api/teaching/operations/route.ts)
- **Defect:** `randomUUID` and `type TeachingOperationRollbackReceipt` were imported but unused — the code using them moved to `partial-failure.ts` and the rollback route during the Phase 3 split. The two eslint warnings polluted the otherwise-clean lint gate. No dropped behavior (verified: the rollback path lives on in the sibling files).
- **Fix:** removed the two imports. Lint + typecheck clean.

### 2 — P2 (FIXED): locale toggle mid-edit writes a course rename the teacher never requested
- **Files:** [src/lib/teaching/course-readback.ts](src/lib/teaching/course-readback.ts), [src/components/pages/use-teaching-workspace.tsx](src/components/pages/use-teaching-workspace.tsx), [src/components/pages/teaching-page-course-settings-workspace.tsx](src/components/pages/teaching-page-course-settings-workspace.tsx)
- **Defect:** the course-settings draft was seeded with the current locale's `courseName`/`semester` on the first keystroke in ANY field and never re-derived. Saving after a locale toggle diffed the frozen old-locale draft against new-locale persisted values, so the patch POSTed a phantom `courseName`/`semester` — a durable audit record of a rename that never happened, which also collapsed the localized title in the UI. (Carried-over defect, moved verbatim by the refactor — not refactor drift.)
- **Fix:** sparse-draft model. The stored draft holds only fields the teacher actually touched; untouched fields render and diff from current-locale persisted values via the new `resolveCourseSettingsDraftValues`. Also fixes the visible symptom (form now follows the locale toggle for untouched fields).
- **Verification:** regression test proven to fail on pre-fix code; 453 targeted teaching tests green.

### 3 — P1 (FIXED): sign-out races the cookie-clearing request and bounces the user back into the app
- **Files:** [src/components/layout/header.tsx](src/components/layout/header.tsx), [tests/header.test.tsx](tests/header.test.tsx)
- **Defect:** `signOut()` fired `DELETE /api/auth/app-session` without awaiting it, then `router.replace("/login")` on the same tick. The login RSC request still carried valid session cookies, so the proxy bounced the user back to their role home; the cookies then cleared, leaving a signed-in-looking UI where every API call 401s until manual reload.
- **Fix:** `signOut` awaits the DELETE (tolerating failure), then hard-navigates via `window.location.assign("/login")` — guarantees the login request follows Set-Cookie processing and resets all client state. Ordering regression test uses a deferred fetch promise and was proven non-vacuous by mutation.

### 4 — P2 (FIXED): hydration mismatch on every invite link `/courses?invite=…`
- **Files:** [src/app/courses/page.tsx](src/app/courses/page.tsx), [src/components/pages/course-plaza-page.tsx](src/components/pages/course-plaza-page.tsx), [tests/course-plaza-page.test.tsx](tests/course-plaza-page.test.tsx)
- **Defect:** the invite param was read from `window.location.search` during render (useState initializer): server rendered "absent", client hydration rendered the join panel → React 19 hydration mismatch on every teacher-generated join link, discarding the server tree.
- **Fix:** the page is now an async server component reading `searchParams` (per the Next 16 contract) and threading `inviteParam` down — mirroring `/learning`'s existing pattern; the resolver is pure and identical on server and client. Three parity tests render via `renderToStaticMarkup` + RTL with a deliberately disagreeing jsdom URL.

### 5 — P1 (FIXED): a student's pending join request was invisible on their dashboard
- **Files:** [src/app/api/teaching/courses/route.ts](src/app/api/teaching/courses/route.ts), [tests/teaching-course-management-api.test.ts](tests/teaching-course-management-api.test.ts)
- **Defect:** the student branch of `GET /api/teaching/courses` returned only `approved` memberships (and derived course/class rows from that set), so the student dashboard's fully-built "Waiting for Teacher Review" UI was unreachable dead code. After joining by invite code, a student had zero in-app evidence their request existed.
- **Fix:** the student read now includes `pending-teacher-review` memberships plus their course/class rows; student-id isolation unchanged. All access-granting surfaces were independently confirmed to require `approved` at the DB level (`learning-ppt-playback-access`, `learning-ai-guide-access`, `findApprovedInviteLearningContext`), so the widening grants visibility, not access. A test that had codified the bug was deliberately inverted; cross-student isolation for pending rows got explicit coverage.

### 6 — P1 (FIXED): approving a student falsely reports failure after the invite code is republished
- **Files:** [src/lib/teaching/course-readback.ts](src/lib/teaching/course-readback.ts), [tests/teaching-course-readback.test.ts](tests/teaching-course-readback.test.ts)
- **Defect:** the client-side approval verifier required `approvedMembership.invitationCode === requestedClass.invitationCode`. A membership stores its join-time code; the class code is mutable (invite-code workspace generate→publish rewrites the class row only — verified in the server handlers). After a republish, every pending approval "failed" client-side while the server had already persisted it: teacher sees an error + stale roster; student is actually approved.
- **Fix:** compare against the requested **membership's** own recorded code (same-row integrity preserved, mutable class code out of the invariant). Four-case regression test, mutation-verified.

### 7 — P2 (FIXED): opening the playback manifest recorded the lesson as completed, pinning teacher metrics to 100%
- **Files:** [src/app/api/learning/ppt-playback/[courseId]/route.ts](src/app/api/learning/ppt-playback/[courseId]/route.ts), [tests/learning-ppt-playback-api.test.ts](tests/learning-ppt-playback-api.test.ts)
- **Defect:** the GET manifest handler emitted `lesson.viewed` with `result: { completion: true, success: true }` on every authorized fetch. `isCompletionStatement` treats `result.completion === true` as completion, so merely loading `/learning` once set `completionRate: 1` for that lesson/class — steering teacher insights and adaptive recommendations off fabricated evidence.
- **Fix:** the view statement no longer carries completion/success (event, context, idempotency unchanged; `viewedCount`/`activeLessonCount` still accumulate). Regression test drives the queued statement through the learner-profile pipeline and asserts zero completions.
- **⚠ Consequence requiring an owner decision:** after this fix, **no code path in the product emits genuine completion evidence** (verified by grep across all emitters). `completionRate` now honestly reads 0 instead of a fabricated 1, and low-completion recommendation branches will fire. The right follow-up is a real end-of-playback completion event through the existing `/api/learning-records/events` intake — a small scoped feature package (S03/S12/S15), not an overnight bolt-on.

---

## Adversarial review rounds 2–4: five more bugs found in (or near) the fixes, all fixed

Convergence was reached by iterating detect → fix → review until a review came back clean. Finding counts per round: **7 → 4 → 3 → 2 → 0.**

**Round 2** (full adversarial review of the round-1 diff) found 1 P1 + 3 P2; all but one fixed the same night:

- **8 — P1 (FIXED):** the pending-membership widening (bug #5) returned **raw store records** to unapproved students — teacher actor id, course description, and the class's **current invite code + join URL**. With sequential, unthrottled invite codes, a student could squat pending memberships and keep reading rotated codes — rotation no longer revoked. Fixed by projecting the entire student payload (approved AND pending) down to `{courseId, courseName, semester}` / `{classId, courseId, className, semester}` after a consumer-by-consumer field audit; a rotation-revocation regression test now pins the property.
- **9 — P2 (FIXED):** the sparse-draft fix (bug #2) still phantom-patched a field that was touched **and reverted**. Fixed in round 3 by the locale-stamped model below.
- **10 — P2 (FIXED):** the hydration fix (bug #4) left the invite panel frozen across App Router client navigation (`useState` initializer never re-runs). Fixed by deriving the panel from the prop every render, with join-status entries stamped by the invite param they belong to.
- **R4 — P2 (owner decision, deliberately NOT auto-fixed):** see "Owner decisions" below — after bug #7, no completion signal exists at all; choosing completion semantics is a product decision, not an overnight bolt-on.

**Round 3** (focused review of round-2 fixes) found 1 P1 + 2 P2, all fixed:

- **11 — P1 (FIXED):** the round-2 "equal to either locale = untouched" rule over-suppressed: on the demo courses (whose semester baseline is a locale **default**, not stored data) it silently discarded genuine edits AND overwrote the teacher's typed text mid-keystroke in the controlled input, then reported a successful save that saved nothing. Fixed with the **locale-stamped draft model**: each touched field records the locale it was typed under and is "untouched" only if it equals the persisted rendering *at that stamped locale* — typed text is never second-guessed, phantom reverts stay suppressed, and patch inclusion is toggle-invariant.
- **12 — P2 (FIXED):** the plaza join guard could be defeated across an invite-param change (join A → navigate to B → join B → A's late response re-enables B mid-flight → duplicate join → student shown a 409 failure for a class they just joined). Fixed with three independently mutation-verified guards: global in-flight disable, synchronous re-entry ref, and last-writer staleness discard.
- **13 — P2 (FIXED):** membership rows were still returned raw, leaking `approvedByTeacherId` (the same actor id the projection removed elsewhere) and the join-time code; the leak-sweep test helper was scoped too narrowly to notice. Fixed by projecting memberships to the six consumed fields and widening the sweep to the whole response body.

**Round 4** (focused review of round-3 fixes) found 1 P1 + 1 P2, both fixed; the third observation was benign non-determinism the reviewer itself recommended leaving:

- **14 — P1 (FIXED):** the round-3 predicate trimmed before comparing, so typing a leading/trailing space snapped the controlled input back and **silently ate the keystroke** (live-repro'd: `"…Methods "` + `A` → `"…MethodsA"`). Fixed by echoing a same-locale entry verbatim (it is the live edit buffer); the untouched rule now governs only absent and cross-locale entries. Patch semantics unchanged (whitespace-only edits still never patch).
- **15 — P2 (FIXED):** the globally-disabled join button rendered with no explanation for keyboard/AT users after cross-invite navigation. Fixed with a bilingual neutral status line in the existing polite live region plus `aria-describedby` on the button, single-message invariant tested.

Every fix in every round carries mutation-verified regression tests (each new test was shown to fail against the pre-fix code). The round-4 diffs were reviewed personally by the coordinator; final gates re-ran green after each round.

---

## Validated clean this pass (no finding)

- **All five Phase 3/4 refactor commits are drift-free**, verified mechanically: extracted JSX byte-identical for all four panel extractions; all ~22 handler bodies + 5 receipt guards moved verbatim into `useTeachingWorkspace`; 134/134 top-level functions identical across the external-storage store/serialization split with the append write-lock moved wholesale; the proxy env fix is correct and the shadowing anti-pattern has no second instance.
- Auth/session: claim parse/HMAC/expiry, proxy gate, `normalizeReturnPath` + role isolation (adversarial URL variants), login open-redirect defense.
- Concurrency: Postgres CAS (`SELECT … FOR UPDATE` + revision), retry loops, `writeAtomicJsonFile`, join/approve TOCTOU windows, approved-count recomputation ordering.
- Learning records: queue/flush, idempotent statement ids, timestamp sorting (correct for the UTC writers), aggregation arithmetic.
- Client hygiene: effect cleanup/cancellation guards, list keys, document listener teardown.
- i18n/data: no dangling ids; zh-CN/en-US parity structurally enforced (one semantic divergence in an unreferenced key, noted below).

## Owner decisions needed

1. **Disk + iCloud (urgent-ish):** free disk space (97% full) and exclude `node_modules`/the dev folder from iCloud sync — see the environment incident. Until then, tonight's outage can recur at any time.
2. **Completion signal (product):** after bug #7, no code path emits genuine lesson/course completion — `completionRate` honestly reads 0 for every learner, and low-completion recommendation branches now fire. Decide the completion semantics (e.g. last-slide-reached or audio-finished end-of-playback event through the existing `/api/learning-records/events` intake, with the trust boundary on learner-supplied evidence considered) and assign it as a scoped package (S03/S12/S15). Honest zero beats fabricated 100%, but the metric should either become real or be removed from teacher-facing surfaces.
3. **Pending-student visibility:** pending (unapproved) students now see the joined course/class **names and semester only** (needed for the dashboard card; all credentials and teacher ids are projected out). Confirm no product rule forbids even that.

## Deferred observations (P3 / follow-ups — not fixed tonight)

1. **Server-side approve has no invite-code invariant at all** — the client verifier is the only code-equality check; defense-in-depth gap for a future S12 package. Related: invite codes are sequential from 55395057 and the join route is unthrottled — squatting pending memberships remains possible (it no longer yields any credential); rate-limiting/non-sequential codes are candidate hardening.
2. **Same locale-freeze pattern in the new-course dialog** (`createDefaultNewCourseDraft`) — old-locale defaults can be submitted after a mid-dialog locale toggle, but all values are visible in the form before submit (cosmetic tier).
3. Course-settings drafts are never cleared after a successful save — self-healing under the new predicate, but the draft map outlives the save and a typed description is re-sent (identically) on subsequent saves; audit noise only.
4. A genuine rename collapses the localized title to one string in both locales (`applyCourseSettingsPatchToTeacherCourse` and the server projection) — the real bilingual-content debt beneath bugs #2/#11; owner decision if titles should stay separately localized.
5. LRS per-request queue retries deterministic duplicate statements 3× before counting them "failed" — wasted calls, no wrong data.
6. A legitimate join re-submit that hits `student-course-membership-already-exists` (409) still renders as a failure message — mapping already-exists to idempotent success is an S12/S04 contract question.
7. Unreferenced copy key `brand.personalUse` semantically diverges between locales.
8. `tests/teaching-course-management-api.test.ts` (~6,300 lines) is a candidate for the decomposition debt register; `tests/teaching-course-management-route-smoke.test.ts` + `teaching-operation-detail-browser-smoke.test.ts` stub payloads still model the pre-projection shape (fixtures, not contracts — worth realigning, S11). `tests/student-dashboard-page.test.tsx` / `tests/learning-page.test.tsx` fixtures likewise still carry dropped fields.
9. No end-to-end UI test chains invite-republish → approve (unit coverage now exists for the invariant).
10. Plaza join-status: a response landing in the narrow window between navigation commit and passive-effect flush is recorded against the superseded param instead of reset (display always stays correct; reviewer-assessed benign non-determinism — render-time ref writes would be worse under concurrent rendering).

## Files changed (all uncommitted, for owner review)

Source (10): `src/app/api/learning/ppt-playback/[courseId]/route.ts`, `src/app/api/teaching/courses/route.ts`, `src/app/api/teaching/operations/route.ts`, `src/app/courses/page.tsx`, `src/components/layout/header.tsx`, `src/components/pages/course-plaza-page.tsx`, `src/components/pages/teaching-page-course-settings-workspace.tsx`, `src/components/pages/teaching-page.tsx`, `src/components/pages/use-teaching-workspace.tsx`, `src/lib/teaching/course-readback.ts`
Tests (6): `tests/course-plaza-page.test.tsx`, `tests/header.test.tsx`, `tests/learning-ppt-playback-api.test.ts`, `tests/teaching-course-management-api.test.ts`, `tests/teaching-course-readback.test.ts`, `tests/teaching-page.test.tsx`
Total: **+1,920 / −128 lines** across 16 src/test files (excluding the owner's pre-existing `AGENTS.md` edit). Roughly two-thirds of the added lines are regression tests — the suite grew 2008 → 2035, and every new test was mutation-verified (shown to fail against the pre-fix code).

## Convergence statement

The loop's termination criterion — no known P0/P1/P2 remaining — is met: two independent exhaustive detection sweeps, three adversarial review rounds over the fixes themselves (finding counts 7 → 4 → 3 → 2 → 0), a final coordinator review of the last diffs, and green gates (typecheck, lint, 2035-test suite, production build) over the final tree. Open items are the three owner decisions above and the P3 follow-up list; none is a live P0/P1/P2 defect in the code as it stands.
