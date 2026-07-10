# Contributing to UAIS

This guide is the small-team entry point for UAIS. Use it before reaching for
the larger `AGENTS.md` coordination protocol.

## Current Project Shape

UAIS is a Next.js 16 App Router proof of concept for a university teaching and
adaptive-learning site. The core product surfaces are:

- `/courses`
- `/learning`
- `/learning/chatroom`
- `/student-dashboard`
- `/teaching`
- `/login`

Keep the proof of concept focused on these routes until the missing foundations
in the technical advisory are in place: real auth, durable storage, observability,
and critical-flow tests.

The authoritative scope boundary is `SCOPE.md`. Do not expand parked
experimental surfaces without an owner-approved package and focused tests.

## Local Setup

1. Install dependencies with the package-lock in this repository.
2. Keep real secrets in local environment files only. Never commit `.env*`,
   credential documents, screenshots of secrets, or copied secret values.
3. Start the app:

```bash
npm run dev
```

4. Run the focused checks for your change:

```bash
npm run lint
npm run test
npm run build
```

If `npm run build` hangs or cannot finish, record the exact command, elapsed
time, and last visible output in your handoff.

## Branch And Review Flow

- Work on a small branch or assigned worktree when possible.
- Keep one change package focused on one owner boundary.
- Do not mix behavior changes with refactors.
- Do not use `git add .` for release or rescue work. Stage explicit pathspecs
  only when the owner has asked for staging.
- Never reset, delete, revert, merge, rebase, push, or deploy unless the owner
  explicitly assigns that operation.

## Coding Rules

- Use the `@/` import alias for `src/`.
- Add `"use client";` only when hooks, browser APIs, local storage, or event
  handlers require it.
- Put shared domain data in `src/data/uais.ts` unless a schema split is assigned.
- Put bilingual copy in `src/i18n/copy.ts`.
- Keep page-level UI in `src/components/pages/`.
- Keep server auth/storage helpers in `src/lib/server/`.
- Keep route handlers under `src/app/`.
- Read the relevant Next.js 16 guide in `node_modules/next/dist/docs/` before
  writing App Router, route-handler, proxy, caching, or server/client-boundary code.

## Required Checks

Use the smallest meaningful check first, then widen:

- Auth, proxy, or route-handler change: focused Vitest file, `npm run lint`,
  and `npm run build` when practical.
- Data contract change: focused data tests, then `npm run test`.
- Visual UI change: `npm run lint` and inspect the route in a browser when a
  dev server is available.
- Documentation-only change: `git diff --check` is enough unless links or code
  snippets need a targeted check.
- Critical-flow or advisory-recovery change: run `npm run test:critical` and the
  relevant governance test under `tests/`.

Always report checks that were not run and why.

## Production Safety

Before inviting real users:

- Shared local-demo credentials must not authenticate in production.
- Deployed environments must have explicit session signing secrets.
- `/healthz` must return HTTP 200 with a no-store response.
- A rollback operator must be able to follow
  `docs/runbooks/production-rollback.md`.
- The pre-deploy checklist in `docs/runbooks/pre-deploy-checklist.md` must be
  complete.

## Stop And Ask

Stop before proceeding when the change requires:

- Real credentials or Vercel environment edits.
- A package upgrade or new dependency.
- Database provider selection, schema migration, or data deletion.
- Retiring or moving experimental modules.
- A change to `AGENTS.md` coordination policy.
- Production deploy, rollback, or live smoke with real accounts.

## CI

`.github/workflows/critical-flow.yml` is the current merge-gate workflow. It
runs `npm run lint`, `npm run test:critical`, advisory-governance tests, and a
compile-only Next build. GitHub branch protection must require this workflow
before it becomes an actual merge blocker.
