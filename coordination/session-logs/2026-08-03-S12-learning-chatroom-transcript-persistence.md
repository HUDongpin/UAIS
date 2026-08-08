# Agent Daily Work Report

- Date: 2026-08-03
- Session ID: S12 (second S12 package of the day; filename suffixed because
  `2026-08-03-S12.md` is another session's rate-limit report and AGENTS.md
  forbids editing another session's log)
- Workstream: Backend/API platform - server-side persistence for the human-AI
  learner chatroom
- Status: Completed
- Objective: The learner chatroom supported real courses but kept its
  conversation only in React state, so a refresh or a navigation lost the whole
  transcript including live DeepSeek replies. Add per-(courseId, classId,
  student) persistence behind the established local-JSON + external-storage
  split, a `GET` handler that replays it, and a component that restores prior
  history on course resolution.

## Summary of work completed

- Added `src/lib/server/learning-chatroom-transcript-store.ts`: normalized
  `uais-learning-chatroom-transcripts-v1` database, atomic JSON file writes to a
  local data dir, a repository seam with optimistic-revision retry, a hashed
  room id derived from (courseId, classId, studentId), append that is idempotent
  per message id, and a rolling 200-message window per room.
- Added `src/lib/server/learning-chatroom-transcript-external-store.ts`: the
  external repository, deliberately reusing
  `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND` rather than introducing a second
  storage-backend switch. Transcripts hang off the course records the round is
  authorized against, so one setting keeps a deployment from ending up with
  durable courses and non-durable transcripts, and no new env lands in the
  release-gate/Vercel inventory surface.
- Added `src/lib/server/learning-chatroom-transcript-runtime.ts`: the
  route-facing wrapper. Every call reports a status instead of throwing, so a
  storage outage costs the room its history rather than its conversation.
- Mirrored the resource onto the external-storage service so external mode works
  end to end rather than 404ing: snapshot path, revision/snapshot serializers,
  read/replace store helpers, `GET`/`PUT` handlers, and
  `src/app/api/external-storage/learning-chatroom-transcripts/database/route.ts`.
- `GET /api/learning/chatroom?courseId=&classId=` replays a room under the same
  course authorization as `POST`, so only the account that wrote a room can read
  it. An unreadable transcript degrades to an empty room (`transcript.status:
  "unavailable"`) instead of erroring.
- `POST` now persists the request history plus the round's agent turns after the
  round, and best-effort persists the request history on the failure path so a
  lost round does not make the learner retype their question. Turn message ids
  are minted server-side and echoed in the response so the client renders each
  turn under the id the room stored and the next round's re-post deduplicates.
- `src/components/pages/learning-page-chatroom.tsx` restores the room's
  transcript once its course resolves, prepending it so a message sent while the
  request was in flight stays last, sends `classId` with the round, uses the
  server's turn ids, and generates collision-free local message ids (a counter
  restarting at 1 after a reload would have looked like an already-stored id).
- The seed-transcript rule is unchanged: demo fixtures render only in demo-course
  context, never enter a request, and are never persisted.

## Files changed

- `src/lib/server/learning-chatroom-transcript-store.ts` (new)
- `src/lib/server/learning-chatroom-transcript-external-store.ts` (new)
- `src/lib/server/learning-chatroom-transcript-runtime.ts` (new)
- `src/app/api/external-storage/learning-chatroom-transcripts/database/route.ts` (new)
- `src/app/api/learning/chatroom/route.ts`
- `src/components/pages/learning-page-chatroom.tsx`
- `src/lib/server/external-storage-route-paths.ts`
- `src/lib/server/external-storage-serialization.ts`
- `src/lib/server/external-storage-route-store.ts`
- `src/lib/server/external-storage-route-service.ts`
- `tests/learning-chatroom-api.test.ts`
- `tests/learning-chatroom-live.test.tsx`

## Checks run

- `npx vitest run tests/learning-chatroom-api.test.ts tests/learning-chatroom-live.test.tsx`: 70 passed.
- `npx tsc --noEmit`: clean.
- `npm run lint`: clean.
- `npm run test`: 167 files passed, 3 skipped; 2142 tests passed, 5 skipped.
- `npm run build`: compiled successfully; both `/api/learning/chatroom` and
  `/api/external-storage/learning-chatroom-transcripts/database` registered.

## Checks not run

- No live-provider or deployed smoke test: the round path is unchanged and
  running one would spend real DeepSeek credit without an owner-approved
  credential assignment.
- No browser inspection: no dev server was started, to avoid colliding with the
  other session active in this checkout.

## Coordination notes for other sessions

- **Concurrent writer.** Another S12 session landed per-actor rate limiting on
  the same route at ~14:03 while this package was in progress. Its changes were
  re-read and integrated, not clobbered: the throttle still runs before course
  authorization, so a throttled actor causes no persistence round trip. Its log
  is `coordination/session-logs/2026-08-03-S12.md`.
- S04 owns `learning-page-chatroom.tsx`; this package edited it under the owner's
  explicit assignment.
- S19: `UAIS_LEARNING_CHATROOM_TRANSCRIPTS_DATA_DIR` is a new optional local
  data-dir override that defaults to `UAIS_TEACHING_COURSES_DATA_DIR`. It is not
  registered in the env surface, matching the existing treatment of
  `UAIS_TEACHING_COURSES_DATA_DIR` and the other per-store data dirs. Confirm
  that is the intended tier placement.

## Risks

- Reusing `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND` couples transcript durability
  to the course-management backend decision. That is deliberate, but it means a
  deployment cannot make transcripts external while leaving courses local.
- `GET` is not rate limited. It costs one course-authorization store read per
  room resolution and no provider call, but it is a new authenticated read
  surface; if the chatroom is ever exposed publicly it should join the limiter.
- A room retains its most recent 200 messages. Older turns are dropped on append
  and are not archived anywhere.
- Persistence is best-effort by design: a storage outage silently costs history
  (reported through `transcript.status`, logged server-side) rather than failing
  the round.

## Assumptions

- The account on the app session is the room's owner, so a transcript is private
  to one learner rather than shared across a cohort. A shared cohort room would
  be a different data model and was not assigned.
- Persisting the round must never fail the round; the conversation is what the
  learner came for.

## Follow-up recommendations

1. S22: decide whether the external-storage transcript resource needs the same
   backup / restore-drill / health-schema coverage the course-management and
   course-assets resources have. This package added only snapshot read/replace.
2. S11: fold the transcript contract into the regression matrix - the
   scoping, idempotency and best-effort rules are the parts most likely to
   regress.
3. S04/S09: consider whether a room whose stored history failed to load should
   say so in the UI. It currently starts empty and silent, which is the
   pre-persistence behaviour.

## Next suggested owner/session

S11 for the regression matrix entry; S22 for the external-storage resource
parity decision.
