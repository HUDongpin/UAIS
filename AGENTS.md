<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md - UAIS Working Guide

This contract applies to work in `/Volumes/Mars/UAIS`.

Workspace location confirmed on 2026-10-02 (Asia/Hong_Kong): the owner copied UAIS from `/Volumes/Starship/UAIS` to `/Volumes/Mars/UAIS` and designated the Mars copy for ongoing work. Use `/Volumes/Mars/UAIS` for future UAIS tasks; treat Starship paths in historical records as former locations.

## Scope and execution

- Apply inherited and directory rules within their stated scope. The user's current request is the assignment; complete it without a second approval or a formal assignment template. Higher-priority runtime instructions and explicit user exclusions remain binding.
- For implementation or repair, infer the smallest set of directly related files needed for a correct result, including supporting source, types/data, bilingual copy and focused regression tests. The user need not name every file or data section. An explicit pathspec remains a hard boundary.
- Read-only requests authorize relevant investigation and findings, not repairs or extra report files. Match effort, deliverables and verification to the requested outcome; do not expand a small task into a release, research or audit workflow.
- Resolve routine, reversible implementation choices from context. Choose the simplest complete solution: directly fix existing logic when appropriate, and avoid wrappers, duplicate implementations, compatibility branches, fallback paths or general frameworks without a current requirement or concrete evidence of need. Keep unrelated refactors and dependency upgrades out of scope.
- Fix regressions directly introduced by the task within its objective, including necessary supporting edits across responsibility labels. A role label alone is not a reason to stop; explicit path exclusions, actual concurrent writes and unrelated public behavior remain boundaries.
- Ask only when missing information materially changes correctness, scope or authorization, or an unresolved product/architecture choice materially affects work outside the task. Pause only the affected step for missing credentials/access, actual write conflicts, an unauthorized destructive/Git/production action, or work outside explicit limits. Continue independent authorized work; do not substitute providers, targets or simulated evidence to bypass a blocker.
- S01-S25 are responsibility labels, not an approval chain. Coordinate only for a known active writer, reserved surface or actual overlapping assignment. No active counterpart means there is no role-based approval to await. Do not launch agents solely to satisfy a role label; use delegation only when permitted by the current runtime and task.
- State a brief plan/update with a relevant session label, then act. A plan is not completion. Ordinary tasks need only a conversational handoff with changed files, checks and material limitations; do not create logs, meetings or report templates unless the task calls for them.
- Completion means the requested result is reviewable and applicable checks have run or their limits are reported. Distinguish edits, tests, commits, pushes, deployment and live acceptance. A blocked check is a verification gap, not a pass; once the task and relevant checks are complete, report the result without adding unrelated work.

## Workspace and authorization

- Use the current assigned workspace for ordinary tasks. Inspect `git status --short --untracked-files=all` and the relevant diffs before editing and before handoff. Preserve pre-existing work. Dirty files alone do not prove an active writer; use the available diff and coordination evidence to identify actual overlap.
- Authorized work may proceed alongside unrelated uncommitted changes when those changes can be preserved. Editing a dirty target requires understanding and retaining its existing work; coordinate if an active writer overlaps. Do not require the user to repeat a special phrase authorizing preservation of dirty state.
- A separate branch/worktree is needed only when the assignment requires isolation or the current workspace cannot safely support the task. Creation/removal still needs the applicable explicit authorization; do not create one or demand one merely for an ordinary scoped edit.
- Permission to edit does not itself authorize staging, committing, branching, creating/removing worktrees, stashing, merging, rebasing, pushing, resetting, reverting, deleting files or important data, publication, external messages, or credential changes. Use existing authorization when it covers the exact operation and target; never ask for the same authorization twice. Never revert unrelated work or manipulate Git to manufacture a clean handoff.
- Apply `npm run release:clean-check` when the assigned release step requires a clean checkout or before claiming a clean release. Ordinary incremental edits use the status and overlap checks above. A failed release check blocks that release claim, not independent authorized edits that preserve existing work; do not repeatedly run an unchanged failed check.
- For assigned dirty-root rescue, run `npm run release:dirty-map -- --reason "<short reason>"` first. Ordinary edits and read-only diagnosis do not trigger rescue intake. If staging is separately authorized, use explicit pathspecs, never `git add .` for rescue/release slices.
- Do not manually edit generated/local outputs (`node_modules/`, `.next/`, `.tmp/`, `tsconfig.tsbuildinfo`, `.DS_Store`). Relevant build/test commands may generate normal outputs; avoid concurrent processes sharing output directories. This does not authorize cleanup or deletion of evidence.
- For assigned evidence refreshes, update the canonical report or use ignored `.scratch/` storage; do not accumulate timestamped root probes. Preserve historical receipts and other sessions' logs. Archive/remove reports only under an authorized cleanup scope.

## Project Snapshot

- UAIS is a personal teaching website template for `uais.top`, supporting University AI System and University Adaptive Interactive System.
- Product: course plaza cards, learner playback, human-AI group chat and teacher course management, informed by MAIC patterns. Do not copy private screenshots, identities, proprietary assets or protected MAIC content.
- Stack: Next.js App Router, React 19, strict TypeScript, Tailwind CSS v4, Phosphor Icons and Vitest. Use `npm` scripts from `package.json`.
- `npm run dev`: local dev server. `npm run build`: local production build. `npm run start`: serve an existing production build. `npm run lint`: ESLint.
- `npm run test`: deterministic Vitest via `scripts/run-deterministic-tests.mjs`, excluding designated live-database tests. `npm run test -- <test-file>` selects focused coverage when the Quality Bar does not require the full suite.
- `npm run release:package-gate`: dirty-map coverage against an explicit review-slice pathspec, for assigned release packaging.
- Keep the generated Next.js block above intact. Read the relevant installed guide before version-sensitive Next.js API, routing, configuration or server/client changes; documentation-only work and unrelated tooling do not require a Next.js documentation sweep. If the installed guide is missing, report the gap and consult matching official documentation. The generated comment about committing is not commit authority.

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

- This guide does not declare a UAIS-specific owner-approved credential document. That is not proof that no approved source exists; use any source already explicitly authorized for this task and target, within that authorization.
- Do not reuse or copy credentials from `/Users/dongpinhu/Desktop/MAIS-MVP` for UAIS unless the owner explicitly authorizes that provider and target environment.
- Never copy, print, summarize, commit, stage, screenshot, or log real credential values from `.env.local`, Vercel, documents, browser sessions, or any other secret source.
- If UAIS work requires a provider key, deployment token, email credential, PDF service, or live AI provider, first check the current assignment for existing provider/source/target authorization. Ask only for missing authorization or information; pause the credential-dependent steps and continue independent authorized work. Do not search unrelated credential stores or reuse MAIS-MVP credentials to fill the gap. Using an approved credential does not by itself authorize changing secret placement, sending messages, publishing, or deploying.
- Real secret-file changes remain explicitly authorized S19 configuration work. Encountering a secret-like file in status only calls for a redacted category; do not inspect its values for inventory. Raw local/private corpus stays in ignored local storage unless rights and public exposure are explicitly approved.

## Production boundaries

- As of 2026-08-18 the Vercel project `uais` is connected to `HUDongpin/UAIS`, so **pushing `main` deploys production at `uais.top` automatically**. A production build runs `npm run vercel-build`, which applies migrations to the live database before `next build`. Treat a push to `main` as a release action, not a save: it needs the same care as `vercel --prod`.
- Preview deployments are switched off in `vercel.json` via `git.deploymentEnabled` (`*` and `**` false, `main` true), so feature/agent branch pushes do not trigger a deployment under this configuration. Keep it that way unless preview gets its own database and deployment is explicitly authorized. The recorded environment configuration scopes `DATABASE_URL`/`POSTGRES_URL` to "Production, Preview" and points both at the **production** database; treat that as a live-data boundary until S19 verifies isolation for the exact target. The migration runner in deploy mode skips when `VERCEL_ENV` is set and is not `production`; an absent `VERCEL_ENV` does not provide that protection, and application writes are not protected by the migration guard. Both `*` and `**` are listed because minimatch `*` does not cross `/`, and this project's agent branches are named `claude/...` and `codex/...`.
- Use `npm run build` for applicable local build validation. `npm run vercel-build`, migration commands, provider smoke tests, and deployment commands are not interchangeable local checks: verify the target and existing authorization before a command that can access services, incur cost, or mutate a database. The dated deployment and environment facts above are operating constraints, not fresh proof of remote state.

## Quality Bar

Select checks from the affected contracts below and any explicit acceptance criteria. Investigation alone does not require a full test run, and documentation-only work does not become a code task because it mentions commands. Keep the full-suite requirements for shared data, chatroom export/share, and package/config changes below; use focused tests for other bounded changes when they cover the affected behavior. Explicit release gates remain required for the assigned release step.

Run each applicable check before claiming its result. After checks pass, repeat or broaden them only for subsequent changes, failures, or unresolved risks. Add regression tests when changed behavior needs protection; do not add tests that merely duplicate a prose edit. Coordinate broad test structure only when an active S11 assignment or reserved test surface overlaps; focused regression tests are part of the feature task.

- Documentation-only changes: inspect the diff for correctness, internal consistency, and unintended changes; no code check required, but say "Not run: documentation-only change."
- Data contract changes: run `npm run test`; run `npm run lint` when TypeScript or import structure changes.
- Copy/i18n changes: run `npm run test` when data/copy contracts are affected; otherwise inspect the touched UI route when practical.
- Route, provider, or app-wide changes: run `npm run lint`; run `npm run build` when the change affects routing, config, imports, metadata, server/client boundaries, or hydration behavior.
- Visual UI changes: run `npm run lint`; if a dev server is available, inspect the affected route in the browser.
- Chatroom export/share changes: run `npm run test` and `npm run lint`.
- Backend/API platform changes: run `npm run lint`, `npm run build`, and targeted API tests when present.
- E2E/regression-matrix changes: run `npm run test` or the targeted Playwright command if one is added.
- Production reliability/release engineering changes: run the narrowest meaningful build/dev-server/deploy harness checks, usually `npm run lint` and `npm run build` when code or build behavior changes. Preview verification applies only after target isolation and explicit deployment authorization are established; do not enable preview or use the shared production database just to complete a check.
- API environment configuration changes: S19 is the responsibility label for authorized environment work. For docs or environment-variable placement only, no code check is required; say "Not run: configuration/documentation-only change." For live-provider smoke tests, use owner-approved credentials only, redact all values, and document provider cost/rate-limit risk.
- Package/config changes: run `npm install` only if dependency files require it, followed by `npm run lint`, `npm run test`, and usually `npm run build`.

If a check cannot run or fails, report the exact command, reason, and remaining risk. Distinguish failures caused by this change from pre-existing failures; do not fix unrelated code without authorization. Complete independent checks that remain useful. Do not turn a test recommendation into permission for live provider calls, database writes, migrations, deployment, or external messages. A local build/test result is not live acceptance evidence.

## On-demand coordination guides

Read only the reference needed for the current task. These guides do not activate extra work, authorizations, agents or reports by their presence.

- [Session and shared-file reference](coordination/agent-guides/session-ownership.md): when selecting roles or checking actual shared-file overlaps. The task-based scope rules above govern ordinary work across labels.
- [Release coordination](coordination/agent-guides/release-coordination.md): only for assigned multi-owner release intake, unresolved integration ownership conflicts or reconciling candidate release evidence.
- [Nightly coordination and reporting](coordination/agent-guides/nightly-reporting.md): only for assigned overnight, coordinated reporting or president-report work. Includes assignment/handoff/report templates; time of day alone never starts this workflow or an automation.
