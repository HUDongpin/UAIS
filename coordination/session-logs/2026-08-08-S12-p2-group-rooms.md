# Agent Daily Work Report

- Date: 2026-08-08
- Session ID: S12
- Workstream: Backend/API platform — Phase 2 of the Learning Chatroom Group Implementation Plan (group-scoped chatroom rooms)
- Status: Completed
- Objective: Deliver group rooms end to end behind `UAIS_LEARNING_CHATROOM_GROUPS_MODE` per plan D2–D7 + D9 and the CTO execution-log decisions — group room key, transcript schema v2, group caps and retry, group authorization layer, route parsing/threading/response shaping, and a new test suite.

## Summary of work completed

1. **Room key (D2).** `LearningChatroomTranscriptRoomKey` gained `groupId?`; both runtime call sites spread it conditionally.
2. **Transcript id (D2).** `createLearningChatroomTranscriptId` now has a separate group branch:
   `"chatroom-group-transcript-" + sha256(JSON.stringify(["group", courseId, classId ?? "", groupId])).slice(0,32)`.
   The per-student positional array is untouched; a regression pin asserts two known legacy ids byte-for-byte.
3. **Schema v2 (D3).** Messages gained optional `authorId` / `authorName` (≤120); records gained `groupId?`. `schemaVersion` is now `uais-learning-chatroom-transcripts-v2`. The normalizer accepts v1 **and** v2 on read (v1 rows normalize with absent author fields), rejects anything else, and always emits v2. No change was needed in `external-storage-serialization.ts`, `external-storage-route-service.ts` or the external-storage route file: the PUT handler funnels its body through this same normalizer, so v2 acceptance and v1 tolerance came for free. The `scripts/external-storage-service.mjs` reference service does not serve chatroom transcripts at all, so it needed no change either.
4. **Caps and retry (D7, CTO decision 3).** Rolling window 500 for group rooms, 200 unchanged for per-student rooms (resolved per record, so the read normalizer trims correctly too). Optimistic 409 retry raised to 4 attempts for group rooms, 2 unchanged for legacy.
5. **Retry budget.** The store append accepts an optional `retryBudgetMs` **duration** (not an absolute deadline — an absolute one would be in the route's injected-clock domain and would misfire under test injection). It only refuses to start another retry; it never cancels an in-flight call. The route's `Promise.race` in `persistLearningChatroomHistoryWithinBudget` remains the single deadline authority and now hands the same budget to the append.
6. **Authorization (D5).** The existing course gate is byte-for-byte unchanged. When `groupId` is present, a second gate runs on the snapshot the course gate already loaded (zero extra store reads). New authorized codes `student-group-membership-approved` / `teacher-group-observer-approved`; new denials `student-group-membership-required`, `teacher-group-observer-required`, `teacher-group-observer-read-only`, `feature-not-enabled`. Admin stays denied by the existing role check. The published-demo teacher shortcut is skipped for group requests (it answers without reading the store and so cannot resolve a group).
7. **Route.** `groupId` parsed in both `parseLearningChatroomRequest` and `parseLearningChatroomHistoryQuery` (≤200, mirroring `readLearningChatroomClassId`). Room construction is shared by both handlers; because the POST catch path reuses the same room object, one change covered both appends. Student rows are stamped with `authorId` + `authorName` at append time in group rooms only. GET echoes `groupId`, `groupName`, `members` and adds `authorName?` + server-computed `isSelf` per message for group rooms; `authorId` is never returned.
8. **Feature flag (D9).** `UAIS_LEARNING_CHATROOM_GROUPS_MODE` — only an explicit `on` (case-insensitive, trimmed) enables group rooms; everything else is off. Injected through the existing handler-factory `env` dep, so tests flip it with no real env. A legacy request without `groupId` behaves exactly as today whatever the flag says.

## Files changed

- `src/app/api/learning/chatroom/route.ts`
- `src/lib/server/learning-chatroom-transcript-runtime.ts`
- `src/lib/server/learning-chatroom-transcript-store.ts`
- `src/lib/server/learning-ai-guide-access.ts`
- `tests/learning-chatroom-group-api.test.ts` (new, 23 tests)
- `coordination/session-logs/2026-08-08-S12-p2-group-rooms.md` (this log)

Not changed (verified unnecessary): `learning-chatroom-transcript-external-store.ts`, `external-storage-serialization.ts`, `external-storage-route-service.ts`, `src/app/api/external-storage/learning-chatroom-transcripts/database/route.ts`, `tests/learning-chatroom-api.test.ts`.

## Checks run

- `npx vitest run tests/learning-chatroom-group-api.test.ts` — 23 passed.
- `npx vitest run tests/learning-chatroom-api.test.ts tests/learning-chatroom-live.test.tsx` — 86 passed, **no test file edits required**.
- `npx vitest run tests/external-storage-*.test.ts` — 13 files, 92 passed; plus the two `tests/owner-decision-external-storage-*.test.ts` files — 9 passed.
- `npx vitest run tests/env-surface.test.ts tests/teaching-learning-groups-api.test.ts tests/production-release-gate.test.ts` — 413 passed.
- `npx vitest run tests/ai-api-routes.test.ts tests/learning-ai-guide-hitl-thread-scope.test.ts tests/learning-page.test.tsx tests/learning-page-events.test.tsx tests/enterprise-closed-loop-regression.test.ts` — 205 passed.
- `npm run test` (full suite) — 169 files passed | 3 skipped; 2199 passed | 5 skipped. Wave 1 baseline was 168 files / 2176 passed, so the delta is exactly the new suite (+1 file, +23 tests) with no regressions.
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.

## Checks not run

- `npm run build` — deliberately left to the CTO's full gate, per assignment.
- Live provider / deployment smoke — no credentials, and the flag defaults off.

## Assumptions

- For a group room the **group record's** `classId` is authoritative and a query-string `classId` is ignored for room derivation. Otherwise a client that omitted `classId` would derive a second, empty copy of the same group's room. The GET response echoes the group's `classId` so the client can self-correct.
- `authorName` is the session display name (per assignment), not the group record's membership snapshot. Both are bounded to 120.
- Author fields are written for group rooms only; a per-student room has exactly one possible author and gains nothing from them.
- `teacher-group-observer-approved` is observable only as behaviour (GET 200 with roster), because a 200 response carries no `access` envelope.

## Risks

- **Deploy ordering (plan D3):** an external-storage service still running v1 code would reject a v2 database. In this repo the handler ships in-app, so same-app deploys are safe; a split deployment must ship the storage side first.
- **Re-attribution race (theoretical):** the client posts its whole visible history and every new student row is attributed to the poster. Another member's message can only ever reach a client through a GET, which means it was already stored with its own author, and the append skips ids the room already holds — so the race is not reachable through the real client flow. A hand-crafted POST could still author a never-stored row on someone else's behalf, which is correct behaviour (the poster is the author).
- **Polling vs the GET limiter:** 30/min per actor per instance. A 5s poll is 12/min, so one open room plus a manual refresh fits, but two tabs on the same account will 429.
- **Group cap 500 × external snapshot:** a full group room is roughly 2 MB worst case and the whole snapshot is rewritten on every append. Contention beyond the 4 retries is the escalation trigger for the postgres path (owner decision).

## Coordination notes for other sessions

- **S19/S10:** the `UAIS_LEARNING_CHATROOM_GROUPS_MODE` catalog entry in `src/lib/release/env-surface.ts` still says "Reserved …". The code now reads it, so that wording can be dropped (CTO said they would clean it up after Wave 2). I did not touch the catalog — out of my write scope.
- **S04 (Phase 3):** the GET contract for group rooms is in the handoff report; `isSelf` is server-computed, so the client must stop deciding self-ness itself.
- **S24/S12 (Phase 5):** export and share must read `authorName`/`isSelf` from GET, never an account id, and must resolve the room by explicit `groupId`.

## Follow-up recommendations

1. Phase 3 UI on the response shapes below.
2. Optional Phase 6 hardening: per-room round lock if deployed smoke shows contention.
3. Owner decision if teachers should later be allowed to post — the server denial `teacher-group-observer-read-only` is the single switch.

## Next suggested owner/session

S04 (Phase 3 chatroom UI), with S09 for copy.
