# Current Enterprise Runthrough Blocker Matrix

Date: 2026-06-26 10:53 HKT
Responsible session: S22 production reliability / S10 evidence coordination

## Current Gate Result

The current `scripts/production-e2e-release-gate.mjs` gate is **blocked** under the latest 22-requirement production checklist.

Machine-readable evidence:

- `coordination/reports/2026-06-26-production-e2e-release-gate-current-ordinary-teaching-blockers.json`

This supersedes the older 2026-06-22 `18/18 ready` summary for completion decisions because the current gate now includes hardened ordinary-teaching and live-generation requirements that were not present in that older ready summary.

## Satisfied Evidence Still Preserved

- Teacher workflow UI feature evidence: satisfied.
- Deployed `/teaching` workflow page on production remote HTTPS: satisfied.
- Browser workflow smoke with live workflow status APIs: satisfied, but remote provider mutations remained fixture-blocked.
- Deployed learning PPT playback and WAV header contract: satisfied.
- Vercel project readiness: satisfied.
- Trusted teacher auth provider readiness: satisfied.
- External storage production launcher and container build readiness: satisfied.
- Vercel production deployment evidence: satisfied.
- PPT manual playback acceptance: satisfied after owner-confirmed PowerPoint and WPS auditory playback.

## Current Blockers

1. `teacher-workflow-live-generation-smoke-not-live-passed`
   - The current gate requires a separate production live-generation smoke proving real provider mutation, not only browser smoke with `remoteMutations: "fixture-blocked"`.

2. `vercel-env-not-applied`
   - The current gate now expects ordinary teaching backend env placement in addition to the previous AI/storage env names.
   - Missing required env names in the evaluated evidence: `UAIS_TEACHING_OPERATIONS_BACKEND`, `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND`, `UAIS_TEACHING_COURSE_ASSETS_BACKEND`.
   - 2026-06-26 11:21 HKT update: local env template, Vercel env sync planning/apply logic, Vercel env inventory, and provider smoke-plan manifest now include the production launcher data directory variable `UAIS_EXTERNAL_STORAGE_DATA_DIR` while preserving the existing service-local `UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR`. This removes the local naming mismatch only; live Vercel env apply is still required.
   - 2026-06-26 11:37 HKT update: local env template, Vercel env sync, Vercel env inventory, and provider smoke-plan manifest now also include the four managed-database adapter proof variables: `UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS`, `UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS`, `UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY`, and `UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL`. Live Vercel env apply remains required.
   - 2026-06-26 11:49 HKT update: Vercel env sync now blocks if those four adapter proof variables are present but do not classify as `managed-database`, `up-to-date`, `point-in-time-restore`, and `transactional`. The production release gate also requires redacted ready adapter proof before accepting Vercel env placement.

3. `external-storage-service-teaching-operations-schema-not-proven`
   - Current external-storage readiness evidence lacks the teaching operations/course-management/course-assets storage schema and production database adapter proof now required by the gate.
   - 2026-06-26 11:04 HKT update: local `/healthz` contract hardening now exposes redacted `productionDatabaseAdapter` slots for all three ordinary teaching schemas, but defaults them to `blocked/not-configured`. This is intentionally fail-closed and does not replace the still-missing live production managed-database evidence.
   - 2026-06-26 11:37 HKT update: production-mode external storage `/healthz` now fails closed with HTTP 503 unless the managed-database adapter proof env contract is complete. When all four adapter proof variables are present with `managed-database`, `up-to-date`, `point-in-time-restore`, and `transactional`, `/healthz` can advertise redacted ready adapter proof across teaching operations, course-management, and course-assets schemas. This is still a contract/placement step, not live managed database evidence.
   - 2026-06-26 11:49 HKT update: the env placement gate now verifies the same adapter proof semantics before any Vercel env apply evidence can satisfy production readiness.

4. `deployment-route-smoke-response-shape-not-proven`
   - The reused protected route smoke evidence has `teacherAiSession` response shape failed under the current evaluator.
   - 2026-06-26 11:10 HKT update: the selected production `deployment-route-smoke` artifact is an older route-contract shape. Its `s22-teacher-ai-session-route.responseShapeChecks` list proves `accessSession`, `accessPlan`, `authProviderContract`, and `s12TeacherAiSessionBoundary`, but does not include the current `signedContractDirectCallDenied` field. Current `scripts/ai-route-smoke.mjs` and release-gate tests do require that field, so this blocker should be cleared by a fresh same-run `ai-route-smoke` artifact rather than by weakening the gate.

5. `teaching-operations-route-smoke-evidence-missing`
   - No current production live ordinary teaching `/api/teaching/operations` route smoke artifact was found in `coordination/reports/`.

6. `teaching-operation-detail-browser-smoke-not-live-passed`
   - No current production live `/teaching/[operation]` browser-click smoke artifact with `api-mode live-teaching-operations` was found.

7. `teaching-course-management-route-smoke-evidence-missing`
   - No current production live teaching course-management route smoke artifact was found.

8. `external-storage-smoke-not-live-passed`
   - Reused external storage smoke evidence is stale under the current gate because it lacks course-management and course-assets backup/restore drill proof.

## 2026-06-26 11:56 HKT Local Contract Recheck

The older local-code concerns for AI direct-call enforcement, course-cover binding, and external-storage smoke shape were rechecked against the current checkout.

- AI direct-call closure is present in local route tests and release-gate fixtures. Passed: `npm run test -- tests/ai-api-routes.test.ts -t "direct calls"` (21 selected tests) and `npm run test -- tests/production-release-gate.test.ts -t "direct-call|course cover|ordinary course backup"` (4 selected tests).
- Course-cover binding/external asset closure is present. Passed: `npm run test -- tests/teaching-course-cover-api.test.ts -t "binds generated covers|uses external cover asset storage|rejects deployed-production cover generation"` (3 selected tests).
- External-storage smoke already includes managed database adapter proof and ordinary course backup/restore drill shape checks. Passed: `npm run test -- tests/external-storage-smoke.test.ts -t "managed database adapter proof|backup restore"` (2 selected tests).
- Syntax checks passed for `scripts/external-storage-smoke.mjs`, `scripts/production-e2e-release-gate.mjs`, and `scripts/teaching-course-management-route-smoke.mjs`.

Interpretation: the active blocker list above is still about missing fresh owner-approved production evidence under one release run, not a newly discovered local API/gate implementation gap in those three areas.

## Meaning For The Active Goal

The original ordinary teaching gaps are now mostly closed in code and tests, but the full enterprise runthrough is **not yet complete** under the current production gate. Completion now requires fresh same-run production evidence for:

- real AI/PPT live provider generation mutation;
- Vercel env apply with ordinary teaching backend env names, both external-storage data directory aliases, and redacted ready managed-database adapter proof values;
- external storage readiness proving teaching operations/course-management/course-assets schemas and production database adapter;
- protected route smoke response shape;
- ordinary teaching operations route smoke;
- ordinary teaching operation detail browser smoke;
- teaching course-management route smoke;
- external storage smoke with backup/restore drills.

No secret values were inspected or recorded.
