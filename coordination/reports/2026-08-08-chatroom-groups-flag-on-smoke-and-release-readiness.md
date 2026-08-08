# Chatroom Groups — Flag-On Smoke Evidence and Release Readiness

- Date: 2026-08-08
- Sessions: S22 (release/smoke evidence), S12 (share revoke limiter), S24 (PDF decision — separate memo)
- Covers the three open follow-ups recorded in `coordination/release-intake/2026-08-08-chatroom-groups-intake.md` §7
- Scope: **local** flag-on verification. A Vercel deployment smoke is still owner-gated (no credentials in this session).

---

## 1. Summary

| Follow-up | Status |
| --- | --- |
| Share backend (blocker B1) | **Closed 2026-08-09** — external resource, adapter and shared resolver landed. |
| Public `/share` read limiter | **Already implemented** — landed in `f08d579`, not deferred as the CTO log stated. Verified in code and by test. |
| Share **revoke** limiter | **Gap found and closed in this session** — the revoke path had no limiter at all. |
| Flag-on smoke | **Executed locally, end to end, with evidence below.** Deployment smoke remains owner-gated. |
| True PDF export | **Decision memo** — `coordination/reports/2026-08-08-true-pdf-export-decision.md`. Not implementable without an owner call on a dependency + font asset. |

---

## 2. Correction to the record

`coordination/reports/2026-08-08-chatroom-groups-cto-execution-log.md` (Wave 6, "Minors deferred") states that the public `/share` read path has **no limiter** and logs it as a follow-up. That is **no longer true and was already false when written**: `src/lib/server/learning-chatroom-share-rate-limit.ts` exists, is wired into the read path, and is covered by tests.

What it actually does:

- `createLearningChatroomShareReadRateLimiter()` — fixed windows, **60/minute and 5000/day**, `mode: "enforce"`, deliberately not env-tunable (the active-production env tier is saturated at 21 and `tests/env-surface.test.ts` pins that ceiling).
- Keyed by **viewer IP**, resolved `x-real-ip` → first hop of `x-forwarded-for`, validated with `node:net` `isIP` (not sanitized), IPv6 folded to a **/64** prefix so one network is one bucket. An unparseable value collapses into a single shared `share-viewer-unknown` bucket rather than minting a fresh budget per request.
- Checked **before** any storage read, in `learning-chatroom-share-view.ts`, so a throttled request costs zero snapshot round trips.

Residual, documented in that module and confirmed here: an App Router **page** cannot emit a real 429, so a throttled viewer receives a 200 HTML "try again later" and `retryAfterSeconds` is computed but discarded. The protection (skipping the three database reads) is intact; only the status code is imprecise. Fixing it properly needs a route handler or `proxy.ts` involvement — not worth the churn while the flag is off, but recorded here so it is not re-discovered as a defect.

---

## 3. New in this session — share revoke limiter (S12)

`DELETE /api/learning/chatroom/share/[shareId]` was session-gated only. Every call performed a shares-snapshot read and, on success, a read-modify-write of the whole database, so a signed-in client in a loop could hammer storage.

Added, mirroring the mint route's pattern exactly:

- Fixed windows **20/minute, 400/day**, `mode: "enforce"`, not env-tunable (same catalog constraint).
- Keyed on `appSession.account`, checked **before** the shares read.
- Returns **429 with a real `retry-after` header** (the route's error class and `jsonResponse` gained retry support).
- Deliberately **higher than minting's 10/200**: revocation is the safety valve and must not be the first thing to run out.

Test: `throttles a looping revoker before it reaches the shares snapshot` — spends the injected limiter's budget up front and pairs it with a throwing repository, so the assertion proves the guard runs *before* storage rather than merely changing a status afterwards; also asserts per-account key isolation.

---

## 4. Local flag-on smoke — method and evidence

**Method.** Two dev servers were run from `.claude/launch.json` configs (`uais-dev-groups-smoke`, `uais-dev-groups-off-smoke`) against a scratch seed directory — the repo's own `.tmp/` store was not touched. The seed shape was copied verbatim from the passing fixture `createChatroomGroupDatabase` in `tests/learning-chatroom-group-api.test.ts`, with the two real local-demo accounts substituted:

- Course `smoke-research-methods`, owner **Phoebe** (teacher).
- Class `smoke-research-methods-class-1`, approved memberships for **Peter** (student) and `lin-ruochen` (display name 林若晨).
- Group `smoke-group-three` (第三小组) containing both students.

Authentication used the real `POST /api/auth/app-session` demo login for both accounts. A DeepSeek key was present in the local environment, so the agent rounds below were **live model calls**, not stubs.

### 4.1 Flag ON — results

| # | Check | Result |
| --- | --- | --- |
| 1 | Student course projection carries groups | `features.learningChatroomGroups: true`; group returned with `members: [{Peter, isSelf:true}, {林若晨, isSelf:false}]` |
| 2 | Member POST with `@方法顾问` | **200**, live agent turn returned |
| 3 | **Teacher POST into the same room** | **200**, live agent turn returned — teaching presence works end to end |
| 4 | Member GET replays the shared room | 4 messages: member turn, agent turn, **teacher turn, agent turn** |
| 5 | Instructor attribution | Teacher's row carries `authorRole: "teacher"`; member rows carry no role at all |
| 6 | Perspective is per viewer | Same teacher row is `isSelf:false` for Peter and `isSelf:true` for Phoebe |
| 7 | Account-id leak | `lin-ruochen` (an account id whose display name differs) **absent** from the payload; display name 林若晨 present |
| 8 | Share mint by a **member** | **201**, `groupId` echoed |
| 9 | Share mint by the **teacher** | **403**, `access.reasonCode: teacher-group-share-member-only` — the member-only correction verified live |
| 10 | Public signed-out `/share/<id>` | **200**, renders the transcript and display names, no account id in the HTML |

### 4.2 Flag OFF — kill switch confirmed

| # | Check | Result |
| --- | --- | --- |
| 11 | Group history GET | **403** `feature-not-enabled` |
| 12 | Previously minted group share link | **404** — an already-published room stops resolving |
| 13 | Student course projection | `features.learningChatroomGroups: false`, `learningGroups` key absent entirely |
| 14 | Legacy per-student room (no `groupId`) | **200** — unaffected |

That last pair is the important one: the flag is a genuine kill switch, not a UI toggle, and turning it off does not disturb the pre-existing per-learner chatroom.

**Reproduce:** `node <scratch>/seed-smoke.mjs <seed-dir>`, then start `uais-dev-groups-smoke` (or `...-off-smoke`) from `.claude/launch.json` after pointing `UAIS_TEACHING_COURSES_DATA_DIR` at that directory. Both configs pin `UAIS_APP_AUTH_PROVIDER=local-demo` and `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=local-json-file`.

---

## 5. Release blockers for a production flag flip

These are **not** regressions; they are the gap between "green locally" and "safe in production". All were confirmed by reading the code, not inferred.

**B1 — RESOLVED 2026-08-09.** Share links could not work in a deployed runtime at
all: `learning-chatroom-share-store.ts` documented a `repository` seam, but no
factory existed and there was no `/learning-chatroom-shares/database`
external-storage resource, so production fell through to local JSON and
`assertLearningChatroomShareLocalJsonRuntimeAllowed` refused itself — minting
**and** the public read both failed closed while every local run passed.

Closed by giving shares the same storage chain transcripts already had: a
`learning-chatroom-shares` resource on the external-storage service (GET + PUT
with the `replace-learning-chatroom-shares-database` action, optimistic
revisions, atomic temp-file writes, path jailing), a client adapter
(`learning-chatroom-share-external-store.ts`) with the same 404/409/502 and
production-evidence handling as the transcript adapter, and one resolver
(`learning-chatroom-share-runtime.ts`) that all three callers — mint, revoke and
the public page — now share so they cannot drift. Shares deliberately follow
`UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND` rather than adding a second switch: a
link and the room it publishes must be equally durable. The local-JSON refusal
in production is unchanged and still correct; it is now the fallback rather than
the only path. Ten tests drive the real service handlers and the real adapter
against each other over a loopback fetch.

**B2 — Transcript and course stores must be external before the flip.** Local JSON is refused in production for every store in this chain. `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND` and the `UAIS_EXTERNAL_STORAGE_*` family are all in the **quarantined-legacy** env tier, meaning they are not currently expected to be set in production. Group rooms cannot function until that is resolved (S19/S22).

**B3 — External-storage service must accept transcript schema v2.** The app now always emits `uais-learning-chatroom-transcripts-v2`. The external PUT handler normalizes with the same shared code, so an **in-repo** deployment is fine; a **separately deployed** external-storage service must be updated first or every write is rejected. Confirm which topology is in use before flipping.

**B4 — Env parity.** `UAIS_LEARNING_CHATROOM_GROUPS_MODE` must be set to exactly `on` (the flag accepts only that literal — `true`, `1`, `yes` all leave groups off). It is catalogued in `optional-live-ai`, so it is not set by default.

**B5 — Rate limits are per serverless instance.** Every limiter here is in-process; the effective ceiling is `limit × instance count`. Acceptable for launch, documented in `ai-request-rate-limit.ts`, and a shared-storage limiter remains a separate S12 decision.

**Recommended flip order:** resolve B2 and B3 → deploy with flag off → verify env parity → flip the flag in preview → run §4.1 against the preview with two real seeded accounts → flip production. B1 no longer gates anything: with the external backend configured, shares work; without it, a production runtime still refuses rather than writing somewhere that vanishes.

---

## 6. Checks run

- `npm run test` — pass (see the commit's gate line; 173 files, 2277 tests after the new revoke case).
- `npm run lint` — pass. `npx tsc --noEmit` — pass. `npm run build` — pass.
- Local flag-on/flag-off smoke — the 14 checks above, executed against real dev servers via HTTP.

## 7. Not run, and why

- **Vercel deployment smoke** — no owner credentials in this session; AGENTS.md forbids sourcing them. Blocked on B1–B4 anyway.
- **External-storage round trip** — needs `UAIS_EXTERNAL_STORAGE_BASE_URL` + token.
- **Multi-instance limiter behaviour** — not observable on a single local process.
