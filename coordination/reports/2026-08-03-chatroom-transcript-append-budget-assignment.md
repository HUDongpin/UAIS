# Session Assignment

- Date: 2026-08-03
- Session ID: S12 (primary), with S04 coordination on the chatroom response contract
- Workstream: Learning chatroom transcript persistence — deadline-bound the post-round append
- Objective: Guarantee that an answered chatroom round always returns its JSON response inside `maxDuration = 60`, even when transcript persistence is slow or degraded, so a storage outage costs the room its history and never the round the learner just paid for.
- Allowed write scope:
  - `src/app/api/learning/chatroom/route.ts` (append call sites and budget arithmetic only)
  - `src/lib/server/learning-chatroom-transcript-runtime.ts`
  - `src/lib/server/learning-chatroom-transcript-store.ts`
  - `src/lib/server/learning-chatroom-transcript-external-store.ts`
  - `tests/learning-chatroom-api.test.ts` and `tests/learning-chatroom-transcript-*.test.ts` for the pinning tests below (coordinate suite structure with S11)
- Forbidden write scope: chatroom UI (`src/components/pages/learning-page-chatroom.tsx`, S04), agent/provider behavior (`src/lib/ai/`, S07), `src/data/uais.ts` (S08), `src/i18n/copy.ts` (S09), real `.env*` files, package/config files, any git state mutation
- Owner authorization: Requested by the owner on 2026-08-03 following the chatroom self-prefix review. This report is the assignment of record; it does not itself change code.

## Problem

The route meters **provider** work but not **persistence** work, so the post-round append is unbounded wall time on top of an already fully-spent budget.

Verified against the current source:

| Fact | Location |
| --- | --- |
| Serverless wall is 60s | `src/app/api/learning/chatroom/route.ts:45` (`export const maxDuration = 60`) |
| Provider work is metered to 50s from handler start | `route.ts:310` (`requestDeadlineMs = now() + learningChatroomRequestBudgetMs`), budget constants at `route.ts:126-130` |
| A round shares a 45s provider budget, capped by the request deadline | `route.ts:412-415` |
| Per-completion timeout derives from the remaining round budget | `route.ts:471` (`roundDeadlineMs - now()`) |
| Success-path append is **not** deadline-bounded | `route.ts:563-579` |
| Catch-path append is **not** deadline-bounded | `route.ts:600-613` |
| One external read and one external write are each bounded only by their own 10s abort | `src/lib/server/learning-chatroom-transcript-external-store.ts:73,134` |
| A 409 revision conflict retries the whole read-modify-write once | `src/lib/server/learning-chatroom-transcript-store.ts:235-239` (retry decision), `:285-315` (write/return/catch cycle) |

Arithmetic. A legitimate round ends at **at most ~48s** — the 50s request deadline less the 2s round reserve subtracted by `resolveLearningChatroomProviderTimeoutMs` (`route.ts:698-704`, reserve at `route.ts:128`). That leaves about 12s of the 60s wall. **One append cycle can exceed it on its own**: a read under 10s followed by a write that aborts at 10s adds up to just under 20s, so any read slower than roughly 2s already breaches the wall. No retry and no exotic degradation is required to lose the round.

The absolute bound is strictly under 40s of append I/O, not the flat 40s a naive reading suggests. The retry fires only on an HTTP 409 from the write (`external-store.ts:137-141`), which by definition arrives inside the abort window; if a call actually times out, fetch rejects with a `TimeoutError` DOMException rather than a 409 store error, `isLearningChatroomTranscriptSnapshotConflict` is false (`transcript-store.ts:307-314`) and it rethrows without retrying. The first read is also issued outside the try (`transcript-store.ts:240` versus the try at `:285`), so a read abort can never retry. The reachable worst case is therefore: attempt-0 read (under 10s, must succeed) + attempt-0 write (under 10s, returns 409) + attempt-1 read (up to 10s) + attempt-1 write (up to 10s).

Either way the outcome is the same: the platform kills the function **after** the agents answered but **before** the response is written — the learner gets a platform-level failure, no JSON body, no trace id, and the round is lost.

This directly contradicts the invariant the route states in its own comment at `route.ts:560-562`. The catch-path append has the same defect and can additionally swallow a contractual 502/504 body.

Note the response contract already models this outcome: `LearningChatroomTranscriptWriteResult` is `{ status: "persisted" | "unavailable" }` (`src/lib/server/learning-chatroom-transcript-runtime.ts:29-30`), and `createLearningChatroomTranscriptReceipt` (`route.ts:948-959`) passes the status through. Degrading a slow append to `unavailable` therefore needs **no client-visible contract change**.

## Two implementation options

Pick one and record the rationale in the session log.

**Option A — route-side race (smaller, keeps the store contract untouched).** Bound each append by the wall remaining after the request deadline:

```ts
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const persistBudgetMs = requestDeadlineMs + 3000 - now();
const transcript = persistBudgetMs <= 0
  ? { status: "unavailable" as const }
  : await Promise.race([
      appendLearningChatroomHistory({ /* unchanged args */ }),
      new Promise<LearningChatroomTranscriptWriteResult>((resolveLate) => {
        persistTimer = setTimeout(() => resolveLate({ status: "unavailable" }), persistBudgetMs);
        (persistTimer as { unref?: () => void }).unref?.();
      }),
    ]).finally(() => clearTimeout(persistTimer));
```

The allowance is `+3000`, not more: it puts the cutoff at roughly 53s and keeps about 7s for response assembly, which is close to the "~10s" the route already promises at `route.ts:42-44` and `route.ts:117-125`. A larger allowance would contradict acceptance criterion 5 rather than satisfy it. If you choose a different number, change both comments to match — that is the point of criterion 5.

`clearTimeout` in a `finally` matters for tests as much as production: the suite runs under jsdom (`vitest.config.mts:10`), where `unref` is undefined, so an uncleared timer stays pending for the full budget.

Mirror the whole shape in the catch path. Two caveats to record in the session log:

- The losing append continues detached and may be frozen mid-write when the instance suspends. That is acceptable for best-effort persistence **only because** appends are id-idempotent — confirm that claim still holds before relying on it.
- When the timer wins, the receipt says `unavailable` while the detached append may still land. The field therefore means "not confirmed within budget", not "not written". That is harmless today because nothing consumes it, but say so wherever the receipt is documented.

**Option B — thread the remaining budget into the store (cleaner, wider blast radius).** Pass a `timeoutMs` from the remaining wall through `appendLearningChatroomHistory` into the repository fetches so `AbortSignal.timeout(10_000)` becomes `AbortSignal.timeout(min(10_000, remaining))`, and suppress the 409 retry when the remaining budget cannot fund a second cycle. Preferred if S12 is willing to touch the store contract, since it cancels the work instead of abandoning it.

Option B has a prerequisite, and it must be done first rather than discovered mid-package: today there is no seam to thread a budget through. `appendLearningChatroomTranscriptMessages` (`transcript-store.ts:206-219`) takes only `now?: string`, an ISO stamp rather than a clock, and `LearningChatroomTranscriptRepository` (`transcript-store.ts:66-73`) exposes `read()` / `write({ database, expectedRevision })` with no `signal` or `timeoutMs`. Option B therefore begins by widening that interface. Note also that an injected `deps.transcriptRepository` short-circuits `resolveLearningChatroomTranscriptBackend` (`transcript-runtime.ts:120-125`), so the external store is never constructed in tests that inject one — the abort behavior Option B changes cannot be observed through that seam at all, only through the repository interface.

## Acceptance criteria

1. An answered round returns a 200 JSON response inside the 60s wall even when the transcript repository is slower than the remaining budget, with `body.transcript.status === "unavailable"`.
2. The catch path likewise returns its contractual error status and body (502/504/500 as applicable) rather than being killed by a slow best-effort append.
3. A healthy fast append is unchanged: `status: "persisted"` with the existing `appendedMessageCount` / `messageCount` / `storagePolicy` fields.
4. No client-visible response-shape change; no new public error message.
5. The budget comment blocks at `route.ts:42-44` and `route.ts:117-125` are updated so the stated arithmetic matches the code, including the persistence allowance.
6. Whichever option is chosen, the interaction with the 409 retry is explicit: either the retry fits the remaining budget or it is skipped.

## Required checks

- `npx vitest run tests/learning-chatroom-api.test.ts` plus any transcript-store suites touched
- `npm run test` (full suite; the 2026-08-03 baseline at the time of this assignment is 167 files passed / 3 skipped, 2146 tests passed / 5 skipped, and the 5 skips are Postgres-gated via `describe.skipIf(!databaseUrl)`)
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build` — this change touches a route module and its `maxDuration` reasoning, so the build gate applies per the AGENTS.md quality bar

New pinning tests (coordinate placement with S11). The two branches need **different** mechanisms — advancing the injected clock alone cannot pin the slow-append case, because Option A's cutoff is a real `setTimeout`, so a fake repository that merely moves the clock still resolves on the next microtask and wins the race:

1. **Budget already exhausted.** Uses `createChatroomTestClock()` (`tests/learning-chatroom-api.test.ts:240`), but note the threshold carefully: the short-circuit needs `now()` past `requestDeadlineMs + 3000`, i.e. about **53s** from handler start, not merely past the 50s request deadline. At 51s the budget is still positive and the repository *is* called. A faithful round can never get there on its own — the last completion is capped at `roundDeadlineMs - 2000`, so a round ends by ~48s. The clock must therefore be pushed past 53s by the test doubles: combine pre-round advancement with a `createRecordingDeepSeekClientFactory` completion callback that calls `clock.advance(...)`, so the round still succeeds while the clock lands past the cutoff. Then assert a 200 body, `body.transcript.status === "unavailable"`, and that the injected repository's `read`/`write` were **never invoked** — that last assertion is what makes the test meaningful rather than incidental. Do not reuse the `advanceMs: 49_500` idiom at `:1361` (in "skips every agent to a timeout fallback when pre-round work exhausts the request budget", `:1329-1384`): that drives pre-round work to exhaustion and asserts a 504, so it never reaches a successful round's append.
2. **Slow repository.** Needs `vi.useFakeTimers()` plus `vi.advanceTimersByTimeAsync(...)` against a `transcriptRepository` whose `read` returns a never-resolving promise. Assert 200, `status: "unavailable"`, and that the response does not wait on the hung read. Two traps: the advance must be **looped or yielded to** until the timer is actually registered — the handler first awaits `request.json()` and `authorizeLearningAiGuideCourseAccess`, which does real filesystem I/O against the fixture directory, so a single advance fired before the timer exists leaves the response promise unsettled forever. And do not attempt this with real timers at all: `vitest.config.mts:13` sets `testTimeout: 15000`, so a real-time wait on a multi-second budget will flake or fail outright.
3. **Catch path.** A failing round plus a hung append still answers with the contractual error status and body (502/504/500 as applicable), using the same fake-timer mechanism as (2).
4. **Fast-append regression.** Already writable with today's helpers: assert `status: "persisted"` and that `appendedMessageCount` / `messageCount` / `storagePolicy` are unchanged.

If Option B is chosen, acceptance criterion 6 (409-retry suppression) has **no test surface** until the interface widening described above lands. Sequence that work first, or drop criterion 6 into a follow-up package and say so in the session log.

## Stop conditions

- Option B turns out to require changing the external-storage HTTP contract or its persisted schema — stop and write a blocker; that is an owner decision.
- The idempotency guarantee Option A leans on cannot be confirmed for a detached, half-completed write — stop and report rather than shipping a race that can double-append.
- Evidence emerges that LangGraph checkpoint I/O is also material uncounted wall time (see follow-up below) — report it; do not absorb that fix into this package.

## Related follow-up (not in this package)

LangGraph external checkpoint I/O is bounded per call but is likewise not subtracted from either budget (`src/lib/ai/langgraph-runtime/external-persistence.ts`). Whether that matters depends on checkpoint frequency per superstep, which is unmeasured. The correct first step is measurement, not a fix, and it crosses into S07 — keep it as a separate package.
