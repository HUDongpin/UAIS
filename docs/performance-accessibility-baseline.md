# UAIS Performance and Accessibility Baseline

Date: 2026-07-08

This document records the first accepted-advisory B-19/B-20 implementation slice.
It is not a completed Lighthouse, axe, or manual assistive-technology audit.

## Implemented

- `/teaching`, `/learning`, and `/learning/chatroom` now render through small
  client shells that own `next/dynamic` imports for the largest client-page
  modules.
- The dynamic loading fallbacks expose `aria-busy="true"` and a route-specific
  accessible label while showing non-text skeleton blocks.
- `/teaching`, `/learning`, and `/learning/chatroom` now publish localized
  route metadata, giving the Next route announcer a more specific title than
  the root UAIS title.

## Guardrails

- Keep `next/dynamic` inside Client Components for large Client Component
  modules. The bundled Next App Router lazy-loading guide notes that dynamic
  imports from Server Components do not currently provide automatic Client
  Component code splitting.
- Keep fallback UI short-lived, non-interactive, and labeled with `aria-busy`.
- Keep every protected route with a visible page heading and a unique metadata
  title before inviting real users.

## Remaining Work

- Run Lighthouse against preview/staging after the full build blocker is
  resolved.
- Run browser accessibility checks against `/teaching`, `/learning`, and
  `/learning/chatroom` with the deployed assets loaded.
- Split the remaining large interactive modules further by user workflow so
  seldom-used panels can load on demand.
