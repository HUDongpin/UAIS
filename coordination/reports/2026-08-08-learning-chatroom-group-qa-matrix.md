# Learning Chatroom Groups — S11 Release-Quality Matrix

- Date: 2026-08-08
- Session: S11 (QA and release quality lead)
- Phase: P6 hardening, per `coordination/reports/2026-08-08-learning-chatroom-group-implementation-plan.md` §4 / §7
- Execution context: `coordination/reports/2026-08-08-chatroom-groups-cto-execution-log.md` (Waves 1–5 complete, gate green)
- Scope of this report: map the ten §7 scenario families onto concrete suites and named cases, count coverage, name the gaps, and record the release-gate status. **No feature code changed. No git mutations.**

---

## 1. Suites under review

| Suite | Git state | describes | `it` cases | Primary families |
| --- | --- | --- | --- | --- |
| `tests/learning-chatroom-api.test.ts` | untracked (new) | 5 | 57 | F4, F6, F10, F3 (legacy gates) |
| `tests/learning-chatroom-group-api.test.ts` | untracked (new) | 4 | 23 | F2, F3, F5, F6 |
| `tests/learning-chatroom-share-api.test.ts` | untracked (new) | 6 | 22 | F9, F3 |
| `tests/teaching-learning-groups-api.test.ts` | untracked (new) | 1 | 21 | F1, F3, F5 |
| `tests/learning-chatroom-live.test.tsx` | untracked (new) | 1 | 29 | F7, F4 |
| `tests/learning-chatroom-group-live.test.tsx` | untracked (new) | 1 | 20 | F7, F2, F3, F10 |
| `tests/teaching-learning-groups-workspace.test.tsx` | untracked (new) | 1 | 13 | F8, F3 |
| `tests/student-dashboard-learning-groups.test.tsx` | untracked (new) | 1 | 5 | F8 |
| `tests/env-surface.test.ts` | unchanged (dynamic catalog coverage) | 1 | 4 | release/env gate |
| **Total (nine suites)** | | **21** | **194** | |

Verified by direct run: `npx vitest run <the nine files>` → **9 files passed, 194 tests passed, 2.59s**.

Two group-relevant cases live outside the nine suites and are cited below:
`tests/uais-data.test.ts` → `addresses the real room from the export and share actions` (F9).

House-rule compliance (plan §7 "House rules"): all four new API suites use DI handler factories, signed test cookies, `mkdtemp` fixtures and injected clocks; no `process.env` reads, no real network, no sleeps. Response-family credential guards are present in all four, under two names — `expectNoCredentialValues` (chatroom-api ×38, group-api ×5, groups-api ×10) and, in the share suite, `expectNoAccountIds` ×9, which additionally asserts no student account ids, no session signing secret and no local `/Users/` paths in any share/export payload or rendered markup.

---

## 2. Coverage matrix — §7 scenario families

Counts are **cited cases**, i.e. named `it` cases that carry evidence for that family. A case may be cited under more than one family; where it is, the row says so. The 194-case total is not the sum of this column.

### F1 — Group CRUD + validation + audit (P1)

**Cited: 15** — all in `tests/teaching-learning-groups-api.test.ts`.

| Sub-scenario | Named case |
| --- | --- |
| Create + persisted receipt + audit event | `creates a group for approved members and persists a receipt plus audit event` |
| Course-scoped create (no classId) | `creates a course-scoped group when no class id is supplied` |
| Name bound (120 chars) | `truncates an over-long group name to the 120 character bound` |
| PATCH rename + member replace, `addedAt` retention | `replaces members and renames in one PATCH, keeping the original addedAt of retained members` |
| Empty-PATCH rejection | `rejects a PATCH that carries neither a name nor a member list` |
| Delete + audit trail + deleted record | `deletes a group, keeps the audit trail, and reports the deleted record` |
| Foreign-teacher denial across all three verbs | `denies a foreign teacher on create, update, and delete` |
| Role/session denial | `denies student and admin app sessions and unauthenticated callers` |
| Membership must be approved | `rejects members without an approved membership in the course` |
| Class-scoped membership must match | `rejects a member approved in a different class than the class-scoped group` |
| 2..12 bounds + duplicate members | `enforces the 2..12 member bounds and rejects duplicate members` |
| Id/name shape validation | `rejects malformed member ids and missing group names` |
| Teacher projection | `returns full group records to the owning teacher only` |
| Student projection privacy | `narrows the student group projection to the caller's own groups without student ids` |
| Class-scoped projection | `projects the class id when a group is class scoped` |

### F2 — Group room share semantics: multi-member read/write, attribution, idempotent re-posts (P2)

**Cited: 10** (5 primary API + 2 contention, also F6 + 2 live, also F7 + 1 legacy idempotency, also F4).

| Sub-scenario | Suite → named case |
| --- | --- |
| Two members, one room, server-side attribution | group-api → `shares one room between two members and attributes every turn server-side` |
| Interleaved replay | group-api → `replays both members' turns in one thread after each has spoken` |
| Roster without account ids | group-api → `returns the group roster without any account identifier` |
| Idempotent re-post (no re-attribution) | group-api → `does not re-attribute a message the room has already stored` |
| Stored author-name bound | group-api → `bounds a stored author name to 120 characters` |
| Multi-writer conflict retry (group vs per-student) | group-api → `retries a contended group append past the conflict a per-student append gives up on` *(also F6)* |
| Retry budget exhaustion | group-api → `stops retrying once the caller's retry budget is spent` *(also F6)* |
| Cross-member liveness (message merge) | group-live → `merges a message another member sent while this room was open` *(also F7)* |
| Cross-member liveness (agent round status) | group-live → `refreshes agent round status from a poll another member's round produced` *(also F7)* |
| Legacy idempotent re-post baseline | chatroom-api → `does not duplicate stored messages when the client re-posts its visible transcript` *(also F4)* |

### F3 — AuthZ matrix (role × verb × flag) (P2)

**Cited: 36.**

| Axis | Suite → named case(s) |
| --- | --- |
| Non-member course student, GET **and** POST | group-api → `denies a course member who is not in the requested group` |
| Other-group member (GET), with own-group positive control | group-api → `denies a member of another group in the same course` |
| Owning teacher = full participant (GET + POST allow, instructor attribution) | group-api → `lets the owning teacher speak in a group room, attributed as the instructor`; `ignores an author role claimed by the request body` |
| Foreign teacher + every admin | group-api → `denies a teacher who does not own the course and denies every admin` |
| Teacher × group outside the course | group-api → `denies a teacher observing a group that does not belong to the course` |
| Flag off, both handlers, store untouched | group-api → `rejects every group request while the flag is off, without touching the store` |
| Flag value parsing (deny-by-default) | group-api → `treats anything other than an explicit on as off`; `accepts an on value regardless of casing or padding` |
| Legacy path unaffected by flag | group-api → `leaves a request without a groupId on the legacy path whatever the flag says` |
| groupId length bound, both handlers | group-api → `rejects an oversize groupId on both handlers` |
| Teacher CRUD authz | groups-api → `denies a foreign teacher on create, update, and delete`; `denies student and admin app sessions and unauthenticated callers` |
| Projection authz + flag surface | groups-api → `returns full group records to the owning teacher only`; `narrows the student group projection to the caller's own groups without student ids`; `reports the group feature state to both roles when groups are on`; `withholds the student group projection while groups ship dark`; `reads the group flag exactly like the chatroom route` |
| Share mint authz | share-api → `refuses a caller who is not in the group`; `keeps group minting member-only even though the teacher speaks in the room`; `refuses a group link while the feature flag is off`; `requires a session and a course` |
| Share revoke authz | share-api → `lets the creating member revoke, after which the public lookup is a 404`; `lets the course-owning teacher revoke a link a student minted`; `refuses another group member, a foreign teacher, and an unknown id` |
| Export authz (same gate as GET) | share-api → `gives a group member the room, and refuses a foreign student`; `lets the course-owning teacher print a group room`; `requires a session, a course, and the feature flag for a group room` |
| Signed-out / no-membership legacy gates | chatroom-api → `rejects chatroom requests without a UAIS app session`; `denies chatroom requests without approved course membership before provider calls`; `rejects a transcript read without a UAIS app session`; `denies a transcript read without course context or approved membership` |
| Client-side denial handling | group-live → `stops polling a denied group room and explains it once`; `keeps a teacher out of group rooms unless a deep link asks for one`; `gives a teacher on a group deep link a composer and the instructor identity`; `drops the group and re-reads the legacy room when the deployment answers feature-not-enabled`; `shows the no-group notice when the caller has groups but none in this room` |

Matrix completeness: **member / non-member / other-group member / teacher-owner / foreign-teacher / admin** are all covered on GET; POST denial is pinned for non-member (`student-group-membership-required`); the owning teacher is a participant on POST and their turn is pinned as instructor-attributed, with body-claimed `authorRole` pinned as ignored. Signed-out × groupId is covered only transitively (the session gate runs before group resolution) — see G4.

### F4 — Legacy regression: per-student rooms and transcript ids byte-stable (P2)

**Cited: 96.**

| Sub-scenario | Suite → evidence |
| --- | --- |
| Whole legacy chatroom API contract, untouched | chatroom-api → **all 57 cases** across `API contract`, `rate limit`, `history rate limit`, `transcript persistence`, `transcript append budget` |
| Whole legacy chatroom UI, untouched | chatroom-live → **all 29 cases** |
| Per-student transcript id byte-stability | group-api → `keeps every per-student transcript id byte-stable` |
| Group id derivation on a separate tagged array | group-api → `derives group ids from their own tagged array, independent of the member` |
| No-groupId request stays legacy under any flag value | group-api → `leaves a request without a groupId on the legacy path whatever the flag says` |
| Window caps not changed for legacy rooms | group-api → `keeps 500 turns in a group room and 200 in a per-student room` |
| Pre-groups database still valid | groups-api → `keeps a database written before learning groups existed valid` |
| Legacy UI attribution and silent fallback | group-live → `keeps a legacy room's stored student rows attributed to the reader`; `stays quiet and legacy when the caller has no groups at all`; `drops the group and re-reads the legacy room when the deployment answers feature-not-enabled` |
| Legacy room export/share | share-api → `lets a course member mint a link for their own legacy room`; `labels a legacy room's turns with the creator's display name` |

### F5 — Schema: v1→v2 read tolerance, v2 round-trip through external snapshot PUT (P2)

**Cited: 10.**

| Sub-scenario | Suite → named case |
| --- | --- |
| Id derivation (both room kinds) | group-api → `keeps every per-student transcript id byte-stable`; `derives group ids from their own tagged array, independent of the member` |
| v1 read → always emit v2 | group-api → `reads a v1 database and always emits v2` |
| In-place v1 upgrade on append, replay unchanged | group-api → `upgrades a v1 file in place on the next append and replays it unchanged` |
| External-storage snapshot PUT normalizer accepts v2 | group-api → `round-trips a v1 database through the external storage snapshot handlers as v2` |
| Author-name bound at the schema boundary | group-api → `bounds a stored author name to 120 characters` |
| Course-management DB normalizer with groups | groups-api → `round-trips a database with learning groups through the normalizer`; `keeps a database written before learning groups existed valid`; `rejects a stored learning group whose member shape is invalid` |
| Share database normalization + unguessable ids | share-api → `mints unguessable ids and normalizes a stored database tolerantly` |

### F6 — Budgets: append race fix (P0) + group-append within budget (P2)

**Cited: 12.**

| Sub-scenario | Suite → named case |
| --- | --- |
| Append skipped once budget spent | chatroom-api → `skips the append entirely once the persistence budget is already spent` |
| Latest faithful round still persisted | chatroom-api → `still persists the latest a faithful round can end` |
| Round answered when append overruns | chatroom-api → `answers the round when the append outruns its budget` |
| Contractual failure body on best-effort overrun | chatroom-api → `answers the contractual failure body when the best-effort append outruns its budget` |
| Healthy fast append unchanged | chatroom-api → `leaves a healthy fast append unchanged` |
| 60s serverless duration ceiling | chatroom-api → `keeps the chatroom route within the 60 second serverless duration budget` |
| Round provider budget | chatroom-api → `skips provider calls for agents left without round budget`; `shrinks each provider timeout to the remaining round budget`; `subtracts pre-round request time from the round provider budget`; `skips every agent to a timeout fallback when pre-round work exhausts the request budget` |
| Group append retry budget (`retryBudgetMs` seam) | group-api → `retries a contended group append past the conflict a per-student append gives up on`; `stops retrying once the caller's retry budget is spent` |

### F7 — UI: identity, mentions, roster, teaching presence, picker, polling, locales, reduced motion (P3)

**Cited: 49** (group-live 20 + chatroom-live 29).

| Sub-scenario | Suite → named case |
| --- | --- |
| Sole-group auto-entry | group-live → `auto-enters the only assigned group and reads that group's room` |
| Roster from the GET projection, self badged | group-live → `renders the roster from the GET projection with the self member badged` |
| Other-member identity: name, alignment, avatar | group-live → `renders another member's message with their name, non-self alignment and a circular avatar` |
| Server `isSelf` is the alignment authority | group-live → `aligns a stored message to the right only when the server says it is mine` |
| Pre-v2 row without `authorName` | group-live → `falls back to a neutral author for a pre-v2 row that carries no authorName` |
| Group picker at ≥2 groups | group-live → `shows the group picker for two groups and enters the chosen one` |
| Deep link `?groupId=` alone | group-live → `resolves a ?groupId= deep link without the link naming the course` |
| POST carries the groupId | group-live → `posts the groupId with the round and keeps the sent message in the room` |
| No-group / no-groups notices | group-live → `shows the no-group notice when the caller has groups but none in this room`; `stays quiet and legacy when the caller has no groups at all` |
| Legacy attribution in the new view | group-live → `keeps a legacy room's stored student rows attributed to the reader` |
| Flag-off silent fallback | group-live → `drops the group and re-reads the legacy room when the deployment answers feature-not-enabled` |
| Membership-denial halt | group-live → `stops polling a denied group room and explains it once` |
| Mention chips, **both locales** | group-live → `renders localized mention chips in the bubble in both locales` |
| Teaching presence (composer + instructor identity) | group-live → `gives a teacher on a group deep link a composer and the instructor identity`; `keeps a teacher out of group rooms unless a deep link asks for one` |
| Polling: merge, agent status, hidden-tab pause, 429 back-off | group-live → `merges a message another member sent while this room was open`; `refreshes agent round status from a poll another member's round produced`; `pauses polling while the tab is hidden and reads immediately on return`; `keeps the thread and backs off when the history read is rate limited` *(last also F10)* |
| Course resolution, picker, seeds, error copy, transcript replay, round/switch races, draft handling, composer gating, no-session path | chatroom-live → **all 29 cases** (regression floor for the rewritten view; the hook extraction is exercised through them) |

### F8 — Teaching UI: group panel receipt-and-readback (P4)

**Cited: 18** (workspace 13 + student dashboard 5).

| Sub-scenario | Suite → named case |
| --- | --- |
| List with member chips + Observe deep link | workspace → `lists persisted groups with member chips and a teacher observe deep link` |
| Create via receipt-and-readback | workspace → `creates a group through receipt-and-readback verification` |
| Approved-only picker + 2..12 mirrored client-side | workspace → `offers only approved memberships and enforces the 2..12 member bounds` |
| Class-scoped roster + classId on the wire | workspace → `scopes a class group to that class roster and sends its class id` |
| Server reason codes rendered as guidance | workspace → `renders server validation reason codes as friendly guidance` |
| Verification failure modes | workspace → `refuses an unverified create when the persisted receipt is missing`; `refuses an unverified create when the readback does not carry the group` |
| Rename + member replace in one verified PATCH | workspace → `renames a group and replaces its members through one verified patch` |
| Two-step delete + verified readback | workspace → `deletes a group only after an explicit confirm and a verified readback` |
| Flag gating (D9: UI hides when dark) | workspace → `hides the whole group surface while groups ship dark`; `hides the group surface when the server reports no feature state at all`; `shows the group surface as soon as the server reports the feature on` |
| en-US locale | workspace → `renders the group panel in English under the en-US locale` |
| Student dashboard group card | dashboard → `renders the student's real group with co-members and a chatroom deep link`; `lists every group the student belongs to`; `keeps the placeholder collaboration card when the student has no group`; `falls back to the placeholder card while groups ship dark`; `renders the group card in English under the en-US locale` |

### F9 — Export / share: mint, revoke, public render, authz (P5)

**Cited: 23** (share-api 22 + uais-data 1).

| Sub-scenario | Suite → named case |
| --- | --- |
| Store round-trip + revoke terminality | share-api → `round-trips a share through the local store and stops resolving once revoked` |
| Unguessable ids + tolerant normalization | share-api → `mints unguessable ids and normalizes a stored database tolerantly` *(also F5)* |
| Mint (group, legacy) with no account ids | share-api → `lets a group member mint a link scoped to the room, with no account ids in the answer`; `lets a course member mint a link for their own legacy room` |
| Mint authz (non-member, owning teacher = member-only, flag off, session/course) | share-api → 4 cases, see F3 |
| Revoke (creator, course-owning teacher, refusals) | share-api → 3 cases, see F3 |
| Public page renders live, display names only | share-api → `renders the live room with display names only`; `keeps a live room current instead of freezing it at mint time` |
| Public page not-found paths | share-api → `answers not-found for an unknown id, a revoked link, and a deleted group` |
| Legacy room labelling on the public page | share-api → `labels a legacy room's turns with the creator's display name` |
| Export authz | share-api → 3 cases, see F3 |
| Printable document rendering | share-api → `renders the printable document with agent turns labelled` |
| Real (de-mocked) button wiring | share-api → `mints through the real route and returns the caller's own absolute link`; `reports failure instead of copying a broken link`; `addresses the print view at the room the chatroom is showing` |
| Export/share URL builders address the real room | uais-data → `addresses the real room from the export and share actions` |

### F10 — Rate limits: GET limiter windows + POST limiter unchanged (P0/P2)

**Cited: 15.**

| Sub-scenario | Suite → named case |
| --- | --- |
| POST round limiter (unchanged): inside window, over-limit body + retry hint, window reset, long window, off switch, unusable value, unconfigured default | chatroom-api → 7 cases in `UAIS learning chatroom rate limit` |
| GET history limiter: inside window, over-limit body + retry hint, long window, off switch, unconfigured polling default, unusable value, independence from the round limiter | chatroom-api → 7 cases in `UAIS learning chatroom history rate limit` |
| Client back-off on GET 429 without blanking the thread | group-live → `keeps the thread and backs off when the history read is rate limited` |

---

## 3. Coverage roll-up

| Family | Cited cases | Suites | Verdict |
| --- | --- | --- | --- |
| F1 Group CRUD + validation + audit | 15 | 1 | **Strong** |
| F2 Group room share semantics | 10 | 3 | **Strong** |
| F3 AuthZ matrix | 36 | 6 | **Strong** (one thin axis, G4) |
| F4 Legacy regression | 96 | 6 | **Strong** |
| F5 Schema v1→v2 + external round-trip | 10 | 3 | **Strong** |
| F6 Budgets | 12 | 2 | **Strong** |
| F7 Chatroom UI | 49 | 2 | **Adequate** (a11y + reduced motion + locale breadth thin — G1, G2) |
| F8 Teaching UI | 18 | 2 | **Strong** |
| F9 Export / share | 23 | 2 | **Adequate** (production seam + print coupling untested — G3, G5) |
| F10 Rate limits | 15 | 2 | **Adequate** (share limiter untested — G6) |

No §7 family is uncovered. All ten have at least one API-level or live-level case, and eight of ten have both.

---

## 4. Gaps

Ranked by release risk. None of these block the current dark-flag release (`UAIS_LEARNING_CHATROOM_GROUPS_MODE` defaults `off`); G3 and G5 are the two that bite on a flag flip.

**G1 — Accessibility contract is implemented but not pinned (F7).**
`src/components/pages/learning-page-chatroom.tsx` renders `role="log"` + `aria-live="polite"` (lines 137–138, 306), but no case in either live suite asserts them (`grep` for `role="log"` / `aria-live` across both live suites returns nothing). A refactor can silently drop the live region and every test stays green. §11 acceptance item 7 claims keyboard-navigable, and no case exercises keyboard traversal of the roster / picker / composer either.
*Recommended:* 2–3 cases in `learning-chatroom-group-live.test.tsx` pinning the log region, the aria-live status node, and Tab order through picker → composer → send.

**G2 — Reduced motion is asserted nowhere; locale breadth in the chatroom view is one case (F7).**
§7 family 7 names reduced motion explicitly. The source uses `motion-reduce:animate-none` on the three thinking-indicator dots (lines 169–171) with no test. Locale coverage in the group chatroom is a single case (`renders localized mention chips in the bubble in both locales`); the roster, instructor labels, picker, no-group notice and denial copy are asserted in zh-CN only. The teaching workspace and student dashboard each have a proper en-US case, so this gap is chatroom-specific.
*Recommended:* one `motion-reduce` class assertion, plus one en-US case that walks roster + instructor labels + denial copy.

**G3 — The share store's deliberate production 503 is untested (F9).**
`src/lib/server/learning-chatroom-share-store.ts` refuses local-JSON writes when `VERCEL_ENV`/`NODE_ENV`/`UAIS_DEPLOYMENT_ENV` is `production` (503 at lines 140 and 226). No case in `learning-chatroom-share-api.test.ts` sets any of those, so the guard is unpinned in both directions: nothing proves production 503s, and nothing proves a non-production deployment still mints. This is the seam the CTO log lists under "known seams for release notes", so it will be read as intentional behaviour by operators — it should be a test, not just a comment.
*Recommended:* two cases (production ⇒ 503 with the shared error body; preview ⇒ mints).

**G4 — Signed-out × groupId is covered only transitively (F3).**
The group suite has no case that calls GET/POST with a `groupId` and no cookie; signed-out is proved on the legacy path only (`rejects chatroom requests without a UAIS app session`, `rejects a transcript read without a UAIS app session`), and in the share suite via `requires a session and a course`. The session gate demonstrably runs before group resolution, so the behaviour is right today — but the plan's §7 matrix names "signed-out" as an explicit axis and it is not pinned against group ordering regressions.
*Recommended:* one case, both handlers, `groupId` present, no cookie ⇒ 401 with the store untouched.

**G5 — The print stylesheet is coupled to another session's markup with no pin (F9).**
`src/app/learning/chatroom/export/page.tsx:105` hides the app shell with `header.sticky { display: none !important; }`. That class lives in `src/components/layout/header.tsx:172` (S01's file). Nothing asserts the coupling. If S01 restyles the header off `sticky`, the printed transcript silently gains a page-one header band and every suite stays green. The CTO log already names `standaloneRoutes` as the durable fix.
*Recommended:* a one-line pin asserting the shell header still carries `sticky` until `standaloneRoutes` lands, or the `standaloneRoutes` fix itself (S01/S22 decision).

**G6 — The share mint limiter is untested (F10).**
Wave 5 shipped a 10/min, 200/day fixed limiter on `POST /api/learning/chatroom/share`. `grep` for `429` / `rateLimit` in `learning-chatroom-share-api.test.ts` returns nothing. The GET and round limiters each have seven cases; the share limiter has zero, including no case for the over-limit body shape.
*Recommended:* mirror two of the existing limiter cases (inside window; over-limit body + retry hint) against the share handler.

**G7 — Group rooms are not exercised against the POST round limiter (F10).**
The round limiter is actor-keyed and unchanged, and family 10 says "POST limiter unchanged" — which the seven legacy cases prove. But no case posts with a `groupId` under an exhausted round budget, so the group branch's ordering relative to the limiter (limiter before authz, per the P0 design) is unpinned for group requests.
*Recommended:* one case, low priority — the limiter sits ahead of the group branch, so the risk is ordering regression only.

**G8 — Real-timer polling assertion in a request-count test (F7, robustness).**
`learning-chatroom-group-live.test.tsx` → `resolves a ?groupId= deep link without the link naming the course` (line 517) asserts `reads).toHaveLength(1)` under real timers while the view polls every 5s; the suite's other polling cases all install `vi.useFakeTimers()`. The test finishes well inside one poll interval (`findByText` caps at 1s), and it passed on every run in this session, so it is **not** currently flaky — but the assertion is time-shaped and will break the day the poll interval or the resolution path gets slower. Flagged by the Wave 4 engineer and carried here.
*Recommended:* wrap it in fake timers like its neighbours.

**G9 — Browser visual walkthrough still owed (out of automated scope).**
Wave 3 recorded "browser visual walkthrough both themes/locales — scheduled for final verification phase". Both live suites run with `theme: "light"` fixed; dark-theme rendering of the three-zone chatroom, the roster and the print view has no automated or recorded manual evidence. §11 acceptance item 7 requires both themes.
*Recommended:* S04/S06 manual pass on `/learning/chatroom` (group + legacy), `/learning/chatroom/export` and `/share/[shareId]` in both themes and locales, recorded in a session log. Not an S11 write scope.

---

## 5. Current status

### Release gates — re-run fresh by S11 on 2026-08-08 against the working tree

| Gate | Command | Result |
| --- | --- | --- |
| Full suite | `npm run test` | **173 files passed, 3 skipped (176) · 2262 tests passed, 5 skipped (2267)** · 39.84s |
| Nine reviewed suites | `npx vitest run <nine files>` | **9 files passed · 194 tests passed** · 2.59s |
| Lint | `npm run lint` | **clean**, exit 0 |
| Types | `npx tsc --noEmit` | **clean**, exit 0 |
| Production build | `npm run build` | **Compiled successfully**, exit 0; routes present incl. `/learning/chatroom`, `/learning/chatroom/export`, `/share/[shareId]` |

These figures match the Wave 5 gate recorded in the CTO execution log exactly (173 / 2262), independently reproduced. Baseline before the group work was 167 files / 2146 tests; the ten families added **6 files and 116 tests** net.

### Deployment evidence — explicitly out of scope

No Vercel deployment, deployed-page smoke, protected-route smoke or production flag-flip evidence is included in this report, and none is claimed elsewhere for this work.

**Reason:** no owner-assigned credential source exists for UAIS. Per `AGENTS.md` ("Local API Key Source"), a session must stop and ask the owner for the approved credential source rather than reuse credentials from any other project. No deployment token, provider key, or Vercel access has been assigned for this workstream. The plan's Phase 6 S22 chain (deploy dark → env parity on Vercel → preview flag flip → deployed smoke → production flip) therefore remains **not started**, and this report makes no statement about production behaviour.

**Residual risk this leaves open:** the flag flip has never been exercised against a real deployment, so per-instance rate-limiter windows under real serverless fan-out (plan §8), external-storage v2 readiness on the live service (D3 deploy ordering), and the production share-minting 503 seam (G3) are all unverified outside the test harness. The mitigating fact is that `UAIS_LEARNING_CHATROOM_GROUPS_MODE` defaults to `off`, so shipping this tree changes no user-visible behaviour until an operator sets it.

**Owner decision needed to close it:** assign S22 a deployment package together with an approved credential source and target environment.

### Working-tree note

The feature work is uncommitted (all nine suites are untracked; `src/` changes are unstaged), per CTO decision 7 in the execution log — the goal directive was not an explicit Git assignment under `AGENTS.md`, and the Phase 0 `release:clean-check` gate is waived with that documented deviation. S11 performed **no git mutations**. Commit slicing remains an owner-assigned S25 task.

---

## 6. Recommended next actions

1. **S11 (self, next package):** close G1, G2, G4, G6, G8 — five small test additions inside `tests/`, no feature code. Roughly 10 cases.
2. **S12:** close G3 (share store production-guard pins) — the guard is server code S12 owns; S11 can write the cases once the seam is confirmed final.
3. **S01/S22:** decide G5 — `standaloneRoutes` for the export/share routes, or accept the coupling with a pin test.
4. **S04/S06:** run G9, the two-theme two-locale visual walkthrough, and record it.
5. **Owner:** assign the S22 deployment package with an approved credential source, or accept that this ships dark with no deployed evidence.
