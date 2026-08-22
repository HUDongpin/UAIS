# UAIS Staging Readiness Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` task-by-task. Every behavior change follows RED -> GREEN -> regression verification. The initial S23 run was not authorized to stage or commit. On 2026-08-23 the owner authorized takeover review and local exact-pathspec commits in this integration worktree only. Branch switching, merging, rebasing, pushing, resetting, destructive cleanup, production deployment, production migration, and production environment or feature-flag changes remain unauthorized.

**Goal:** Remove the five independently verified integration blockers, preserve the approved P1/P2 contracts, and then collect same-candidate evidence for the isolated staging release gates.

**Architecture:** The generic learner-event route admits only browser-origin event types, converts caller-supplied or derived idempotency material into a fixed-length server-side digest, and authorizes against an existing, internally consistent course/class/owner relational scope. A learner event never creates or repairs that scope: a missing or inconsistent projection fails closed with a recoverable `409` until a separate audited backfill has run. The P2 staging harness mirrors the post-0009 schema and rejects both source and restore Neon production identities before migration or writes.

**Tech Stack:** Next.js 16.3.2 App Router, React 19, TypeScript strict mode, Vitest, PostgreSQL/Neon, Vercel, Playwright.

---

### Task 1: Harden browser-origin learning-event ingestion

**Files:**

- Modify: `tests/learning-loop-events-api.test.ts`
- Modify: `tests/learning-loop-postgres-store.test.ts`
- Modify: `src/app/api/learning-records/events/route.ts`
- Modify: `src/lib/server/learning-ppt-playback-access.ts`

- [x] Add route tests proving every teacher/server-authoritative event type is rejected before authorization/persistence, while `course.viewed`, `lesson.viewed`, `activity.attempted`, `question.answered`, `course.completed`, `ai.feedback.requested`, and `collaboration.contributed` remain eligible.
- [x] Add a route test proving an explicit key containing `/` and a long default event identity are converted to the grammar `learning-event:[0-9a-f]{64}` without truncation collisions.
- [x] Add a route test proving only authorization-derived course/class/teacher metadata reaches persistence; client-forged class metadata remains ignored.
- [x] Add a store test proving a missing `uais_courses`/`uais_classes` projection returns a recoverable `409` and performs no implicit course/class insert.
- [x] Run the three focused test files and record the expected RED failures.
- [x] Add a closed browser-origin event allowlist to the route input validator.
- [x] Replace raw/truncated route idempotency keys with a SHA-256 digest over explicit ordered input:

  ```ts
  createHash("sha256")
    .update(JSON.stringify({ actorId, requestedKey, event }))
    .digest("hex")
  ```

- [x] Require every successful student playback decision to prove that the approved membership class belongs to the requested course and that its owner matches the course owner.
- [x] Keep relational backfill outside the event request path; missing scope remains fail-closed until an explicit, audited migration/backfill process creates it.
- [x] Re-run focused tests to GREEN, then run related playback/access tests.

### Task 2: Align the P2 staging harness with migration 0009 and symmetric identity guards

**Files:**

- Modify: `tests/p2-operations-gates.test.ts`
- Modify: `scripts/p2-staging-build.mjs`
- Modify: `scripts/p2-staging-live-load.mjs`

- [x] Add source-contract tests proving the seed supplies `idempotency_key`, `schema_version`, `source`, and `projection_version`; capture/restore also preserves `assessment_id`, `submission_id`, and the learner-profile `progress`, `projection_version`, and `last_event_at` columns.
- [x] Add build/live-load tests proving `RESTORE_NEON_PROJECT_ID === PRODUCTION_NEON_PROJECT_ID` fails before migration, connection use, or writes.
- [x] Run `tests/p2-operations-gates.test.ts` and record the expected RED failures.
- [x] Update the tagged fixture event insert, capture, and restore column maps to match the migrated schema exactly.
- [x] Update learner-profile capture and restore to preserve the 0009 projection metadata.
- [x] Add the restore-project production rejection to both staging entry points while preserving source/restore distinctness checks.
- [x] Require an explicit candidate Git SHA, candidate-content SHA-256 or `clean-commit` sentinel, Vercel deployment ID, and immutable `*.vercel.app` deployment URL before full-load or health-only execution; missing/invalid inputs return `BLOCKED_ENV` with `failureCode=UNBOUND_EVIDENCE` before network or database use.
- [x] Emit `generatedAt` plus redacted deployment ID/immutable URL fingerprints in the final evidence. This is an operator-input binding contract, not independent proof that Vercel deployed the supplied SHA.
- [x] Compare deterministic SHA-256 values for the migration 0009 learning-event and learner-profile fields after restore, in addition to aggregate counts.
- [x] Run the operations gate to GREEN and run `node --check` for both scripts.

### Task 3: Re-validate the combined candidate locally

**Files:**

- Update evidence only under `coordination/reports/` and `coordination/session-logs/`.

- [x] Run focused P1/P2 tests.
- [x] Run deterministic full Vitest lanes, `npm run lint`, `npm run build`, the 17-route Next 16 contract test, Playwright critical journeys, and automated accessibility coverage.
- [x] Run `git diff --check`, secret-pattern review, production-feature-flag review, and `npm run release:clean-check` after committing the reviewed takeover slices.
- [x] Kept same-SHA staging acceptance unclaimed because the deployed build is not yet bound to the exact committed candidate content and isolated target identities under the current contract.

### Task 4: Establish the isolated staging control plane

**Files:**

- Do not write real secrets to repository files or command output.
- Record only redacted provider identity and parity evidence under `coordination/reports/`.

- [x] Verify Vercel project `uais-staging` and its organization/project IDs are not the production `uais` IDs.
- [x] Obtain owner-approved canonical staging hostname and prove it resolves to the isolated project.
- [x] Verify independent Neon source and restore project/branch/database identities, internal guard rows, and non-production identity rejection.
- [ ] Verify staging-only session/auth/outbox/LRS/Sentry/uptime variables by variable name and environment scope; never print values.
- [x] Only then perform an isolated staging deployment. This historical isolated deployment is not yet exact-candidate evidence under the new binding contract. Never deploy or modify `uais`, `uais.top`, production Neon, or production feature flags.

### Task 5: Execute ordered staging performance and reliability gates

**Files:**

- Overwrite canonical redacted reports under `coordination/reports/p2/` or use ignored `.scratch/` for transient output.

- [ ] Warm up, ramp, and sustain invite traffic until 200/200 completes with p95 below 2 seconds and zero duplicate/cross-scope writes.
- [ ] Only after the invite gate passes, run 40 groups x 5 users x 10 chat rounds plus the P1 200-student learning loop.
- [ ] **BLOCKED:** rerun `/healthz` for a complete 15-minute aggregate with the new exact-candidate/deployment binding fields. The existing health-only PASS predates that contract and therefore is not same-candidate evidence.
- [ ] Capture real-user or approved staging RUM sufficient to report INP p75; lab Lighthouse results are not INP field evidence.

### Task 6: Prove backup, restore, cleanup, and alert recovery

**Files:**

- Keep provider backup artifacts outside Git; evidence contains identifiers/checksums only in redacted form.

- [ ] **BLOCKED:** obtain a real Neon/provider backup artifact from the isolated source. The harness's tagged logical capture is useful test data but is not accepted as provider-backup evidence.
- [ ] **BLOCKED:** restore to the independently identified restore target and compare schema plus deterministic migration 0009 field checksums. The current canonical live-load JSON is `status=FAIL`, `failureCode=restore-verification-failed`, and `restoreCompleted=false`; it does not prove a completed restore.
- [x] Cleanup truth is preserved independently: the current canonical live-load JSON records `cleanup.status=PASS` and zero tagged residue on source and restore. Cleanup success does not convert the failed restore into PASS.
- [ ] Trigger approved Sentry and uptime failures, verify single deduplicated delivery, then verify recovery delivery and normal health.

### Task 7: Complete external accessibility, dependency, and soak gates

**Files:**

- Preserve machine-generated evidence separately from human attestations.

- [ ] Complete keyboard student/teacher journeys.
- [ ] Complete Safari + VoiceOver and Windows + Chrome + NVDA journeys in suitable environments.
- [ ] Complete 200% reflow, reduced motion, touch-target, and non-color information checks after the reflow/touch candidate is deployed.
- [x] Run current production dependency reachability analysis and document fix/mitigation decisions for every inherited low/moderate/high/critical path without forced or automatic major upgrades.
- [ ] Start the 24-hour staging soak only after every preceding gate is green; any regression resets the soak clock.
