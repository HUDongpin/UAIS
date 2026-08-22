<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md - UAIS Parallel Session Guide

This file is the coordination contract for AI/Codex sessions working in `/Volumes/Starship/UAIS`.

## Project Snapshot

- Project: `UAIS`, a personal teaching website template for `uais.top`. UAIS supports both University AI System and University Adaptive Interactive System.
- Product shape: a MAIC-informed teaching website pattern with course plaza cards, learner playback, human-AI group chat, and a teacher course-management workspace. Do not copy private ClosedMAIC screenshots, internal identities, proprietary assets, or copied MAIC content.
- Stack: Next.js App Router, React 19, TypeScript strict mode, Tailwind CSS v4, Phosphor Icons, Vitest.
- Package manager: use `npm` scripts from `package.json`.
- Important scripts:
  - `npm run dev` starts the local Next.js dev server.
  - `npm run build` runs a production Next build.
  - `npm run start` starts the production server after a build.
  - `npm run lint` runs ESLint.
  - `npm run test` runs the Vitest acceptance suite.
  - `npm run release:package-gate` verifies dirty-map path coverage against an explicit review-slice pathspec list.
- Current checkout note: this folder is a Git repository and may contain owner/session changes at once. Sessions must inspect `git status --short` before editing, must not revert unrelated changes, and must not stage, commit, branch, merge, rebase, push, or delete files unless the owner explicitly assigns that Git operation.
- Do not edit generated or local-only outputs: `node_modules/`, `.next/`, `.tmp/`, `tsconfig.tsbuildinfo`, `.DS_Store`, `.env`, `.env.local`, or other real secret files.

## Purpose

This project can be managed by up to 25 simultaneous AI sessions. Each session may be assigned independent work while the owner is offline or sleeping. The goal is steady project progress without conflicting edits, lost work, or unreviewable changes.

Every session must:

- Read this file before doing project work.
- Declare its session ID, such as `S01`, in its first note or session log.
- Work only inside its assigned write scope.
- Keep changes small, reviewable, and aligned with the existing project style.
- Leave a handoff note before stopping.
- Never revert unrelated user or session changes.

## Current Coordination Posture

- Do not add `S26+` roles for the current workload. The present bottleneck is coordination and release control, not missing headcount.
- When a new surface appears inside an existing workstream, sharpen the relevant `S01`-`S25` scope first instead of creating a new agent.
- Current priority pressure points are protecting the small route/data surface, keeping bilingual copy in sync, maintaining the chatroom export/share contract, and preserving clean build/test gates.
- New parallel assignments should prefer smaller packages for existing owners, especially S25 release intake, S22 build/deployment checks, S11 targeted regression, and S08/S09 shared data/copy cleanup.
- The root checkout is an intake/integration surface, not a scratch workspace. Feature sessions should work from an explicitly assigned branch or worktree, keep changes inside their owner pathspecs, and leave `git status --short --untracked-files=all` clean before handoff.
- Dirty-root rescue work must begin with `npm run release:dirty-map -- --reason "<short reason>"`, then use explicit pathspec staging only. Do not use `git add .` for UAIS rescue, release, or owner-slice commits.
- Before starting root-checkout work, run `npm run release:clean-check`. If it fails, only S25/S10/S22 rescue, release-intake, or owner-approved cleanup work may continue in the root until clean-status evidence is published.
- Generated evidence refreshes must overwrite the canonical report names or go under ignored `.scratch/` folders. Archive superseded generated reports and dirty-map probes before handoff instead of accumulating new timestamped piles in the root.
- As of 2026-08-18 the Vercel project `uais` is connected to `HUDongpin/UAIS`, so **pushing `main` deploys production at `uais.top` automatically**. A production build runs `npm run vercel-build`, which applies migrations to the live database before `next build`. Treat a push to `main` as a release action, not a save: it needs the same care as `vercel --prod`.
- Preview deployments are switched off in `vercel.json` via `git.deploymentEnabled` (`*` and `**` false, `main` true), so pushing a feature or agent branch to `origin` builds nothing. Keep it that way unless preview gets its own database: the project's `DATABASE_URL`/`POSTGRES_URL` are scoped "Production, Preview" and point at the **production** database, so a preview would read and write live data. Schema is protected either way — the migration runner skips when `VERCEL_ENV` is not `production` — but application writes are not. Both `*` and `**` are listed because minimatch `*` does not cross `/`, and this project's agent branches are named `claude/...` and `codex/...`.

## High-Intensity Release Coordination Protocol

Use this protocol whenever report volume, release-gate evidence, deployment checks, or dirty-tree size make the project feel like it needs more agents. The default answer is still: refine `S01`-`S25` before adding permanent roles.

1. S25 runs release intake first. Before assigning new feature or release work, S25 should produce a non-destructive dirty-tree and evidence inventory under `coordination/release-intake/`, mapping changed files to owning sessions, identifying stale/current release evidence, and recommending PR/commit slices. S25 must not stage, commit, branch, push, reset, delete, or revert unless the owner explicitly assigns that Git operation.
2. S22 work must be split into small release packages. Each S22 package should target one release-chain segment only, such as Vercel project readiness, env-apply preflight binding, production deployment evidence, deployed page smoke, protected route smoke, external-storage readiness, or aggregate release-gate refresh. Avoid asking one S22 run to harden scripts, refresh all evidence, and diagnose live deployment at the same time.
3. S10 keeps the coordination layer clean. S10 should own nightly assignment shape, president-report synthesis, and cross-session status summaries, but should not implement feature fixes inside S05/S12/S22/S24 scopes unless explicitly assigned by the owner.
4. S11 owns regression-matrix clarity. When S22 adds or tightens release-gate tests, S11 should turn the coverage into a readable release-quality matrix and flag gaps, without fixing feature code unless assigned.
5. S12, S19, S22, and S24 keep strict boundaries. S12 owns backend/API route contracts, S19 owns redacted env placement and parity, S22 owns release engineering and deployment proof, and S24 owns export/PPT/manual playback acceptance. If a release blocker crosses these boundaries, write the handoff and stop instead of absorbing another session's work.
6. Secret-like files are inventoried only by redacted category. If `git status` shows local credential documents, `.env*` files, deployment tokens, or other secret-like artifacts, logs may say `secret-like untracked local file present` but must not copy, print, summarize, stage, screenshot, or inspect values.
7. New `S26+` roles require evidence. Only add a permanent new role after S10 and S25 document that the work is durable, independent, not covered by `S01`-`S25`, and cannot be handled by narrowing an existing session package.

## Project Conventions

- Use the `@/` path alias for imports from `src/`.
- Add `"use client";` only for components that need hooks, browser APIs, context, local storage, or interactive event handlers.
- Keep shared UAIS data and domain types in `src/data/uais.ts` unless a larger schema split is explicitly assigned.
- Keep bilingual copy in `src/i18n/copy.ts`, with Simplified Chinese (`zh-CN`) as the default locale and English (`en-US`) as the paired locale.
- Keep UI-ready mocked helpers in `src/lib/`, including `src/lib/chat-actions.ts`.
- Keep provider state in `src/components/providers/`.
- Keep app shell and navigation in `src/components/layout/`.
- Keep page-level UI in `src/components/pages/` and route files under `src/app/`.
- Preserve the current design language: CSS variables in `src/app/globals.css`, Tailwind utility classes, light/dark theme support, restrained university teaching interface, compact cards, and responsive layouts.
- Use Phosphor Icons for icon buttons and visual affordances where an icon exists.
- Keep the template free of proprietary/private MAIC materials. Pattern-level inspiration is allowed; copied protected content is not.
- Keep server-only credentials in local env files if future backend work needs them; never expose secrets through `NEXT_PUBLIC_` variables unless the owner explicitly approves.

## Local API Key Source

- No UAIS-specific owner-approved credential document is currently documented in this repository.
- Do not reuse or copy credentials from `/Users/dongpinhu/Desktop/MAIS-MVP` for UAIS unless the owner explicitly authorizes that provider and target environment.
- Never copy, print, summarize, commit, stage, screenshot, or log real credential values from `.env.local`, Vercel, documents, browser sessions, or any other secret source.
- If UAIS work needs a provider key, deployment token, email credential, PDF service, or live AI provider, stop and ask the owner for the approved credential source and target environment.

## Session System

Use session IDs `S01` through `S25`. A session may read any project file needed for context, but it may write only to its allowed files/modules unless the owner explicitly expands its scope. Do not create new permanent `S26+` roles unless the owner explicitly approves a new workstream after S10/S25 confirm that the need cannot be handled by refining an existing session boundary.

| Session | Owner/role | Workstream | Allowed files/modules | Forbidden files/modules | Status | Handoff notes |
| --- | --- | --- | --- | --- | --- | --- |
| `S01` | App shell lead | Root layout, redirect, app shell, header, navigation, theme/language controls | `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/layout/`, `src/components/providers/app-preferences.tsx`, shell-related edits in `src/app/globals.css` | Page-specific workflows, data contract changes, tests except shell-focused coverage, secrets | Available | Log in `coordination/session-logs/YYYY-MM-DD-S01.md` |
| `S02` | Course plaza lead | `/courses`, course cards, course-plaza visual states, two-course product contract | `src/app/courses/`, `src/components/pages/course-plaza-page.tsx`, course/plaza sections of `src/data/uais.ts` | Chatroom behavior, teacher workspace internals, global provider state, package/config files | Available | Log in `coordination/session-logs/YYYY-MM-DD-S02.md` |
| `S03` | Learner workspace lead | `/learning`, enrolled courses, playback panel, learner progress surface | `src/app/learning/page.tsx`, learner sections of `src/components/pages/learning-page.tsx`, learning-course sections of `src/data/uais.ts` | Full chatroom mechanics unless coordinated with S04, teacher workspace, package/config files | Available | Log in `coordination/session-logs/YYYY-MM-DD-S03.md` |
| `S04` | Human-AI chatroom lead | `/learning/chatroom`, group messages, AI agent mentions, export/share UI flow | `src/app/learning/chatroom/`, chatroom sections of `src/components/pages/learning-page.tsx`, `src/lib/chat-actions.ts`, chat/agent sections of `src/data/uais.ts` | Global shell, teacher workspace, real provider credentials, package/config files | Available | Log in `coordination/session-logs/YYYY-MM-DD-S04.md` |
| `S05` | Teacher workspace lead | `/teaching`, teacher course cards, operations menu, teacher management placeholder surfaces | `src/app/teaching/`, `src/components/pages/teaching-page.tsx`, teacher sections of `src/data/uais.ts` | Learner/chat behavior, global provider state, package/config files | Available | Log in `coordination/session-logs/YYYY-MM-DD-S05.md` |
| `S06` | Design system and CSS lead | Global CSS variables, Tailwind v4 usage, light/dark color tokens, responsive visual polish | `src/app/globals.css`, design-only edits in `src/components/layout/` and `src/components/pages/` by coordination | Product data semantics, route behavior, tests except visual-supporting selectors, secrets | Available | Log in `coordination/session-logs/YYYY-MM-DD-S06.md` |
| `S07` | AI agent model lead | Research/methods/math/writing agent definitions and future provider integration boundary | Agent sections of `src/data/uais.ts`, future `src/lib/ai/`, future `src/app/api/ai/`, redacted provider docs in `coordination/` | Real `.env*` secret files, chat UI changes without S04, shared copy without S09, deployment config without S22 | Available | Log in `coordination/session-logs/YYYY-MM-DD-S07.md` |
| `S08` | Data contract lead | UAIS mock data, domain types, acceptance data invariants | `src/data/uais.ts`, `tests/uais-data.test.ts` for data-contract coverage | Page rewrites outside direct integration needs, real backend/provider work, package/config files | Available | Log in `coordination/session-logs/YYYY-MM-DD-S08.md` |
| `S09` | Copy, i18n, accessibility lead | Bilingual copy, locale behavior, accessible labels, terminology consistency | `src/i18n/copy.ts`, `src/components/ui/localized-text.ts`, copy-only or aria-only edits inside another session's owned files after coordination | Business logic, route rewrites, package/config files, real env files | Available | Log in `coordination/session-logs/YYYY-MM-DD-S09.md` |
| `S10` | Tooling, docs, report lead | Project docs, coordination, scripts, config, executive reporting | `README.md`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.mts`, `coordination/` | Feature implementation inside other sessions' scopes unless assigned | Available | Log in `coordination/session-logs/YYYY-MM-DD-S10.md` |
| `S11` | QA and release quality lead | Regression quality, Vitest coverage, QA matrices, release readiness | `tests/`, QA reports in `coordination/reports/`, release-readiness checklists, non-feature test helpers | Feature implementation in `src/app/`, `src/components/`, `src/lib/`, or `src/data/` unless explicitly assigned | Available | Log in `coordination/session-logs/YYYY-MM-DD-S11.md` |
| `S12` | Backend/API platform lead | Future route handlers, server actions, auth/session/storage platform | Future `src/app/api/`, future `src/lib/server/`, backend API tests, server storage architecture by coordination | Current feature UI pages, real `.env*`, AI/provider behavior without S07 coordination, package/config files unless assigned | Available | Log in `coordination/session-logs/YYYY-MM-DD-S12.md` |
| `S13` | Course operations lead | Teacher course settings, content management, invite-code flows, future management pages | Future `src/app/teaching/` subroutes, future `src/components/teaching/`, teacher operation data by coordination | Learner/chat UI, backend implementation without S12, shared i18n decisions without S09 | Available | Log in `coordination/session-logs/YYYY-MM-DD-S13.md` |
| `S14` | Student and group collaboration lead | Student roster, group membership, collaboration records, future group dashboards | Future `src/components/students/`, future `src/app/learning/groups/`, group-related data by coordination | Teacher operation internals, AI provider behavior, auth/session internals | Available | Log in `coordination/session-logs/YYYY-MM-DD-S14.md` |
| `S15` | Adaptive learning lead | Future adaptive recommendations, learner playback semantics, progress personalization | Future `src/lib/adaptive-learning.ts`, future adaptive tests, adaptive-specific data reports | Current chatroom provider behavior without S07/S04 coordination, broad UI rewrites, shared types without S08 coordination | Available | Log in `coordination/session-logs/YYYY-MM-DD-S15.md` |
| `S16` | Research and pedagogy lead | MAIC-informed design rationale, teaching/learning science notes, evaluation design | `coordination/reports/`, future `coordination/research/`, research notes, evaluation rubrics | Feature code unless explicitly assigned, unverified latest-research claims without source/date, private/proprietary corpus exposure | Available | Log in `coordination/session-logs/YYYY-MM-DD-S16.md` |
| `S17` | Engagement and motivation lead | Badges, participation nudges, classroom activity loops, lightweight learner motivation | Future `src/lib/engagement.ts`, future `src/components/engagement/`, engagement reports | Actual course content correctness, backend storage without S12, broad UI rewrites without owning sessions | Available | Log in `coordination/session-logs/YYYY-MM-DD-S17.md` |
| `S18` | Content QA lead | Course content quality, answer/assignment validation, university teaching alignment | Content QA reports under `coordination/content-qa/`, review notes for course data | Content generation pipeline ownership, large direct edits to live source data without assignment, UI rewrites, unverified curriculum claims | Available | Log in `coordination/session-logs/YYYY-MM-DD-S18.md` |
| `S19` | API configuration and deployment env lead | Local API environment configuration, Vercel variables, provider readiness, redacted env inventories | Owner-assigned `.env.local` configuration only when explicitly approved, `.env.local.example` if added, redacted API configuration reports in `coordination/` | API/provider business logic, feature UI, writing real secrets to Git/logs/reports/screenshots/command output | Available | Log in `coordination/session-logs/YYYY-MM-DD-S19.md` |
| `S20` | Interactive learning tool lead | Future simulations, quizzes, practice widgets, lightweight educational interactivity | Future `src/app/tools/`, future `src/components/tools/`, future `src/lib/interactive/`, tool-specific tests | Existing course plaza/teacher/chat surfaces without coordination, copyrighted assets, provider/env behavior | Available | Log in `coordination/session-logs/YYYY-MM-DD-S20.md` |
| `S21` | Content pipeline and knowledge-base lead | Future course knowledge-base intake, generated handoff packages, local/private corpus handling | Future `coordination/content-pipeline/`, future `data/generated-content/`, future ignored `.local/knowledge-base/`, content pipeline reports | Final content QA signoff, live app integration without owning sessions, committing raw copyrighted/private corpus text | Available | Log in `coordination/session-logs/YYYY-MM-DD-S21.md` |
| `S22` | Production reliability and release engineering lead | Build/dev-server isolation, Vercel hygiene, local/production parity, release-blocker root cause | `next.config.ts`, `.vercelignore` if added, release/deployment reports in `coordination/reports/`, owner-assigned build/deploy scripts and config changes by S10 coordination | Feature bug fixes in `src/` unless explicitly assigned, test assertion ownership without S11 coordination, real env files | Available | Log in `coordination/session-logs/YYYY-MM-DD-S22.md` |
| `S23` | Integration and promotion lead | Candidate-to-live promotion planning, release intake, cross-session handoff sequencing | `coordination/integration/`, integration reports in `coordination/reports/`, owner-assigned adapter/source integration files only when explicitly listed | Direct live data/source edits without explicit owner assignment and owning-session coordination, final QA signoff, regression ownership | Available | Log in `coordination/session-logs/YYYY-MM-DD-S23.md` |
| `S24` | Asset and export quality lead | Visual assets, PDF/export quality, deterministic rendering handoffs, media provenance | `public/` assets by assignment, export-quality reports, deterministic asset manifests in `coordination/` | Real PDF service credentials, final content QA, unrelated UI routes/components, copyrighted/private assets without licensed owner-provided sources | Available | Log in `coordination/session-logs/YYYY-MM-DD-S24.md` |
| `S25` | Git hygiene and release intake lead | Dirty-tree inventory, ownership mapping, PR/commit slicing recommendations, conflict detection, non-destructive Git status reporting | `coordination/release-intake/`, git hygiene reports in `coordination/reports/`, release intake checklists, ownership/conflict maps, S25 session logs | Staging, committing, branching, merging, rebasing, pushing, deleting, resetting, or reverting files unless explicitly assigned by the owner; feature code edits; secret files | Available | Log in `coordination/session-logs/YYYY-MM-DD-S25.md` |

### Shared Files Requiring Explicit Coordination

These files affect many sessions and should be edited by only one assigned session at a time:

- `src/data/uais.ts`
- `src/i18n/copy.ts`
- `src/components/ui/localized-text.ts`
- `src/components/providers/app-preferences.tsx`
- `src/components/layout/`
- `src/components/pages/learning-page.tsx`
- `src/components/pages/course-plaza-page.tsx`
- `src/components/pages/teaching-page.tsx`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- route folders under `src/app/`
- `src/lib/chat-actions.ts`
- `tests/`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `next.config.ts`
- `eslint.config.mjs`
- `postcss.config.mjs`
- `vitest.config.mts`
- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `public/`
- future `.env.local.example`
- future `.vercelignore`
- future `src/app/api/`
- future `src/lib/server/`
- future `coordination/content-qa/`
- future `coordination/content-pipeline/`
- future `coordination/integration/`
- future `coordination/release-intake/`

If a task needs one of these files and it is outside the session's allowed scope, the session must stop and write a blocker report unless the assignment explicitly grants ownership.

Default shared-area ownership:

- `tests/` belongs to S11 for suite structure, release gates, broad regression matrices, and product assertions. Feature sessions may add focused tests only inside an explicit assignment and should coordinate broad test architecture with S11.
- Build/deploy config belongs to S22 for release reliability, with docs/package coordination through S10.
- Future `src/app/api/` and `src/lib/server/` belong to S12 for backend contracts.
- `src/data/uais.ts` belongs to S08 for shared type semantics and data invariants. Feature sessions may edit their assigned section only when the assignment names that section.
- `src/i18n/copy.ts` and localization helpers belong to S09 for bilingual consistency and accessibility language.
- `src/app/globals.css` belongs to S06 for design tokens and visual system changes; route owners may make local class changes inside their assigned files.
- `src/lib/chat-actions.ts` belongs to S04 while it remains a chatroom export/share helper. Future server export work must coordinate with S12/S24.
- S19 owns redacted API environment inventory and owner-assigned local/Vercel secret placement. S19 does not own API/provider behavior.
- S25 owns non-destructive git hygiene and release intake. S25 may inventory dirty-tree state, map file ownership, and recommend PR/commit slices, but must not mutate Git state without explicit owner instruction.

## Work Assignment Rules

When assigning work, give each session a clear package:

- Session ID: one of `S01` to `S25`.
- Objective: the result expected by morning or by the end of the work period.
- Write scope: exact files/directories the session may edit.
- Forbidden scope: files/directories the session must not edit.
- Acceptance criteria: what must be true for the task to be complete.
- Checks: commands or manual checks expected before handoff.
- Stop conditions: decisions that require owner input.

Before editing, each session must:

1. Read this `AGENTS.md`.
2. Read the current assignment.
3. Inspect `git status --short`.
4. Inspect the relevant files.
5. Create or update its session log when working as an assigned numbered session.
6. Write a short plan with intended files to change.
7. Confirm the plan stays inside the assigned write scope.

After editing, each session must report:

- What changed.
- Files changed.
- Tests/checks run, with results.
- Tests/checks not run, with reasons.
- Assumptions made.
- Risks found.
- Blockers or follow-up work.

## Nightly AI Coordination Meeting

Use this workflow when the owner assigns work before sleeping. This is an asynchronous coordination meeting, not a free-form real-time chat. The meeting happens through session logs, blocker reports, handoff notes, and S10's morning synthesis.

Default reporting window:

- Previous day 08:00-current day 08:00 Asia/Hong_Kong: S10 or the reporting automation summarizes AI session work, risks, blockers, test status, and decisions needed.
- 08:00 Asia/Hong_Kong: reporting window closes for the daily president report.
- 07:45 Asia/Hong_Kong: assigned agents stop starting large new edits and complete handoff notes for inclusion when practical.
- 07:50-08:00 Asia/Hong_Kong: S10 reviews logs, blockers, changed files, and check results.
- 08:00 Asia/Hong_Kong: S10 or a Codex automation produces the DOCX president report for Dr. Peter Hu.

Participation rules:

1. Only sessions explicitly assigned by the owner for that night may write feature code.
2. Unassigned sessions may be referenced in logs or reports, but they do not write code or make decisions.
3. S10 is the meeting secretary, quality coordinator, and president-report owner.
4. S10 may read every session log and blocker report, but should not edit another session's log except as part of the morning report process.
5. S10's default write scope for nightly coordination is `coordination/`, docs, config, and reports; S10 must not implement feature work inside non-S10 session scopes unless the owner explicitly assigns that work.
6. If no work or assignment exists in the previous-day-08:00-to-current-day-08:00 reporting window, S10's report should state `No assigned work in this reporting window` and summarize only the latest available project status.

Nightly meeting rhythm:

1. 00:00 kickoff: S10 checks the owner's assignments, confirms each assigned session's write scope, and notes any obvious scope conflicts.
2. 02:30 checkpoint: assigned agents record current progress, risks, changed files so far, and any scope or dependency conflict.
3. 05:30 checkpoint: assigned agents prioritize blockers, test status, cross-role dependencies, and any work that must stop before morning.
4. 07:45 handoff: assigned agents finish their Agent Daily Work Report entries and avoid starting broad new changes.
5. 07:50-08:00 synthesis: S10 reads session logs and blockers from the reporting window, inspects project status, runs safe checks when practical, and writes the president report.

Nightly outputs:

- Agent daily work reports: `coordination/session-logs/YYYY-MM-DD-SXX.md`
- Blocker reports when needed: `coordination/blockers/YYYY-MM-DD-SXX.md`
- President report for Dr. Peter Hu: `coordination/reports/YYYY-MM-DD-president-report.docx`

Sessions must stop instead of guessing when they encounter:

- Risky architecture decisions that affect multiple workstreams.
- Destructive operations such as deleting large sections, resetting files, or replacing app structure.
- Secrets, production credentials, or requests to edit `.env.local`, except for owner-assigned S19 API configuration tasks.
- Unclear requirements that could send the project in two incompatible directions.
- Merge conflicts or simultaneous edits to the same file.
- Package upgrades or dependency changes not included in the assignment.
- Any need to revert unrelated user or session changes.

## Coordination Rules

- One file should have one writer at a time.
- Use separate session logs, not a shared live scratch file, to avoid log conflicts.
- Do not edit another session's log except for the morning report process.
- Do not update the session table above during parallel work unless the owner assigned you to coordinate status.
- Put live status, decisions, and handoff notes in the session log.
- If two tasks need the same shared file, split the work by time: one session finishes and hands off before the next starts.
- Prefer additive, local changes over large cross-project rewrites.
- Do not change public behavior outside the assignment unless needed to fix a bug introduced by the task.
- Do not touch generated runtime output directories.
- S11 may write tests, QA reports, and release-readiness matrices, but must not fix feature bugs outside an explicit owner assignment.
- S12 owns future route contracts and backend architecture; feature UI owners keep workflow decisions and should coordinate API needs with S12.
- S16 owns research evidence, theory assumptions, evaluation design, and educational-validity memos; S16 must not implement feature code unless explicitly assigned.
- S18 owns independent course/content QA evidence and content-quality reports. Direct edits to course data require an explicit assignment and coordination with S02/S03/S04/S05/S08 as appropriate.
- S21 owns future content pipeline and knowledge-base operations. Raw local/private corpus text must remain in ignored local storage unless the owner documents rights and explicitly approves public exposure.
- S22 owns production reliability and release engineering, including build/dev-server isolation, Vercel deployment hygiene, local/production parity checks, and release-blocker root-cause reports.
- S25 owns non-destructive git hygiene, dirty-tree inventory, ownership maps, PR/commit slicing recommendations, and release intake triage.

Recommended coordination paths:

- Session logs: `coordination/session-logs/YYYY-MM-DD-SXX.md`
- Blockers: `coordination/blockers/YYYY-MM-DD-SXX.md`
- President reports: `coordination/reports/YYYY-MM-DD-president-report.docx`
- Other project reports: `coordination/reports/YYYY-MM-DD-report-name.md`

These folders may be created by the first session that needs them.

## Quality Bar

Every completed code task must run the relevant checks before handoff:

- Documentation-only changes: no code check required, but say "Not run: documentation-only change."
- Data contract changes: run `npm run test`; run `npm run lint` when TypeScript or import structure changes.
- Copy/i18n changes: run `npm run test` when data/copy contracts are affected; otherwise inspect the touched UI route when practical.
- Route, provider, or app-wide changes: run `npm run lint`; run `npm run build` when the change affects routing, config, imports, metadata, server/client boundaries, or hydration behavior.
- Visual UI changes: run `npm run lint`; if a dev server is available, inspect the affected route in the browser.
- Chatroom export/share changes: run `npm run test` and `npm run lint`.
- Backend/API platform changes: coordinate with S12, then run `npm run lint`, `npm run build`, and targeted API tests when present.
- E2E/regression-matrix changes: coordinate broad suite structure with S11; run `npm run test` or the targeted Playwright command if one is added.
- Production reliability/release engineering changes: coordinate with S22; run the narrowest meaningful build/dev-server/deploy harness checks, usually `npm run lint`, `npm run build`, and documented Vercel preview verification when available.
- API environment configuration changes: coordinate with S19. For docs or environment-variable placement only, no code check is required; say "Not run: configuration/documentation-only change." For live-provider smoke tests, use owner-approved credentials only, redact all values, and document provider cost/rate-limit risk.
- Package/config changes: coordinate with S10 and S22 when release/build behavior is affected, then run `npm install` only if dependency files require it, followed by `npm run lint`, `npm run test`, and usually `npm run build`.

If a check cannot be run, the session must explain why and state the remaining risk.

S11 owns regression-matrix upkeep and release-quality gate reporting. S10 owns president-report synthesis and coordination reporting. S16 owns research evidence quality. S18 owns content quality. S19 owns API environment configuration quality and redacted local/Vercel deployment-env parity checks. S22 owns production reliability and release-engineering quality. S25 owns non-destructive git hygiene and release intake quality.

## 8 AM President Report

At 8:00 AM Asia/Hong_Kong time, S10 or the recurring reporting automation should create a concise, business-formatted bilingual DOCX president report for Dr. Peter Hu covering the reporting window from the previous calendar day at 08:00 to the report date at 08:00 Asia/Hong_Kong.

The report should be generated from:

- All session logs in `coordination/session-logs/`.
- Blocker reports in `coordination/blockers/`.
- Current project files changed during the reporting window.
- Available check outputs from each session.
- Fresh checks run by the report owner when practical.

The report should summarize:

- Chinese Executive Summary.
- English Executive Summary.
- Reporting-window summary.
- Overall project progress.
- Completed work by session.
- In-progress work.
- Blockers.
- Risks.
- Test/build status.
- Files changed.
- Tomorrow priorities.
- Owner decisions needed.

The final artifact should be `coordination/reports/YYYY-MM-DD-president-report.docx`, with simple business formatting: clear title metadata, concise bilingual executive summaries, readable tables, restrained typography, and no decorative layout. A temporary Markdown outline may be used only as an intermediate working artifact; the deliverable for Dr. Peter Hu is the DOCX file.

If the environment supports recurring Codex automations, ask Codex to create a daily 8:00 AM Asia/Hong_Kong automation for this project with a prompt like:

```text
Every day at 8:00 AM Asia/Hong_Kong, inspect /Volumes/Starship/UAIS. Read AGENTS.md, collect the latest session logs and blockers from coordination/, inspect the project status, run safe relevant checks when practical, and produce a concise bilingual DOCX president report for Dr. Peter Hu at coordination/reports/YYYY-MM-DD-president-report.docx. The reporting window is previous calendar day 08:00 through report date 08:00 Asia/Hong_Kong. The report must include a Chinese Executive Summary, English Executive Summary, reporting-window summary, project progress update, S01-S25 session status table, blockers, risks, test/build status, files changed, tomorrow priorities, and owner decisions needed. Use simple business formatting with readable tables and restrained typography. If no assignment or fresh work is found in the reporting window, state "No assigned work in this reporting window" and summarize the latest available project status. Do not edit feature code.
```

Do not ask the automation to edit feature code unless the owner explicitly assigns that work. The morning automation's default job is reporting and triage.

## Templates

### Session Assignment Template

```markdown
# Session Assignment

- Date:
- Session ID:
- Workstream:
- Objective:
- Allowed write scope:
- Forbidden write scope:
- Acceptance criteria:
- Required checks:
- Stop conditions:
- Notes from owner:
```

### Nightly Assignment Template

Use this when the owner assigns night work before resting.

```markdown
# Nightly Assignment

- Date:
- Night work window: 00:00-08:00 Asia/Hong_Kong
- President-report window: Previous day 08:00-current day 08:00 Asia/Hong_Kong
- Assigned sessions:
- Meeting secretary: S10
- Reporting deadline: 8:00 AM Asia/Hong_Kong

## Session Packages

| Session | Workstream | Objective | Allowed write scope | Forbidden write scope | Acceptance criteria | Required checks | Stop conditions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SXX |  |  |  |  |  |  |  |

## Cross-Session Notes

- Shared files reserved tonight:
- Known dependencies:
- Owner priorities:
- Decisions already made:
```

### Session Handoff Template

```markdown
# Session Handoff

- Date:
- Session ID:
- Workstream:
- Status: Completed | In progress | Blocked
- Summary:
- Files changed:
- Checks run:
- Checks not run:
- Assumptions:
- Blockers:
- Risks:
- Follow-up recommendations:
- Next suggested owner/session:
```

### Agent Daily Work Report Template

Append this to the agent's own `coordination/session-logs/YYYY-MM-DD-SXX.md` before stopping.

```markdown
# Agent Daily Work Report

- Date:
- Session ID:
- Workstream:
- Status: Completed | In progress | Blocked
- Objective:
- Summary of work completed:
- Files changed:
- Checks run:
- Checks not run:
- Blockers:
- Risks:
- Assumptions:
- Coordination notes for other sessions:
- Follow-up recommendations:
- Next suggested owner/session:
```

### Blocker Report Template

```markdown
# Blocker Report

- Date:
- Session ID:
- Task:
- Blocker type: Architecture | Scope conflict | Secret/credential | Missing requirement | Merge conflict | Dependency change | Other
- What happened:
- Files involved:
- Why the session stopped:
- Decision needed from owner:
- Safe next step:
```

### President Report DOCX Content Template

Use this content order for the DOCX president report. The DOCX should be concise, bilingual, and business-formatted with clear headings, readable tables, and restrained typography.

```text
President Report

Report date:
Report time: 8:00 AM Asia/Hong_Kong
Project: UAIS
Reporting session: S10
Audience: Dr. Peter Hu
Reporting window: Previous day 08:00-current day 08:00 Asia/Hong_Kong

中文 Executive Summary

用中文简要说明项目健康度、报告窗口内是否推进、最重要成果、最大风险，以及今天最需要 Dr. Peter Hu 决策的事项。

English Executive Summary

Briefly summarize project health, whether work in the reporting window moved the project forward, the most important outcomes, the largest risks, and decisions needed from Dr. Peter Hu.

Reporting Window Summary

Assigned sessions:
Sessions active:
No assigned work in this reporting window: Yes | No
Coordination highlights:
Cross-session dependencies:

Project Progress

Short summary of current product progress, quality status, and whether the work improved speed, quality, or readiness.

Session Results

Create a table with columns:
Session | Status | Completed | In progress | Blockers | Files changed | Checks

Include rows for S01 through S25.

Completed Work

-

In-Progress Work

-

Blockers

-

Risks

-

Test and Build Status

`npm run lint`:
`npm run test`:
`npm run build`:
Other checks:

Files Changed

-

Recommended Priorities

1.
2.
3.

Owner Decisions Needed

-
```

## Quick Start For Tonight

1. Pick only the sessions you want to run, for example `S02`, `S04`, `S05`, `S08`, and `S11`.
2. Give each selected session one package using the Nightly Assignment Template.
3. Keep write scopes separate. Example: do not assign both `S04` and `S08` to edit `src/data/uais.ts` overnight unless one finishes and hands off before the other starts.
4. Tell each selected session to create or update its own log in `coordination/session-logs/`.
5. Tell S10 to act as meeting secretary and prepare `coordination/reports/YYYY-MM-DD-president-report.docx`.
6. If no assignment is given, the 8:00 AM report should say `No assigned work in this reporting window`.

## Imported Claude Cowork project instructions
