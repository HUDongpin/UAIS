# Agent Daily Work Report

- Date: 2026-08-08
- Session ID: S12 (backend/API platform — share read path + `ai-request-rate-limit` machinery)
- Workstream: Public `/share/[shareId]` read-path rate limiter (P6 hardening follow-up; the "minor deferred" from the 2026-08-08 chatroom-groups adversarial review)
- Status: Completed

## Objective

Bound the unbounded, uncached storage reads the signed-out public share page
performs on every request, by adding a per-viewer rate limiter that reuses the
existing `createAiRequestRateLimiter` machinery with polling-friendly defaults.
Keep account ids out of every response. Deferral context:
`coordination/reports/2026-08-08-chatroom-groups-cto-execution-log.md` (Wave 6
"Minors deferred", lines 95–96 / 105) and
`coordination/reports/2026-08-08-learning-chatroom-group-implementation-plan.md`
(D6/D8).

## Design decisions (the three the task asked to settle)

1. **Placement → the loader** (`loadLearningChatroomShareDocument`), not the page
   and not a new wrapping route.
   - The loader is the single chokepoint every public share read funnels
     through, so throttling there guarantees no read path can bypass the guard,
     and it co-locates the check with the reads it protects.
   - It is already the fully-testable seam (injected env/repos/fetch/clock), so
     the limiter is driven deterministically in tests with an injected instance
     and a fixed clock — exactly how the route-handler rate-limit tests work.
   - The page's only new job is to extract the per-viewer key from request
     headers and hand it to the loader, and to render the throttled result. The
     page stays thin.
   - A "wrapping route" was rejected: `/share/[shareId]` must serve HTML to
     browsers, so converting it to a route handler to gain a real 429 would be a
     downgrade far larger than this deferred minor warrants.

2. **Key → client IP.** The page is signed-out, so there is no account; the IP is
   the only per-viewer signal. `resolveLearningChatroomShareViewerKey` prefers
   `x-real-ip` (the single value Vercel sets to the true client IP), falls back
   to the client-most `x-forwarded-for` hop, then a shared `share-viewer-unknown`
   bucket. The value is sanitized (IP charset, bounded to 45 chars) and never
   trusted verbatim. An absent header fails toward MORE throttling (one shared
   bucket), never a per-request bypass.

3. **No new env name.** Follows the sibling share-MINT limiter precedent (fixed,
   non-env-tunable) and the closed env catalog — its `active-production` tier is
   saturated (CTO log 1b), so a new name is an owner/S19 decision. Fixed,
   generous, NAT-tolerant windows: **60/min and 5000/day per IP**. No S19
   coordination required, and the `env-surface` catalog / `docs/env-surface.md`
   are untouched.

Throttled result: the loader returns a distinct `{ status: "rate-limited";
retryAfterSeconds }`; the page renders the existing "try again later" notice
(reusing `learning.exportTranscriptUnavailable`, so **no `src/i18n/copy.ts`
edit** and no S09 coordination). An App Router page cannot emit a real 429 — the
security value is that the throttled request skips every storage read in the
loader before any storage access, which the tests pin.

## Files changed

- `src/lib/server/learning-chatroom-share-rate-limit.ts` (NEW): limiter factory
  `createLearningChatroomShareReadRateLimiter()` (fixed 60/min + 5000/day,
  `mode: "enforce"`) and the pure `resolveLearningChatroomShareViewerKey(getHeader)`
  resolver + `learningChatroomShareViewerUnknownKey`.
- `src/lib/server/learning-chatroom-share-view.ts`: module-singleton limiter;
  `loadLearningChatroomShareDocument` gains optional `clientKey` / `rateLimiter`
  / `nowMs` deps and throttles FIRST, before any storage read; new
  `rate-limited` result variant. `loadLearningChatroomExportDocument`
  (signed-in) is intentionally untouched.
- `src/app/share/[shareId]/page.tsx`: reads `headers()` alongside `cookies()`,
  derives the viewer key, passes `clientKey`, and renders the throttled result
  as the temporarily-unavailable notice.
- `tests/learning-chatroom-share-api.test.ts`: new `describe("public share page
  rate limiting")` — 60/min bound + recovery past the window; storage skipped
  while throttled (throwing repository proves the short-circuit); independent
  per-viewer budgets; header-first + sanitized key resolution.

## Checks run

- `npx vitest run tests/learning-chatroom-share-api.test.ts`: 29 passed (5 new).
- `npm run lint`: clean.
- `npm run test`: 173 files passed / 3 skipped; 2272 tests passed / 5 skipped; 0
  failures.
- `npm run build`: ✓ Compiled successfully; `/share/[shareId]` builds as
  `ƒ (Dynamic) server-rendered on demand`.

## Checks not run

- None required beyond the above. No browser verification: a throttle is only
  observable after 60 rapid requests, so it is pinned by tests rather than the
  preview.

## Assumptions

- Deployment is behind Vercel (or a proxy that sets `x-real-ip` /
  `x-forwarded-for`); the header-first resolver degrades to a single shared
  bucket when neither is present.
- The tree's share feature remains untracked WIP; these four files are part of
  that same untracked set. No tracked, staged, or other-session files were
  modified (`src/i18n/copy.ts` and `src/lib/release/env-surface.ts` were already
  ` M` before this session and were not touched).

## Risks / known residuals (all consistent with the existing limiter's header)

- Per-process scope: effective ceiling is `limit × serverless instances`. A hard
  global cap needs shared storage (Redis/Postgres) — a separate S12 decision.
- `x-forwarded-for` is spoofable where not fronted by a trusted proxy, so key
  rotation can widen (never tighten) one attacker's budget; the per-key cap and
  the limiter's bounded key map still hold.
- Shared campus NAT shares one budget; 60/min is deliberately generous to
  tolerate a class opening one shared link. Widening is a code change (catalog
  closed), matching the mint-route tradeoff.

## Coordination notes for other sessions

- S19: no env change — the read limiter is intentionally non-env-tunable, so the
  redacted env inventory and `docs/env-surface.md` need no update.
- S09: no copy change — the throttled view reuses `exportTranscriptUnavailable`.
- S11: added a focused `describe` block to the existing share suite under this
  explicit owner assignment; no change to broad suite structure.

## Follow-up recommendations

- If a global (cross-instance) cap is later required, wire a shared-storage
  limiter behind the same `AiRequestRateLimiter` seam (S12).
- If large shared-NAT deployments hit the per-minute ceiling in practice,
  revisit whether the read limiter should become env-tunable (owner/S19).

- Next suggested owner/session: S22 (include the public-share throttle in the
  release/deploy smoke evidence).

---

# Addendum — post-review hardening (same session, 2026-08-08)

An adversarial review of the limiter above found real defects in it. All were
reproduced by measurement before fixing, and all are now closed.

## What was wrong

1. **Total bypass + CPU amplification (critical).** `sanitizeViewerIp` STRIPPED
   disallowed characters instead of validating, so any junk header minted a
   distinct bucket (`zz1`->`1`, `zz2`->`2`). Because a rejected check consumes
   nothing and a new key starts at count 0, a rotating header value passed
   through 100%. Worse, the shared limiter's `staleAfterMs` is the LONGEST window
   (24h), so during such a flood no bucket is ever stale: the map pinned at
   cap+1 and every later request paid a full 10k-entry copy+sort.
   Measured against a faithful transcription of the limiter internals:
   `20000/20000 allowed (100%)`, 9999 full sorts, 0.1209 ms/req versus
   0.00010 ms/req for a stable key — ~1200x amplification on the shared event
   loop, degrading every route in the process, not just `/share`.
2. **IPv6 /64 (high).** Keying the full 128-bit address handed one ordinary
   subscriber allocation 2^64 genuine, platform-stamped source addresses — a
   bypass needing no spoofing and working on Vercel exactly as written.
3. **Unobservable (medium).** A throttle produced no log, no Sentry breadcrumb,
   no header, and the computed `retryAfterSeconds` was discarded by its only
   caller — indistinguishable from a storage outage.
4. **Latent CI flake (medium), introduced by the original change.** 12 of the 17
   loader calls in the share suite omitted a limiter, so they silently shared one
   module-level bucket on the wall clock. Passing at 12 calls, but a cliff at 60
   within a minute, or under `--repeat`, or if another importer shared the worker.

## What changed

- `learning-chatroom-share-rate-limit.ts`: `resolveViewerIpKey` now VALIDATES via
  `node:net` `isIP` (junk falls to the shared unknown bucket instead of minting
  one), folds IPv6 to its **/64** network prefix (case- and zero-normalized, zone
  id stripped), and namespaces keys `share-viewer-ip4-` / `share-viewer-ip6-`.
  Added `isLearningChatroomShareUnknownViewerKey`.
- `ai-request-rate-limit.ts`: eviction now trims to a **low-water mark** (90% of
  cap) instead of back to the cap, so the O(n log n) fallback sweep amortizes
  over the keys it frees rather than running per request. Measured: full sorts
  9999 -> 10, 2418ms -> 17ms per 20k requests (~141x less CPU). Counting
  semantics are unchanged; only behavior under key-map pressure differs.
- `learning-chatroom-share-view.ts`: throttles now log at warn with
  `keyKind: "viewer-ip" | "unknown"`, window id, limit and retry hint. The
  viewer's IP is deliberately NOT logged — it is unnecessary for diagnosis and a
  public read path would otherwise accumulate a visitor log of who read which
  shared transcript. A run of `keyKind: "unknown"` is the signal that the edge
  sets neither forwarded header, which presents as a total share outage.
- `tests/learning-chatroom-share-api.test.ts`: fresh limiter per test via
  `beforeEach` + a `loadShareDocument` wrapper (the 12 bare calls now route
  through it; the 5 limiter-injecting tests still name theirs explicitly).
  New coverage for the threat model that was missing entirely: 500 rotating junk
  headers collapse to 1 budget; 500 IPv6 addresses in one /64 collapse to 1;
  different /64s stay distinct; low-water-mark eviction under a distinct-key
  flood. Non-vacuity confirmed: against the original code those inputs produce
  500 distinct budgets each, so the tests fail on the old implementation.

## Accepted residual — stated plainly, not papered over

A per-process, per-IP limiter **is not a DDoS defense** and the module header now
says so. A distributed caller with many real source networks still gets one
budget per network; serverless autoscaling makes the effective global ceiling
rise with attack volume, and each cold start is a fresh budget. Bounding that
needs edge/CDN rate limiting or a shared-storage global cap (S12/S22, owner
decision). What this guard does bound is casual abuse and accidental hammering —
which is the threat a link-holding viewer actually presents.

Header trust is now documented as a precondition rather than an assumption: the
original comment claimed spoofing "only ever WIDENS" the budget, which was wrong
in the other direction — a caller who controls `x-forwarded-for` can fill a
chosen victim's bucket. Vercel overwrites both headers, which is what makes them
usable here; a self-hosted edge must do the same.

## Checks (addendum)

- `npm run lint`: clean. `npx tsc --noEmit`: clean.
- `npm run test`: 173 files passed / 3 skipped; **2274 passed** / 5 skipped
  (was 2272), 0 failures.
- `npm run build`: ✓ Compiled successfully; `/share/[shareId]` still dynamic.

## Git preservation (owner-authorized, this session)

The owner explicitly authorized a preserve-only step (no slicing, no push).
Created NON-DESTRUCTIVELY via a temporary index — working tree, real index, HEAD
and `main` all verified byte-identical afterward (`git status --porcelain` hash
unchanged, 111 paths, HEAD still 412a52c):
- `refs/preserve/2026-08-08-chatroom-groups` -> commit `a9f795f`, 1506 files,
  including all 68 untracked files (25,947 lines). Ignored paths (`.env*`,
  `node_modules`, `.next`, `.claude/`) excluded — no secrets captured.
- Off-volume copy: `/Users/dongpinhu/uais-preserve-2026-08-08-chatroom-groups.tar.gz`
  (21M, on `/dev/disk3s5`, i.e. not the Starship disk).
Commit slicing remains UNASSIGNED and was not performed.
