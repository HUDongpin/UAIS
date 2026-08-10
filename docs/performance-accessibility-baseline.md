# UAIS Performance and Accessibility Baseline

Date: 2026-07-08

This document records the first accepted-advisory B-19/B-20 implementation slice.
It is not a completed Lighthouse, axe, or manual assistive-technology audit.

## Amendment 2026-08-09: the dynamic client shells were reverted

The `next/dynamic` client shells described below **stopped all three routes from
hydrating** and have been removed, along with the `PageLoadingShell` fallback
they existed to render.

The failure was silent. The server-rendered markup arrived complete and looked
correct, then never received a single event handler — no console error, no
hydration warning. Every control on `/teaching` and `/learning` was dead: the
"New Course" button opened nothing.

Measured on a production build (`next start`), counting interactive elements
carrying a React props key:

| Route | Before | After |
| --- | --- | --- |
| `/learning` | 9 of 37 hydrated | 53 of 53 |
| `/teaching` | 5 of 10 hydrated | 31 of 31 |
| `/learning/chatroom` | not measured | 18 of 18 |
| `/courses` (control, never had a shell) | 5 of 5 | 11 of 11 |

**Two different mechanisms reproduce it, and they share one thing: a Suspense
boundary wrapping the page body.** `next/dynamic`'s `loading` option sets
`hasSuspenseBoundary = !opts.ssr || !!opts.loading`, and the route-segment
`loading.tsx` convention creates the same kind of boundary. Removing the first
while adding the second — which was the first fix attempted — leaves the bug
exactly as it was. Only removing both fixes it. `/courses` and `/login` never had
either and have always hydrated.

The original slice was motivated by advisory issue I-14 on principle rather than
by a measured bundle problem, and its own session log records that Lighthouse,
axe, and browser checks were not run, so the regression shipped unverified.

**Known cost:** these routes no longer show a loading skeleton, and the
`aria-busy` fallback that came with it is gone. That is a real accessibility
regression against the original B-19/B-20 intent, accepted because a page that
never becomes interactive is the more serious failure. Restoring a loading state
requires first understanding why a Suspense boundary around these particular page
bodies never finishes hydrating — see Remaining Work.

## Implemented

- `/teaching`, `/learning`, and `/learning/chatroom` import their page component
  directly from the route's server component, as `/courses` and `/login` do.
- `/teaching`, `/learning`, and `/learning/chatroom` publish localized route
  metadata, giving the Next route announcer a more specific title than the root
  UAIS title.

## Guardrails

- Do not reintroduce `next/dynamic`, a `loading.tsx`, or any other Suspense
  boundary around these page bodies without re-measuring hydration. The bundled
  Next lazy-loading guide frames dynamic imports as a tool for deferring
  non-critical or conditional UI — a modal, say — and every documented example of
  a route's main content uses a static import.
- Accept future code splitting only on measured evidence: count hydrated
  interactive elements on a production build before and after, not bundle size
  alone. `tests/performance-accessibility-baseline.test.ts` guards both
  mechanisms.
- Keep every protected route with a visible page heading and a unique metadata
  title before inviting real users.

## Remaining Work

- **Find out why a Suspense boundary around these page bodies never finishes
  hydrating.** `/courses` is unaffected, so it is specific to what
  `TeachingPage`, `LearningPage`, and `LearningChatroomPage` do during
  hydration. Until that is understood, the loading skeleton cannot come back and
  no further code splitting should be attempted on these routes.
- Run Lighthouse against preview/staging after the full build blocker is
  resolved.
- Run browser accessibility checks against `/teaching`, `/learning`, and
  `/learning/chatroom` with the deployed assets loaded.
- Split the remaining large interactive modules further by user workflow so
  seldom-used panels can load on demand.
