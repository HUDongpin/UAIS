# Follow-up Assignment — Teacher Participation in Group Chatrooms (B1)

- Date: 2026-08-08
- Raised by: S25 release intake (`coordination/release-intake/2026-08-08-chatroom-groups-intake.md`, finding F2 / blocker B1)
- Owner ruling: **commit the feature as built, then flip teacher posting in this follow-up** (2026-08-08)
- Plan reference: `coordination/reports/2026-08-08-learning-chatroom-group-implementation-plan.md` §D5, P2, P3
- Sessions: **S12** (server, primary) → **S04** (client) → **S09** (copy) → **S11** (matrix refresh)

---

## Why this exists

The owner's decision on plan §10 item 2 was: *"TeacherS can send messages in group rooms because we need teaching presence."*

The multi-agent build resolved that decision with the recommended default instead — read-only observer — because the owner's answer was given in a different session and was not in its context. The code shipped correct-as-written and green, but it does not match the decision. This package closes that gap.

Nothing here is a defect fix: it is a deliberate behaviour change from observer to participant.

---

## Current behaviour (verified 2026-08-08 at commit `38941d5`)

| Layer | Where | What it does today |
| --- | --- | --- |
| Server authz | `src/lib/server/learning-ai-guide-access.ts:158-163` | Owning teacher + `groupId` + `intent: "write"` → denied `teacher-group-observer-read-only` |
| Denial copy | `src/lib/server/learning-ai-guide-access.ts:309-311` | "UAIS learning chatroom group observation is read-only." |
| Route call site | `src/app/api/learning/chatroom/route.ts:480` | POST passes `intent: "write"` |
| Author stamping | `src/app/api/learning/chatroom/route.ts:1195-1203` | Stamps `authorId` + `authorName` from the session; **no `authorRole`** |
| Client gating | `src/components/pages/use-learning-chatroom.ts:314, 333` | `isObserver = Boolean(activeGroup) && role === "teacher"` → composer disabled |
| Client view | `src/components/pages/learning-page-chatroom.tsx:178, 243, 580` | Observer notice replaces composer; roster shows the 旁听 chip |

## Target behaviour

An owning teacher in one of their course's group rooms is a **full participant**: they read, post, and @mention agents exactly as a member does, and their messages are visibly attributed as the instructor.

---

## Work items

### 1. S12 — server (primary)

1. **Authorize the write.** Replace the `intent === "write"` denial at `learning-ai-guide-access.ts:158-163` with the authorized decision `teacher-group-participant-approved`. Keep `teacher-group-observer-required` (group not found in this course) — that denial is still correct. Retire `teacher-group-observer-read-only` and its copy string, or keep the union member unused only if a test pins it.
2. **Stamp the role.** Extend the transcript message with `authorRole?: "student" | "teacher"` (`learning-chatroom-transcript-store.ts`, alongside `authorName` at :40-44, :600-603 normalizer) and stamp it in the route from `appSession.role` (`route.ts:1195-1203`) — **server-derived only, never read from the request body**.
3. **Project it.** Echo `authorRole` in the GET/POST message projection (`route.ts:1229-1248`) next to `authorName` and `isSelf`. Continue never emitting `authorId`.
4. **Leave the wire role alone.** The request/stored `role` stays `"student" | "agent"`. This is deliberate: `selectNextAgent` scans the last **student-role** message for mentions (`src/lib/ai/orchestration/director.ts`), so a teacher's message keeps routing agents with **zero** orchestration change. Do not introduce a third wire role.
5. **Rate limiting is already correct** — the actor is keyed `app-session-educator-<account>`; no change.

**Do not change:** xAPI `collaboration.contributed` stays student-only (learning records track learners, not instructors).

### 2. S04 — client

1. Drop `isObserver` as a composer gate (`use-learning-chatroom.ts:314, 333`) — an owning teacher in a group room composes normally. Keep a denied-room halt for genuine denials.
2. Render the instructor chip on messages whose `authorRole === "teacher"` and in the roster row (`learning-page-chatroom.tsx:178, 243, 580`), replacing the observer notice.
3. Keep `isSelf` as the server's authority for alignment — a teacher's own messages align right like anyone's.

### 3. S09 — copy

Replace the observer strings with participant ones, zh-CN authoritative:

- `groupInstructorBadge` = 教师 | Teacher (message chip)
- `groupInstructorRow` = 授课教师 | Instructor (roster row)
- Retire `groupObserver` / `groupObserverNotice` once no view references them.

### 4. S11 — matrix

Refresh the AuthZ family in `coordination/reports/2026-08-08-learning-chatroom-group-qa-matrix.md`: the teacher×POST cell flips from denied to allowed.

---

## Tests (extend existing suites, house harness)

**API** (`tests/learning-chatroom-group-api.test.ts`):
- Owning teacher POST into a group room → 200, turns returned.
- The persisted teacher row carries `authorRole: "teacher"`, `authorName`, and no `authorId` in any client payload.
- A member's GET replays the teacher's message with `authorRole: "teacher"` and `isSelf: false`.
- Teacher @mention routes agents normally (proves the director is untouched).
- A **non-owning** teacher is still denied; a student is unaffected; admin still denied.
- A client body claiming `authorRole: "teacher"` is ignored — the server's session role wins. (Guards against a member forging instructor attribution, the same class of hole the agent-row forgery fix closed.)

**Live** (`tests/learning-chatroom-group-live.test.tsx`):
- Teacher view renders an enabled composer, not the observer notice.
- A teacher-authored row renders the instructor chip in both locales.

---

## Acceptance criteria

1. An owning teacher opens a group room in their course, posts, and every member sees the message attributed as the instructor.
2. A teacher @mention produces agent turns exactly as a student mention does.
3. `authorRole` is never accepted from the request body.
4. Students, non-owning teachers, and admins are unaffected.
5. `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build` all green; no legacy chatroom test modified to accommodate the change.

## Required checks

Targeted vitest on the two suites, then `npm run test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.

## Stop conditions

- Any need to add a third wire role or to change `selectNextAgent` — stop and report; the design deliberately avoids both.
- Any need to emit `authorId` to a client.
- Evidence that a teacher-authored row breaks the public `/share` no-account-id guarantee.

## Sequencing note

Independent of the other open follow-ups (true PDF export — S24; public `/share` read limiter — S12/S22; flag-on deployment smoke — S22/S19). The groups flag defaults `off`, so none of these is user-visible until the flip.
