# UAIS Enterprise Runthrough Current-State Audit

Date: 2026-06-28
Session: S22/S10 audit slice
Scope: Current worktree evidence for the active enterprise runthrough goal.

## Bottom Line

The original ordinary-teaching gaps are no longer accurate as a description of the
current local codebase. The current tree has materially hardened the ordinary
teaching chain: signed teacher auth, course ownership, external-storage
fail-closed behavior, domain object persistence, provider-backed side effects,
partial-failure responses, audit/readback/rollback, course cover asset binding,
and production-gate coverage are all represented in code and tests.

The enterprise goal is still not complete. The current aggregate production gate
remains blocked because the evidence is not a same-run owner-approved live
production run with Vercel env apply/inventory, deployed route/browser smokes,
external-storage readiness/smoke, live provider effects, and PPT manual playback
acceptance.

## Fresh Verification

- `./node_modules/.bin/vitest run tests/teaching-operation-backend.test.ts`
  - Passed: 191 tests.
- `./node_modules/.bin/vitest run tests/teaching-course-cover-api.test.ts`
  - Passed: 21 tests.
- `./node_modules/.bin/vitest run tests/ai-api-routes.test.ts -t "contract direct calls|direct calls without a signed AI access session|direct calls before"`
  - Passed: 27 selected tests.
- `./node_modules/.bin/vitest run tests/production-release-gate.test.ts -t "teaching operations route smoke|direct-call boundary|signed AI contract direct-call|legacy scoped AI direct-call|signed teacher-cookie helper route direct-call"`
  - Passed: 62 selected tests.
- `./node_modules/.bin/vitest run tests/teaching-page.test.tsx -t "inline-teaching-workspace|course cover|new course|new class|invite-code|server"`
  - Passed: 16 selected tests.

## Requirement Audit

| Original requirement | Current evidence | Status |
| --- | --- | --- |
| `/api/teaching/operations` must not default to `teacher-kang`; it needs teacher auth, role checks, and course ownership. | Backend tests cover signed teacher auth before writes, signed-student denial, unsafe student IDs, course ownership before operation writes, audit/export/rollback ownership, and production auth/storage preflights. Focused backend suite passed 191/191. | Local-proven; live production proof still required. |
| Ordinary teaching operations must not rely on local JSON in production. | Backend tests cover production fail-closed behavior before local JSON writes, external backend use when configured, rejection when ownership would use local JSON, and external storage readiness failure without local writes. Release gate requires external operations/course-management/course-assets backend proof and managed database adapter binding. | Local-proven; real production storage readiness still blocked. |
| Business semantics should update domain objects instead of only recording actions. | Backend tests and route-smoke required results cover course settings, student preview, roster sync, group suggestions, knowledge index, resource review, course content publish, dashboard refresh/snapshot, quiz, agent/admin settings, invite notification/email, export manifest/provider/redaction, grading queue/gradebook/feedback, idempotency, rollback, backup, and provider side effects. | Local-proven for contracts; live provider and deployed smoke proof still required. |
| Error closure should tell the user when persistence/provider work partially failed. | Backend tests cover retryable partial-failure contexts for roster provider sync, knowledge provider sync, content provider publish, export provider, and grading feedback provider after domain persistence. | Local-proven; live failure-path evidence not required for completion unless owner adds it, but live success/proof remains required. |
| Audit/observability should include trace id, actor source, readback, alerts, rollback. | Backend tests and production gate focused tests cover trace headers, signed actor, audit auth session, audit request-source provenance, audit readback, alert notification/readback, rollback persistence/readback/trace closure, gradebook audit source, export audit source, append ledger sequence and readback. | Local-proven; deployed smoke remains missing. |
| Ordinary teaching deployment coverage should be first-class, not weaker than AI/PPT. | Production release gate requires ordinary teaching operations route smoke, operation detail browser smoke, teaching course-management route smoke, external storage smoke, deployment binding, auth-provider binding, app-auth binding, route-origin proof, and provider-backed results including course content, export, grading feedback, gradebook, knowledge index, and roster sync. Focused gate suite passed 62 selected tests. | Gate-proven; current aggregate production evidence remains blocked. |
| Main `/teaching` inline buttons should not be silent local-only state. | Teaching page focused tests passed 16 selected tests. Current source posts inline workspace and invite actions to `/api/teaching/operations`, reads audit evidence, handles rollback, and surfaces server-side failure states. | Local-proven for covered flows; deployed browser proof remains blocked. |
| New course/class flows should persist beyond React state. | Current teaching page and course-management API tests cover course/class creation, cover asset ownership, server readback, mismatch/failure messages, and external production storage paths. | Local-proven; deployed course-management smoke remains blocked. |
| Course cover generation should bind to course asset storage. | `tests/teaching-course-cover-api.test.ts` covers production fail-closed asset persistence, existing-course binding preflight, ownership, binding generated cover to persisted course record, persisted asset context on binding failure, and external cover asset storage. 21/21 passed. | Local-proven; live course-management route smoke remains blocked. |
| AI/PPT contract-mode APIs should not allow direct unsigned calls. | `tests/ai-api-routes.test.ts` has contract/direct-call denial for voice sample, voice clone status/revoke, chat, PPT narration, audio download, and ZIP export paths. Production gate also requires signed AI direct-call denial and legacy scoped direct-call denial evidence. Focused AI tests passed 27 selected tests. | Local-proven; protected route/live workflow production evidence remains blocked. |

## Current Aggregate Gate

Current artifact inspected:
`coordination/reports/2026-06-28-production-e2e-release-gate.json`

Status: `blocked`.

Satisfied requirements currently include:

- `website-teacher-workflow-ui`
- `vercel-project-readiness`
- `trusted-teacher-auth-route-chain`

Representative blocked requirements:

- `deployed-teacher-workflow-page`: `deployed-teacher-workflow-page-not-live-passed`
- `teacher-workflow-live-generation-smoke`: `teacher-workflow-browser-smoke-not-live-passed`
- `deployed-learning-ppt-playback`: `deployed-learning-ppt-playback-not-live-passed`
- `vercel-env-placement`: `vercel-env-not-applied`
- `app-auth-provider-readiness`: `app-auth-provider-readiness-not-live-ready`
- `teacher-auth-provider-readiness`: `teacher-auth-provider-readiness-not-live-ready`
- `external-storage-production-launch-contract`: `external-storage-production-launch-contract-not-ready`
- `external-storage-service-readiness`: `external-storage-service-readiness-not-live-ready`
- `vercel-production-deployment`: `vercel-production-deployment-not-proven`
- `deployment-route-smoke`: `deployment-route-smoke-not-live-passed`
- `teaching-operations-route-smoke`: `teaching-operations-route-smoke-not-live-passed`
- `teaching-operation-detail-browser-smoke`: `teaching-operation-detail-browser-smoke-not-live-passed`
- `teaching-course-management-route-smoke`: `teaching-course-management-route-smoke-not-live-passed`
- `external-durable-storage-smoke`: `external-storage-smoke-not-live-passed`
- `ppt-manual-playback-acceptance`: `manual-ppt-playback-not-accepted`
- `production-release-run-consistency`: `vercel-production-deployment-not-proven`

## Next Required Production Work

1. S19/owner-approved production env inventory and env apply evidence, with
   ordinary teaching backends and auth providers included, redacted.
2. S22 live Vercel production deployment proof bound to one release run.
3. S22 live protected route smoke, ordinary teaching operations route smoke,
   operation-detail browser smoke, teaching course-management route smoke, and
   external-storage smoke, all using the same release run.
4. S22/S12 live provider-backed ordinary teaching proof for the route-smoke
   required results, without fixture substitution.
5. S24/human PPT manual playback acceptance for the packaged narration output.
6. Final aggregate gate rerun after the live evidence exists.

## Audit Conclusion

The current local code and regression suite show substantial enterprise hardening
for the ordinary teaching path. The active goal should remain open because the
final requested end state is production-enterprise readiness, and the authoritative
aggregate gate is still blocked by missing live production evidence rather than
by a single known local implementation gap.
