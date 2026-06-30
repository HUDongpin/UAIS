# UAIS Enterprise Runthrough Gap Reassessment

Date: 2026-06-26 10:48 HKT
Responsible session: S10 coordination report, with S12/S05/S22 evidence review
Scope: reassess the previously listed enterprise gaps against the current checkout without inspecting secrets or mutating production systems.

## Updated Finding

The previously listed gaps are materially older than the current tree. The ordinary teaching management path now has substantially stronger backend, UI, audit, and release-gate coverage than the earlier 35%/20% estimates implied.

## Evidence Snapshot

1. Ordinary teaching operations auth/RBAC is no longer default-actor open write.
   - `/api/teaching/operations` checks production teacher-auth provider readiness, requires a signed teacher session, rejects signed students, requires course id, checks teacher-course ownership, and blocks production default ownership access unless external storage is configured.
   - Evidence: `src/app/api/teaching/operations/route.ts`, `tests/teaching-operation-backend.test.ts`.

2. Production persistence is fail-closed for ordinary teaching operations.
   - Production operation append requires external storage. Course-management domain writes require external storage in production. The route smoke dry-run requires external operation storage, external course-management storage, external storage base/token, and external collaboration invite email provider/callback configuration.
   - Evidence: `src/app/api/teaching/operations/route.ts`, `scripts/teaching-operations-route-smoke.mjs`, `tests/teaching-operations-route-smoke.test.ts`.

3. Business semantics have moved beyond "action happened" receipts.
   - The operation route maps the 22 ordinary teaching buttons into expected course-management domain objects including course settings, student preview, roster sync, group suggestions, knowledge index, resource review, course content, unit draft, dashboard state/snapshot, quiz board/item review, agent plan, permission preflight, admin settings, email notification, export manifest, redaction validation, grading queue, AI feedback draft, invite-code draft, and enrollment access.
   - The response includes `domainPersistenceSummary` and refuses to claim success when required domain objects are missing.
   - Evidence: `src/app/api/teaching/operations/route.ts`, `tests/teaching-operation-backend.test.ts`, `tests/teaching-page.test.tsx`.

4. Main `/teaching` inline buttons are no longer local-only for the reviewed operations.
   - `runInlineWorkspaceAction` POSTs to `/api/teaching/operations`, sends idempotency keys, waits for persisted receipts, checks domain-persistence summary, reads audit evidence back, surfaces alerts, supports notification readback, and allows rollback only after audit readback finds the saved record.
   - Evidence: `src/components/pages/teaching-page.tsx`, `tests/teaching-page.test.tsx`.

5. New course/class flows are no longer refresh-lost local state in the current tree.
   - Current tests require POST persistence plus course-list readback before showing a new course/class as saved, and reject readback mismatches.
   - Evidence: `tests/teaching-page.test.tsx`, `src/components/pages/teaching-page.tsx`, `src/app/api/teaching/courses/route.ts`, `src/app/api/teaching/courses/[courseId]/classes/route.ts`.

6. Course-cover generation is bound into course assets in the current backend.
   - The route stores generated cover assets, binds them to courses, and has tests for external asset persistence and existing-course cover binding readback.
   - Evidence: `src/app/api/teaching/course-cover/route.ts`, `tests/teaching-course-cover-api.test.ts`, `tests/teaching-course-management-api.test.ts`.

7. AI API direct-call contract mode is now fail-closed.
   - Chat, voice sample, voice clone preflight/status/revoke, PPT narration submit, PPT audio download, and PPT export routes require signed AI access sessions even for contract calls. Tests explicitly block local and production unsigned contract direct calls before detailed body validation leaks.
   - Evidence: `src/lib/server/ai-access-control.ts`, `src/app/api/ai/*`, `tests/ai-api-routes.test.ts`.

8. Production smoke coverage exists for ordinary teaching paths.
   - The orchestrator and release gate include ordinary teaching operations route smoke, operation detail browser smoke with live teaching operations API mode, and teaching course-management route smoke.
   - Evidence: `scripts/production-e2e-orchestrator.mjs`, `scripts/production-e2e-release-gate.mjs`, `tests/production-release-gate.test.ts`, `tests/teaching-operations-route-smoke.test.ts`.

## Remaining Enterprise Blockers

1. Fresh live production proof is still required before claiming the current checkout is fully enterprise-runthrough ready.
   - The code and tests define the gate, but a fresh same-run evidence chain against the intended production deployment must still prove remote HTTPS deployment binding, teacher auth provider readiness, external durable storage readiness, ordinary teaching route smoke, teaching course-management route smoke, AI workflow smoke, learning playback smoke, and manual PPT acceptance.

2. Production evidence depends on owner-approved deployment/env access.
   - The remaining work requires approved Vercel/project/env state and production storage/auth provider configuration. No credential values were read or recorded in this reassessment.

3. The checkout remains very large and dirty/untracked.
   - Release intake should map ownership and produce a commit/PR slice plan before any final deploy claim.

## Suggested Next Verification

Run the narrow current evidence checks first:

- `npm run test -- tests/ai-api-routes.test.ts tests/teaching-page.test.tsx tests/teaching-operation-backend.test.ts tests/teaching-operations-route-smoke.test.ts tests/production-release-gate.test.ts`
- `npm run lint`
- `npm run build`

Then, only with owner-approved production configuration, rerun the production E2E orchestrator and aggregate release gate with same-run evidence files.
