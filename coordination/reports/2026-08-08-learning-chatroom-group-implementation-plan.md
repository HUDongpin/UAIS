# Learning Chatroom — Group Collaboration Implementation Plan

- Date: 2026-08-08
- Author: Claude (owner-directed planning session)
- Audience: Dr. Peter Hu (owner) and assigned sessions S04, S05, S08, S09, S11, S12, S13, S14, S19, S22, S24, S25
- Design reference: approved UI proposal artifact "UAIS Group Chatroom — Design Proposal" (2026-08-08)
- Status: **Approved by owner 2026-08-08** — all seven §10 decisions resolved (see decision log). Phase 0 may begin. No code changes are made by this document.

---

## 1. Goal and scope

Upgrade `/learning/chatroom` from a **per-student private room** into an **assigned-group shared room** where a small group of students and the four AI agents (研究助教 Research TA, 方法顾问 Methods Advisor, 数学助教 Math TA, 写作助手 Writing Helper) collaborate in one persistent conversation, with the approved three-zone UI (group roster / identity-rich thread / agent dock), teaching presence (the course teacher can read **and post** in group rooms), and working export/share.

**Explicitly in scope**

1. A durable `LearningGroup` entity with teacher-managed membership.
2. Group-scoped chatroom rooms (transcript persistence, authorization, agent rounds).
3. The full-bleed three-zone chatroom UI per the approved design, bilingual, light/dark.
4. Near-real-time updates via polling (no WebSocket/SSE on the current serverless stack).
5. Teacher group CRUD in the teaching workspace; student roster visibility inside a group.
6. Real export (print view) and real share links, replacing the mocks in `src/lib/chat-actions.ts`.

**Explicitly out of scope**

- True realtime (WebSockets), typing indicators, live presence heartbeats.
- Migrating existing per-student transcripts into group rooms (old rooms remain private 1:1 history; the group room is a new room kind).
- LangGraph checkpoint external-persistence latency work (S07, measurement-first, separate assignment).

---

## 2. Current state (verified 2026-08-08, with file references)

What already exists and works (all currently **uncommitted** in the root checkout):

- Route + shell: `src/app/learning/chatroom/page.tsx` → `LearningChatroomPageShell` → `LearningChatroomPage` / `HumanAiChatroom` in `src/components/pages/learning-page-chatroom.tsx` (~1180 lines, monolithic; `variant="embedded"` has no live caller).
- API: `src/app/api/learning/chatroom/route.ts` (~1142 lines). GET replays the caller's own room; POST runs a mention-routed agent round (`runAgentLoop`, max 4 turns, 45s round / 50s request budget, per-call 3–15s provider timeouts, DeepSeek `text-reasoning`), appends to the transcript on success and best-effort persists the learner message on failure.
- Room key: `{ courseId, classId?, studentId: appSession.account }`; `transcriptId = "chatroom-transcript-" + sha256(JSON.stringify([courseId, classId ?? "", studentId])).slice(0,32)` (`learning-chatroom-transcript-store.ts:165-175`). **The digest is positional — never append a field to this array.**
- Persistence: schema `uais-learning-chatroom-transcripts-v1`, rolling 200 messages/room, idempotent append per `messageId`, atomic local JSON or external snapshot store (rides `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND`); external service normalizer **hard-rejects unknown schemaVersion** (`store.ts:405-426`).
- AuthZ: `authorizeLearningAiGuideCourseAccess` (`learning-ai-guide-access.ts:50-137`) — teacher course ownership or approved student class membership; course-level only, nothing checks classId or (yet) groupId; admins denied.
- Rate limit: POST only, per actor, 6/min & 120/day defaults, env-tunable; **GET has no limiter**.
- Tests: `tests/learning-chatroom-api.test.ts` (2056 lines) and `tests/learning-chatroom-live.test.tsx` (1053 lines) with a strong DI harness (handler factories + signed test cookies + mkdtemp fixtures + injected clock; stubbed `fetch` + SessionUserProvider for live tests).

Known gaps this plan addresses:

| Gap | Where |
| --- | --- |
| No group entity anywhere in `src/` (only evidence-style `TeachingStudentGroupSuggestionRecord`, no member lists) | `teaching-course-management-types.ts:226` |
| Room key hard-wires `studentId` → per-student silos | `route.ts:262, 371-376` |
| Messages carry no author identity (`messageId/role/content/agentId/createdAt` only) | `store.ts:33-39` |
| Client hard-labels every stored student row "我/Me, self:true" | `learning-page-chatroom.tsx` (`toStoredChatMessage`) |
| No way for another member's messages to appear (history fetched once, no polling) | `learning-page-chatroom.tsx:264` |
| Teacher cannot observe any room; no observer reason code | `learning-ai-guide-access.ts` |
| Export/share mocked; share URL hard-codes `research-method-group` and `/share/*` 404s | `src/lib/chat-actions.ts` |
| Transcript append is not deadline-bounded (assigned fix, unimplemented) | `coordination/reports/2026-08-03-chatroom-transcript-append-budget-assignment.md` |
| Chatroom page renders inside `max-w-7xl` (not full-bleed); full-bleed recipe exists at `learning-page.tsx:568` but with hardcoded light-only hex | `app-shell.tsx:26`, `learning-page.tsx:568` |
| All chatroom files untracked in git | `git status` |

---

## 3. Architecture decisions (recommended)

### D1. Group entity lives in the teaching course-management database

Add `TeachingLearningGroupRecord` to `teaching-course-management-types.ts` as a new **optional** top-level array `learningGroups?:` on `TeachingCourseManagementDatabase` (the established additive pattern — old snapshots stay valid):

```ts
export type TeachingLearningGroupRecord = {
  groupId: string;                 // "group-" + bounded slug/uuid
  courseId: string;
  classId?: string;
  ownerTeacherId: string;
  groupName: string;               // bounded <= 120 chars
  members: Array<{
    studentId: string;             // must hold an approved membership in (courseId, classId)
    studentDisplayName: string;    // snapshot at assignment time
    addedAt: string;               // ISO
  }>;                              // bounded, recommended 2..12
  createdAt: string;
  updatedAt: string;
  // + standard envelope: storagePolicy / storageWritePolicy / responsibleSession: "S12" / redaction
};
```

New `TeachingCourseManagementAction` values: `"create-learning-group"`, `"update-learning-group-members"`, `"rename-learning-group"`, `"delete-learning-group"`. Handlers go in a new sibling `src/lib/server/teaching-course-management-group-handlers.ts` (read snapshot → validate teacher ownership + approved memberships → mutate → audit event → atomic write → `{record, receipt}`), re-exported through the store facade. Persistence backends (local JSON / external / postgres) come for free because groups ride the same snapshot; `teaching-course-management-database-normalizer.ts` + `record-normalizers.ts` (and the postgres store shape) must learn the new array.

**Why here and not a new store:** the chatroom authorizer already reads this snapshot on every request (`learning-ai-guide-access.ts:97-100`), so group-membership checks add **zero extra store reads** to the hot path.

### D2. Group rooms are a new room kind with their own key derivation — no data migration

Extend `LearningChatroomTranscriptRoomKey` (`learning-chatroom-transcript-runtime.ts:17-21`) with `groupId?: string`. In `createLearningChatroomTranscriptId`, add a **separate branch**:

```ts
// group rooms: shared across members; studentId is attribution, not identity
"chatroom-group-transcript-" + sha256(JSON.stringify(["group", courseId, classId ?? "", groupId])).hex.slice(0, 32)
```

Existing per-student ids are untouched (the v1 positional array is never modified). Existing per-student rooms keep working unchanged — they remain the AI-guide-style private history. **No migration script is required for launch.** If the owner later wants old private rooms folded into group rooms, that is a separate owner-approved script following the `scripts/lrs-migrate-uais-statements.mjs` pattern (dry-run default, `--live --approved`, redacted report) — deliberately deferred.

### D3. Transcript schema v2, additive, with v1-compatible reads

Messages gain author attribution:

```ts
export type LearningChatroomTranscriptMessage = {
  messageId: string;
  role: "student" | "agent";
  content: string;
  agentId?: string;
  authorId?: string;        // NEW — session account of the human author (absent on agent rows)
  authorName?: string;      // NEW — display-name snapshot at send time, bounded <= 120
  authorRole?: "student" | "teacher";  // NEW — derived server-side from the poster's session role
  createdAt: string;
};
```

Records gain `groupId?: string`. `schemaVersion` becomes `"uais-learning-chatroom-transcripts-v2"`; the normalizer **accepts v1 and v2 on read** (v1 records normalize with absent author fields) and **always emits v2**.

⚠️ **Deploy-ordering constraint:** the external-storage PUT handler normalizes the incoming database (`external-storage-route-service.ts:506`) and v1 code hard-rejects v2 — and would silently strip unknown fields if we tried to smuggle them into v1. If the external-storage service runs as a **separate UAIS deployment** (see `coordination/reports/2026-08-02-lrs-dedicated-instance-runbook.md` precedent), it must be deployed with v2-aware code **before or together with** the app. Same-app deployments get this for free.

### D4. API surface: extend the existing route; groups arrive via the courses endpoint

- `GET /api/learning/chatroom?courseId=&classId=&groupId=` — group history when `groupId` present, else legacy per-student room. Validation mirrors `readLearningChatroomClassId` (≤200 chars).
- `POST /api/learning/chatroom` — body gains optional `groupId`. Round flow, budgets, mention routing, rate limiting: unchanged. The append stamps `authorId: appSession.account`, `authorName: appSession.displayName` on student rows.
- **Group discovery:** extend `GET /api/teaching/courses` student projection with a narrowed `StudentVisibleGroup` (following the projection-comment discipline at `courses/route.ts:89-124`):

```ts
type StudentVisibleGroup = {
  groupId: string; courseId: string; classId?: string; groupName: string;
  members: Array<{ displayName: string; isSelf: boolean }>;  // co-members of YOUR groups only
};
```

Teachers receive full `learningGroups` records for owned courses. No new discovery route; the chatroom client already parses this response (`fetchUsableChatroomCourses`).

- GET responses echo `groupId` and add `members` (from the group record) so the roster panel needs no extra request.

### D5. Authorization layers on top of the existing course gate

Keep `authorizeLearningAiGuideCourseAccess` exactly as the course-level gate (both handlers, `route.ts:246-254, 361-369`). When `groupId` is present, add a second check **on the same already-loaded snapshot**:

- **Student:** must appear in `group.members` (and group must belong to the courseId/classId in the request) → new reason codes `student-group-membership-approved` / denial `student-group-membership-required`.
- **Teacher (owner decision 2026-08-08: full participant):** must own the course → `teacher-group-participant-approved`; GET **and POST** both allowed — the owner wants teaching presence in group rooms. Teacher rows are stamped `authorRole: "teacher"` **server-side from the session role** (the wire request keeps `role: "student" | "agent"`, so mention routing in `selectNextAgent` — which scans the last student-role message — is untouched and teachers can @mention agents too). The UI renders teacher rows with an instructor chip. Teacher posts count against the same per-actor rate limits (educator actor); xAPI `collaboration.contributed` stays student-only (learning records track learners).
- Admin: stays denied.

### D6. Multi-writer semantics and liveness: polling + existing idempotent append

- **Polling:** client polls `GET` every 5s while the room is visible (pause on `document.visibilitychange: hidden`; resume+immediate fetch on visible), merging by `messageId` (the dedupe-and-prepend logic already exists at `learning-page-chatroom.tsx:264-320`). Poll results also refresh agent "replied" status in the dock.
- **Concurrent appends:** the store's optimistic 409 retry (`store.ts:238-316`) is raised from `maxAttempts 2 → 4` **for group rooms** (several writers make single-retry insufficient).
- **Concurrent agent rounds:** allowed (two members may trigger rounds simultaneously; per-actor rate limits bound cost). A per-room in-process round lock is a Phase 6 hardening option, not a launch blocker.
- **Client POST payload:** unchanged model — the client posts its visible history; the server appends only never-stored ids. Other members' rows round-trip harmlessly (already stored → deduped).
- **GET rate limiting (required once polling ships):** add a limiter to GET with polling-friendly defaults (suggest 30/min, 2000/day per actor; env `UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_*`, same `createAiRequestRateLimiter` machinery).

### D7. Message cap per group room

Keep the rolling window but raise the **group-room** constant to 500 (a 6-member group burns 200 messages quickly; the composer round still only sends the newest 50 to the provider). Local/external storage cost is bounded (500 × 4000 chars worst case ≈ 2 MB/room). Owner may veto — see §10.

### D8. Export and share become real

- **Export (launch):** a print-view route `src/app/learning/chatroom/export/page.tsx` (`?courseId=&classId=&groupId=`) rendering the transcript in a clean print stylesheet; the Export PDF button opens it and calls `window.print()`. No PDF service, no credentials, works offline. **Owner decision 2026-08-08: pursue true server-side PDF as well** — S24 proposes the rendering approach in Phase 5 (serverless headless-chromium vs. external PDF service); any credential or paid-service need returns to the owner as a blocker report per AGENTS.md before implementation. The print view ships first regardless.
- **Share:** new `LearningChatroomShareRecord { shareId, courseId, classId?, groupId, createdBy, createdAt, revokedAt? }` persisted beside transcripts; `POST /api/learning/chatroom/share` (member-only) mints it; `/share/[shareId]` is a **read-only, signed-out-viewable** page rendering a snapshot with author display names but no account ids. `createShareLink` in `chat-actions.ts` is replaced by the real call. Share links are revocable by the creating member or the course teacher.

### D9. Feature flag for safe rollout

`UAIS_LEARNING_CHATROOM_GROUPS_MODE` (optional-live-ai tier; default `off`). When off: API rejects `groupId` requests with a 403 `feature-not-enabled` reason, the teaching UI hides the group panel, and the chatroom renders the current per-student behavior. This lets Phases 1–3 merge and deploy dark, then flip on after Phase 6 checks. All new env names must be added to `src/lib/release/env-surface.ts` + `docs/env-surface.md` + `.env.local.example` in exactly one tier (S19/S10 rule) — note that `UAIS_TEACHING_COURSES_DATA_DIR` and `UAIS_LEARNING_CHATROOM_TRANSCRIPTS_DATA_DIR` are **already missing from the catalog** and should be back-filled in Phase 0.

---

## 4. Phased delivery

Dependencies: `P0 → P1 → P2 → P3 → P6`; P4 can run parallel to P3 after P1; P5 after P2 (share) / P3 (export button).

### Phase 0 — Baseline, intake, and debt (S25, S12, S10/S19, S22)

The chatroom feature set is entirely untracked in git. Nothing else should build on uncommitted ground.

1. **S25:** dirty-tree inventory + slice recommendation for the existing chatroom work (`npm run release:dirty-map -- --reason "chatroom group intake"`); owner approves commit slices; commits executed only under explicit owner Git assignment.
2. **S12:** implement the **assigned transcript-append budget fix** (Option A route-side `Promise.race` per the 2026-08-03 assignment: cutoff ≈53s, `{status:"unavailable"}` short-circuit, catch-path mirrored, 4 pinning tests). This is a prerequisite: group rooms increase append frequency and size.
3. **S12 (small):** add the GET rate limiter (D6) — it becomes load-bearing the moment polling ships.
4. **S10/S19:** back-fill `UAIS_TEACHING_COURSES_DATA_DIR` + `UAIS_LEARNING_CHATROOM_TRANSCRIPTS_DATA_DIR` into the env-surface catalog/docs; reserve the new names from this plan (`UAIS_LEARNING_CHATROOM_GROUPS_MODE`, `UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_*`).
5. **Gate:** `npm run release:clean-check` passes; `npm run lint`, `npm run test`, `npm run build` green on the committed baseline.

### Phase 1 — Group entity + teacher CRUD API (S12 backend, S08 type coordination)

Files: `teaching-course-management-types.ts` (+record, +actions, +optional array), `teaching-course-management-group-handlers.ts` (new), database/record normalizers, postgres store shape, store facade re-exports, new REST routes following the classes pattern:

- `POST /api/teaching/courses/[courseId]/groups` — create (name + member list).
- `PATCH /api/teaching/courses/[courseId]/groups/[groupId]` — rename / replace members.
- `DELETE /api/teaching/courses/[courseId]/groups/[groupId]` — delete (transcript record is retained but orphaned; room becomes inaccessible).
- `GET /api/teaching/courses` — teacher full records; student `StudentVisibleGroup` projection (D4).

Validation: members 2–12, every member holds an **approved** membership in the course (and class when `classId` set); duplicate member rejected; bounded lengths everywhere (ids ≤200, names ≤120); every mutation appends an audit event.

Tests (new `tests/teaching-learning-groups-api.test.ts`, house harness): CRUD happy paths + receipts, ownership denial, non-approved-member rejection, bounds, student projection narrowing (no other-group leakage, no studentIds in projection), snapshot round-trip through the normalizer, audit events.

**Acceptance:** a teacher can create/edit/delete groups via API; students see only their own groups with co-member display names; `npm run lint && npm run test && npm run build` green.

### Phase 2 — Group room backend (S12)

Files: `learning-chatroom-transcript-runtime.ts` (key type + conditional spreads at :52/:90), `learning-chatroom-transcript-store.ts` (id branch, v2 schema + v1-tolerant normalizer, author fields incl. `authorRole`, group cap 500, retry 4), `learning-chatroom-transcript-external-store.ts` (no contract change — snapshot-shaped), `external-storage-serialization.ts` / route-service normalizer parity, `route.ts` (parse `groupId` in `parseLearningChatroomRequest` :976-1027 and `parseLearningChatroomHistoryQuery` :910-924; room construction :256-264 and :371-376 — the catch-path reuses `transcriptRoom` so one change covers both appends; author/`authorRole` stamping from the session; group members echoed in GET), `learning-ai-guide-access.ts` (+group check + teacher-participant reason codes, D5), feature flag gate (D9).

Tests (extend `tests/learning-chatroom-api.test.ts` or new sibling `learning-chatroom-group-api.test.ts`): two members share one room (A posts, B's GET replays it with A's `authorName`); group denial for non-member; teacher owner GET **and POST** allowed with rows stamped `authorRole: "teacher"`, foreign teacher denied; teacher @mention routes agents normally; legacy per-student rooms bit-identical before/after (regression pin on transcriptId derivation!); v1 database read-normalizes to v2; author fields bounded; flag off → 403 `feature-not-enabled`; concurrent append with 409-retry fixture; group cap 500.

**Acceptance:** with the flag on in dev, two signed-in student accounts in one seeded group converse in one room through real handlers (fixture-driven test proves it); all legacy tests still green.

### Phase 3 — Chatroom UI redesign (S04 primary; S09 copy; S06 token consultation)

Step 1 — **extract, don't rewrite:** pull the headless logic (course resolution, history restore, room-switch tokens, send round, handle maps, xAPI emission — the verified-separable list) into `src/components/pages/use-learning-chatroom.ts`; the monolith's JSX (lines ~508-770) is then replaced wholesale. Drop the vestigial `embedded` variant (no caller) — one full-page component.

Step 2 — **new layout** per the approved artifact:

- Full-bleed shell escape copying the `learning-page.tsx:568` recipe but **tokenized** (`bg-[var(--background)]`, not `#f7f8fd`) for dark-theme correctness.
- Three-zone grid `xl:grid-cols-[244px_minmax(0,1fr)_284px]`; room header (group name, course chip, pinned focus, member facepile, Export/Share, back); left roster (members with `isSelf` highlight, teacher observer chip, agent list with round status); center thread; right agent dock (specialties + one-tap @mention, status from last round); composer (mention chips, 4000-char counter, transcript note).
- **Identity rendering:** humans = circles, agents = rounded squares; self-detection switches from "every student row is me" to `authorId === sessionUser.account`; other members render `authorName` with initial-avatars (deterministic hue from a small component-level map — `AiAgent` has no color field; agent hues: research violet / methods teal / math amber / writing rose per the design).
- **Mention chips:** render `@handles` in bubbles as chips (the plain-text `replaceAll` localization in `getLocalizedChatMessageText` becomes a tokenizer that emits chip spans).
- **Polling:** 5s visible-tab interval per D6, wired through the existing dedupe merge; `roomChangeCount` tokens already guard stale responses.
- **Group picker:** resolution flow gains a group step (course → group when >1 group; URL `?groupId=` deep link; demo fallback keeps the seeded `chatMessages` transcript, which already reads as a group conversation).
- Teaching presence: teachers get the composer like members; their messages render with an instructor chip (教师 Teacher), and the roster lists the instructor above the member rows.
- A11y: `role="log"` + `aria-live="polite"` thread, labeled regions, focus-visible rings, `prefers-reduced-motion` on the thinking dots.

Step 3 — **copy (S09):** new `learning.*` keys (zh-CN authoritative, en-US paired): `groupMembers` 小组成员 | Members, `groupAgents` 智能体 | AI Agents, `groupInstructorBadge` 教师 | Teacher, `groupInstructorRow` 授课教师 | Instructor, `groupPickerLabel` 选择小组 | Choose your group, `groupNoGroup` 你还没有被分入小组，请联系老师。| You haven't been assigned to a group yet. Ask your teacher., `groupYou` 我 | you, `exportPrintHint` 使用浏览器打印为 PDF | Use your browser's print dialog to save as PDF, plus roster status strings. Existing keys (chatTitle, inputPlaceholder, exportPdf, shareLink, agentThinking…) are reused as-is.

Tests (extend `learning-chatroom-live.test.tsx` / new `learning-chatroom-group-live.test.tsx`): group resolution + picker + deep link; other-member message renders with author name and non-self alignment; self-detection by account; polling merge (fake timers advance → new GET → message appears; hidden tab pauses); teacher view renders composer and instructor chip on teacher rows; mention chip rendering both locales; roster renders members from GET.

**Acceptance:** visual walkthrough on `npm run dev` matches the approved artifact in both themes and locales; all live tests green; `npm run lint` + `npm run build` green (route/app-shell change).

### Phase 4 — Teaching workspace group management UI (S13/S05 coordination, S14 student surfaces)

- Group panel in `teaching-page-course-settings-workspace.tsx` + dialogs: list groups per class, create (name + pick from **approved** membership rows), edit members, rename, delete; handlers in `use-teaching-workspace.tsx` following the `createClassForCourse`/`approveClassMembership` receipt-and-readback verification pattern.
- "Students" operation page (`teaching-operation-page-data.ts`) links to the real panel; the existing `generate-student-group-suggestions` receipt action can pre-fill a draft grouping (suggestion → teacher edits → create), but auto-assignment stays teacher-reviewed.
- Student dashboard "Group Signal" card (`student-dashboard-page.tsx`) shows the real group name + members + "进入聊天室 Open Chatroom" deep link (`/learning/chatroom?courseId=…&groupId=…`).
- Copy through S09; tests: workspace interaction tests per house pattern.

**Acceptance:** a teacher creates a group entirely through the UI and a member student lands in the group room via the dashboard link.

### Phase 5 — Real export and share (S24 asset/export quality, S12 share records, S04 buttons)

- Print-view export route + print stylesheet; Export button wiring; transcript header (course, group, members, date range, UAIS branding), agent turns labeled; verified in light theme print.
- Share records + `POST /api/learning/chatroom/share` + public read-only `/share/[shareId]` page (no session required, no account ids rendered, revocable); `chat-actions.ts` mocks deleted; `copied`/`exported` copy keys updated by S09 to drop the "mocked" phrasing.
- Tests: share mint/revoke/authz (member-only mint, revoked link 404s), share page renders snapshot, export route authz.
- Owner decision on true PDF service deferred (see §10) — print view ships regardless.

**Acceptance:** Export produces a printable transcript; Share produces a working, revocable public link scoped to the actual room (the hardcoded `research-method-group` URL is gone).

### Phase 6 — Hardening and release (S11 QA matrix, S22 release, S19 env, S10 report)

- S11: regression matrix covering the ten scenario families in §7; flags coverage gaps.
- S22: deploy dark (flag off) → verify env parity on Vercel (S19: flag + rate-limit vars + external-storage v2 readiness) → flip flag in preview → deployed smoke (two real accounts, one group, one round, export, share) → production flip; deployment evidence report.
- Optional hardening if smoke shows contention: per-room round lock; poll interval backoff.
- S10: president-report summary + this plan marked delivered.

**Acceptance:** production `/learning/chatroom` serves group rooms with the new UI; release-gate evidence refreshed; `npm run lint/test/build` green.

---

## 5. API contract summary (deltas only)

**POST /api/learning/chatroom** request: `{ locale, courseId, classId?, groupId?, messages[] }` — `groupId` ≤200 chars, requires flag on, membership enforced. Response unchanged except `transcript` receipt may reference the group room; agent turn shape unchanged.

**GET /api/learning/chatroom** query: `?courseId&classId?&groupId?`. Response gains, for group rooms:

```jsonc
{
  "courseId": "…", "classId": "…", "groupId": "…",
  "groupName": "…",
  "members": [{ "displayName": "林若晨", "isSelf": false }, …],
  "messages": [{ "id", "role", "content", "agentId?", "authorName?", "authorRole?", "isSelf", "createdAt" }, …],
  "transcript": { "status": "loaded", "messageCount": 42, "storagePolicy": "…" },
  "redaction": { … }
}
```

(`isSelf` computed server-side from `authorId === appSession.account`; raw `authorId` is **not** returned to clients — display names only.)

**New:** `POST /api/teaching/courses/[courseId]/groups`, `PATCH/DELETE …/groups/[groupId]`, `POST /api/learning/chatroom/share`, public `GET /share/[shareId]` page. **Extended:** `GET /api/teaching/courses` (groups projections). **Error contract:** all existing statuses/bodies preserved; new 403 denial reason codes `student-group-membership-required`, `feature-not-enabled`; new authorized reason codes `student-group-membership-approved`, `teacher-group-participant-approved`.

---

## 6. New/changed environment surface (S19 tier placement)

| Variable | Tier | Default | Purpose |
| --- | --- | --- | --- |
| `UAIS_LEARNING_CHATROOM_GROUPS_MODE` | optional-live-ai | `off` | Feature flag (D9) |
| `UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_MODE/_PER_MINUTE/_PER_DAY` | optional-live-ai | on / 30 / 2000 | GET polling limiter (D6) |
| `UAIS_TEACHING_COURSES_DATA_DIR` | back-fill (existing, uncataloged) | `.tmp` path | Phase 0 catalog debt |
| `UAIS_LEARNING_CHATROOM_TRANSCRIPTS_DATA_DIR` | back-fill (existing, uncataloged) | falls back to above | Phase 0 catalog debt |

No new secrets. Storage continues to ride `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND` + `UAIS_EXTERNAL_STORAGE_*`.

---

## 7. Test plan (S11 matrix skeleton)

Scenario families, each with API + live coverage where applicable:

1. Group CRUD + validation + audit (P1).
2. Group room share semantics: multi-member read/write, author attribution, idempotent re-posts (P2).
3. AuthZ matrix: member / non-member / other-group member / teacher owner / foreign teacher / admin / signed-out × GET/POST × flag on/off (P2).
4. Legacy regression: per-student rooms and transcriptIds byte-stable; all existing chatroom tests green untouched (P2).
5. Schema: v1→v2 read tolerance, v2 round-trip through external snapshot PUT normalizer (P2).
6. Budgets: append race fix pinning tests (P0) + group-append within budget (P2).
7. UI: rendering identity/mentions/roster/teacher-presence/picker/polling, both locales, reduced motion (P3).
8. Teaching UI: group panel receipt-and-readback flows (P4).
9. Export/share: mint/revoke/public render/authz (P5).
10. Rate limits: GET limiter windows + POST limiter unchanged (P0/P2).

House rules: DI factories + signed test cookies + mkdtemp fixtures + injected clocks; no real env, no sleeps; `expectNoCredentialValues` on every new response family; suites live flat in `tests/`.

---

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| External-storage service on stale v1 normalizer strips/rejects v2 databases | Deploy ordering rule in D3; Phase 6 S22 checks external readiness before flag flip; v1-tolerant read everywhere |
| Concurrent member writes → 409 storms on the snapshot store | Retry 4 for group rooms; whole-DB snapshot store is the ceiling — if real contention appears, the postgres backend path (already scaffolded for course management) is the escalation, owner decision |
| Polling × members × 5s vs serverless in-process rate limiter (per-instance windows) | Polling-friendly GET defaults (30/min); hidden-tab pause; documented per-instance ceiling caveat (same as POST today) |
| Provider cost scales with group size (each member can trigger rounds) | Per-actor POST limits unchanged (6/min, 120/day); round budget unchanged; monitor via existing structured logs |
| Member display-name privacy (students see co-members' names) | Scoped to co-members of the same group only; no account ids in any client payload; owner sign-off in §10 |
| Group deleted while members are in the room | Next GET/POST returns the membership denial; client shows the existing access-denied copy; transcript retained server-side |
| 200→500 cap change alters rolling-window behavior | Group-only constant; legacy rooms keep 200; pinned in tests |
| Uncommitted foundation drifts under parallel sessions | Phase 0 intake first; AGENTS.md one-writer-per-file rule; phases map to disjoint write scopes (§9) |

---

## 9. Session assignment map (write scopes per AGENTS.md)

| Phase | Session | Write scope (delta) | Forbidden |
| --- | --- | --- | --- |
| P0 | S25 | `coordination/release-intake/`, reports | any git mutation without owner assignment |
| P0 | S12 | `src/app/api/learning/chatroom/route.ts`, `src/lib/server/learning-chatroom-*`, targeted tests | UI files, uais.ts, copy.ts |
| P0 | S10/S19 | env-surface catalog, docs, `.env.local.example` | feature code |
| P1 | S12 (+S08 review) | `teaching-course-management-{types,group-handlers,normalizers,store,postgres-store}.ts`, `src/app/api/teaching/courses/**`, `tests/teaching-learning-groups-api.test.ts` | chatroom UI, copy.ts |
| P2 | S12 | chatroom route + transcript store/runtime/external serialization, `learning-ai-guide-access.ts`, group API tests | UI files |
| P3 | S04 (+S09 copy, +S06 consult) | `learning-page-chatroom.tsx`, new `use-learning-chatroom.ts`, `src/app/learning/chatroom/**`, chatroom live tests; S09: `src/i18n/copy.ts` | server files, teaching workspace |
| P4 | S13/S05 (+S14) | `teaching-page-course-settings-workspace.tsx`, `use-teaching-workspace.tsx`, dialogs, `teaching-operation-page-data.ts`, `student-dashboard-page.tsx` | chatroom API/UI |
| P5 | S24 (+S12 share records, +S04 buttons) | export route/page, share route/page, `src/lib/chat-actions.ts`, export tests | provider code |
| P6 | S11/S22/S19/S10 | `tests/`, release reports, deployment evidence, env parity docs | feature code |

Shared-file collisions to schedule serially: `src/i18n/copy.ts` (S09 owns; P3 then P4 then P5 batches), `src/data/uais.ts` (only if demo group seeds are added — S08), `tests/` structure (S11 sign-off on new suite names).

---

## 10. Owner decision log (all resolved by Dr. Peter Hu, 2026-08-08)

| # | Decision | Owner's call | Plan impact |
| --- | --- | --- | --- |
| 1 | Co-member display-name visibility inside a group | **Yes** | D4 projections stand as specified |
| 2 | Teacher voice in group rooms | **Teachers post — teaching presence required** | D5 rewritten: `teacher-group-participant-approved` (GET+POST); `authorRole: "teacher"` stamping; instructor chip in UI (P2/P3) |
| 3 | Group room message cap | **500** | D7 stands (legacy rooms keep 200) |
| 4 | Feature flag | **Approved:** `UAIS_LEARNING_CHATROOM_GROUPS_MODE`, optional-live-ai tier, default `off` | D9 stands; S19 catalogs the name |
| 5 | Transcript schema v2 (`groupId` + author fields) | **Approved** | D3 stands, incl. the external-storage deploy-ordering rule |
| 6 | True PDF export | **Approved — pursue real server-side PDF** | D8/P5 updated: print view ships first; S24 proposes the rendering approach; credential/cost needs return as a blocker report |
| 7 | Phase 0 git intake | **S25 approved to execute commit slices** | P0 unblocked; S25 follows the release protocol (dirty-map first, explicit pathspec staging, no `git add .`) |

No open decisions block Phase 1. Ready-to-assign packages for Phase 0 and Phase 1 are in Appendix A.

---

## 11. Definition of "functional" (overall acceptance)

1. A teacher creates "Group 3" in 大学研究方法, assigns three approved students.
2. Each student opens `/learning/chatroom`, resolves to the shared Group 3 room, and sees the same transcript with correct names, avatars, and self-alignment.
3. Any member mentions `@方法顾问`; the agent's reply appears for every member within one poll interval; agent status shows in roster and dock.
4. The teacher opens the same room and posts a guidance message; every member sees it rendered with the instructor chip.
5. Refresh/re-login replays the full room (rolling window) from persistent storage; two members posting simultaneously lose nothing.
6. Export produces a printable transcript (and a true PDF once the S24 approach lands); Share produces a working revocable public link.
7. Both locales, both themes, keyboard-navigable; `npm run lint`, `npm run test`, `npm run build` green; deployed smoke evidence recorded by S22.

---

## Appendix A — Ready-to-assign session packages (Phase 0 and Phase 1)

Owner approval for all four packages was given 2026-08-08 (§10). Each package follows the AGENTS.md Session Assignment Template and may be handed to its session verbatim.

### A.1 — S25: chatroom release intake (Phase 0, run FIRST)

- Date: 2026-08-08
- Session ID: S25
- Workstream: Git hygiene and release intake
- Objective: move the untracked learning-chatroom feature set onto committed ground in reviewable slices.
- Allowed write scope: `coordination/release-intake/`, `coordination/reports/`, git staging/commit of the approved slices ONLY (owner authorization recorded in §10 item 7 of this plan).
- Forbidden write scope: any feature-code edit; any `.env*` or secret-like file (inventory by redacted category only); `git add .` (explicit pathspecs only).
- Procedure: `npm run release:clean-check` → `npm run release:dirty-map -- --reason "chatroom group intake"` → produce slice map (suggested slices: ① chatroom API+server libs+API tests, ② chatroom UI+shell+live tests, ③ external-storage transcript route, ④ coordination/report docs) → commit each slice with explicit pathspecs.
- Acceptance criteria: `git status --short --untracked-files=all` clean of chatroom feature files; each commit message references this plan; intake inventory published under `coordination/release-intake/`.
- Required checks: `npm run lint`, `npm run test`, `npm run build` on the final committed tree.
- Stop conditions: any file whose owner-session mapping is ambiguous; any secret-like file in a proposed slice; merge conflict.

### A.2 — S12: append budget fix + GET rate limiter (Phase 0, after A.1)

- Date: 2026-08-08
- Session ID: S12
- Workstream: Backend/API platform
- Objective: implement the 2026-08-03 transcript-append budget fix (Option A route-side race, ~53s cutoff, catch-path mirrored) and add a GET history rate limiter (defaults 30/min, 2000/day, env `UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_MODE/_PER_MINUTE/_PER_DAY`, reusing `createAiRequestRateLimiter`).
- Allowed write scope: `src/app/api/learning/chatroom/route.ts`, `src/lib/server/learning-chatroom-transcript-runtime.ts` (comments only if needed), `tests/learning-chatroom-api.test.ts` (the four pinning tests + limiter tests).
- Forbidden write scope: UI files, `src/data/uais.ts`, `src/i18n/copy.ts`, transcript schema (that is Phase 2), external-storage HTTP contract.
- Acceptance criteria: per the 2026-08-03 assignment's acceptance list; GET limiter enforces windows and `off` mode; all existing tests green.
- Required checks: targeted vitest, `npm run test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- Stop conditions: evidence the fix requires changing the external-storage HTTP contract; unconfirmable append idempotency.

### A.3 — S10/S19: env-surface catalog back-fill (Phase 0, parallel to A.2)

- Date: 2026-08-08
- Session ID: S10 (docs/config) with S19 review (tier placement)
- Workstream: Tooling/docs + API configuration
- Objective: catalog `UAIS_TEACHING_COURSES_DATA_DIR` and `UAIS_LEARNING_CHATROOM_TRANSCRIPTS_DATA_DIR` (back-fill), and reserve `UAIS_LEARNING_CHATROOM_GROUPS_MODE` + `UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_*` (optional-live-ai tier, owner-approved §10 item 4).
- Allowed write scope: `src/lib/release/env-surface.ts`, `docs/env-surface.md`, `.env.local.example`, `tests/env-surface.test.ts` expectations.
- Forbidden write scope: feature code; real env files; secret values anywhere.
- Acceptance criteria: every new/back-filled name appears in exactly one tier in catalog + doc + example file; env-surface tests green.
- Required checks: `npm run test`, `npm run lint`.
- Stop conditions: a name appears to belong to two tiers; any doc change would expose a real value.

### A.4 — S12 (+S08 type review): LearningGroup entity + teacher CRUD API (Phase 1, after A.1–A.3)

- Date: 2026-08-08
- Session ID: S12 primary; S08 reviews the shared type additions
- Workstream: Backend/API platform
- Objective: `TeachingLearningGroupRecord` (per plan D1: members 2–12, approved-membership validation, audit events), group handlers file, normalizer/postgres parity, REST routes `POST/PATCH/DELETE /api/teaching/courses/[courseId]/groups[/groupId]`, and the `StudentVisibleGroup` / teacher projections in `GET /api/teaching/courses`.
- Allowed write scope: `src/lib/server/teaching-course-management-{types,store,database-normalizer,record-normalizers,postgres-store}.ts`, new `src/lib/server/teaching-course-management-group-handlers.ts`, `src/app/api/teaching/courses/**`, new `tests/teaching-learning-groups-api.test.ts`.
- Forbidden write scope: chatroom route/store (Phase 2), all UI files, `src/i18n/copy.ts`, `src/data/uais.ts` (S08 owns; only the type review touches shared semantics).
- Acceptance criteria: Phase 1 acceptance block in §4 of this plan; student projection leaks no other-group data and no account ids.
- Required checks: targeted vitest, `npm run test`, `npm run lint`, `npm run build`.
- Stop conditions: postgres store shape cannot absorb the new array without a schema decision; any need to touch the chatroom room key early.
