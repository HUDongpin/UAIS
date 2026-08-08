# Agent Daily Work Report

- Date: 2026-08-08
- Session ID: S12 (P6 server-side security fixes)
- Workstream: Wave 7 P6 fix verification — server-side adversarial-review findings
- Status: Completed
- Objective: Fix the four CONFIRMED server-side findings from the group-chatroom adversarial review (client agent-message forgery, dead production-503 share guard, D9 kill-switch gap on public /share, studentId provenance churn) and pin each with tests.

## Summary of work completed

### FIX 1 (MAJOR security) — client-supplied agent-message forgery
- `src/app/api/learning/chatroom/route.ts` (~line 500): `transcriptRequestMessages` now filters `body.messages` to `role === "student"` before mapping, so a client-supplied `role:"agent"` row is never persisted. Server-minted `turns[]` remain the only agent source in the append. Both append paths (success ~690-711 and error/catch ~734-753) read `transcriptRequestMessages`, so the single filter guards both.
- Behavior-preserving: genuine agent rows are already stored server-side (idempotent by messageId), so re-posts were always dedup no-ops.
- Safety valve: full legacy suite `tests/learning-chatroom-api.test.ts` stayed green with NO edits. In particular "does not duplicate stored messages when the client re-posts its visible transcript" (which re-posts an already-stored agent row) still passes because that agent row is already in the store from round 1. No legitimate flow depends on persisting a client agent row.

### FIX 2 (MAJOR parity) — dead production-503 guard for shares
- `src/lib/server/learning-chatroom-share-store.ts`: `assertLearningChatroomShareLocalJsonRuntimeAllowed(env)` is now called at all three entry points (`createLearningChatroomShare` mint, `revokeLearningChatroomShare` revoke, `readLearningChatroomShare` read) whenever no repository is supplied — mirroring the transcript store's `resolveLearningChatroomTranscriptBackend` → `assertLearningChatroomTranscriptLocalJsonRuntimeAllowed` seam. Each entry gained an optional `env?` param; guard uses `input.env ?? {}` so store-isolation unit tests (no env) stay non-production.
- Env markers reused unchanged from the existing helper: `VERCEL_ENV === "production" || NODE_ENV === "production" || UAIS_DEPLOYMENT_ENV === "production"` (identical to transcript + teaching stores).
- Wired `env` into the callers: mint route (`share/route.ts`), revoke route (`share/[shareId]/route.ts`, both the pre-read and the revoke), and the public view loader (`learning-chatroom-share-view.ts`). The routes surface the designed `LearningChatroomShareStoreError` 503 with the storage message (not a generic 500), because `readPublicError` already maps that error to its status/message.

### FIX 3 (MINOR D9 kill switch) — public /share ignored the groups flag
- `src/lib/server/learning-chatroom-share-view.ts`: `loadLearningChatroomShareDocument` now returns `{ status: "not-found" }` when `share.groupId` is present and `isLearningChatroomGroupsEnabled(input.env)` is false (read-only import of the shared helper from `learning-chatroom-groups-flag.ts`). Legacy shares (no groupId) are unaffected. `src/app/share/[shareId]/page.tsx` already maps `not-found` → `notFound()`, so no page change was required.

### FIX 4 (MINOR provenance) — studentId churn
- `src/lib/server/learning-chatroom-transcript-store.ts` (~line 336): the rebuilt record now stamps `studentId: existing?.studentId ?? studentId`, mirroring `createdAt: existing?.createdAt ?? now`. A later append by a different group member preserves the original creator instead of rewriting it. No legacy test depended on the old churn.

## Tests added
- `tests/learning-chatroom-group-api.test.ts`:
  - "never persists a client-supplied agent row, even a forged trusted-TA message" — a POST with a forged `role:"agent"` row → absent from both the poster's and another member's GET replay; only the server-minted turn appears; `appendedMessageCount === 2`.
  - "preserves the creating member as provenance across a second member's append" — member two appending keeps `studentId === groupMemberOne.account` in the stored record.
- `tests/learning-chatroom-share-api.test.ts`:
  - "refuses production local-JSON minting with the designed 503, not a 500 or 201" — production env + a course-repository double (so authz uses the repository, isolating the share store as the 503 source) → 503 with the storage message, nothing written.
  - "pins the mint rate limiter at 10 links per minute per actor, then recovers" — 10 × 201, 11th → 429 with a positive `retry-after`, then advance the clock past the window → 201.
  - "resolves a group share to not-found when the groups flag is off, but keeps a legacy share readable" — flag-off group share → not-found; legacy share → ready; flipping the flag back on makes the group share resolve again (proving it was gated, not revoked).
- Added a read-only `createCourseRepositoryDouble` helper in the share suite.

## Non-vacuity verification
Temporarily reverted Fix 1 (removed the student filter) and Fix 2 (removed the mint guard): the forgery pin failed (persisted 3, forged row present, agent-rows array mismatch) and the 503 pin failed (201 instead of 503). Restored both; files byte-identical to the fixed versions.

## Checks run
- `npx vitest run tests/learning-chatroom-api.test.ts tests/learning-chatroom-group-api.test.ts tests/learning-chatroom-share-api.test.ts`: 3 files, 107 passed (was 102 before the 5 new tests).
- `npx tsc --noEmit`: clean (exit 0).
- `npm run lint`: clean (exit 0).

## Checks not run
- Full `npm run test` / `npm run build`: deliberately skipped per assignment (concurrent client + teaching-test engineers active on other files).

## Assumptions
- The share store has no external repository factory yet (local-JSON-only with the seam), so in production the mint/revoke/read guard fires whenever no `repository` is injected — matching the transcript-store precedent.
- Making `env` optional on the store entry points (guard uses `env ?? {}`) preserves the many direct store-isolation unit-test calls that pass no env; the routes always inject env, so production 503s work.

## Risks / residual
- The public `/share` read now 503s in production local-JSON; the loader's existing catch maps that to `{ status: "unavailable" }`, so the page shows "temporarily unavailable" rather than a raw 503 — correct and disclosure-safe (no genuine share can exist on ephemeral FS anyway).
- Unbounded uncached public `/share` storage reads (signed-out DoS surface) remain a documented, deferred follow-up (Wave 6 minors) — not in this package.

## Coordination notes
- Stayed strictly inside the assigned server scope. No client/UI, teaching, i18n, data, env-catalog, or git changes. No `npm install`.

## Files changed
- `src/app/api/learning/chatroom/route.ts`
- `src/lib/server/learning-chatroom-share-store.ts`
- `src/app/api/learning/chatroom/share/route.ts`
- `src/app/api/learning/chatroom/share/[shareId]/route.ts`
- `src/lib/server/learning-chatroom-share-view.ts`
- `src/lib/server/learning-chatroom-transcript-store.ts`
- `tests/learning-chatroom-group-api.test.ts`
- `tests/learning-chatroom-share-api.test.ts`
- `coordination/session-logs/2026-08-08-S12-p6-security-fixes.md` (this log)

## Next suggested owner/session
- S11: fold these pins into the release-quality matrix.
- S22: production share/transcript reads now uniformly 503 on local JSON — note for release smoke once an external share backend is wired.
