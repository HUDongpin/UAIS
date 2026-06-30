# UAIS Enterprise Teaching Gap Current-State Audit

Date: 2026-06-28
Session: S22 production reliability / release evidence
Scope: ordinary teaching-management chain, selected AI direct-call boundary evidence, and course-cover binding evidence.

## Executive Summary

This audit reconciles the earlier enterprise-gap list with the current repository state. The original largest weakness was the ordinary teaching-management path, especially `/api/teaching/operations` and the main `/teaching` inline workspace. That assessment is now partially stale: the current codebase has added signed-teacher auth checks, student denial, course ownership checks, external persistence requirements in production, domain-object receipts, audit readback, rollback/compensation, browser-smoke coverage for the main `/teaching` buttons, and release-gate requirements for ordinary teaching routes.

The aggregate enterprise goal should still not be marked complete from this audit alone. The remaining hard gap is same-run, owner-approved live production evidence that exercises the full ordinary teaching chain against the intended production auth, external storage, provider, and deployment environment. This document is an evidence map, not a final production acceptance record.

## Current Closure Map

| Gap from earlier assessment | Current status | Evidence |
| --- | --- | --- |
| `/api/teaching/operations` lacked enforced teacher auth/RBAC/course ownership | Largely addressed in route and smoke gate. The route rejects non-ready production auth provider, signed student sessions, missing teacher sessions, and denied course ownership. | `src/app/api/teaching/operations/route.ts:120`, `src/app/api/teaching/operations/route.ts:136`, `src/app/api/teaching/operations/route.ts:150`, `src/app/api/teaching/operations/route.ts:172`; route-smoke proof list includes unauthenticated, signed-student, course-scope, and no-write-side-effects checks at `scripts/teaching-operations-route-smoke.mjs:30`. |
| Ordinary teaching operations used local JSON persistence | Production path is now fail-closed unless external append storage is available; smoke gates also require durable external persistence, audit readback, rollback, backup/restore, schema policy, and idempotency evidence. | Production storage guard in `src/app/api/teaching/operations/route.ts:191`; release-gate required operation results include rollback, alerts, backup/restore, and external restore drill at `scripts/production-e2e-release-gate.mjs:300`. Proof files include `coordination/reports/2026-06-28-teaching-operations-course-scope-side-effects-release-gate-proof.json`, `coordination/reports/2026-06-28-teaching-operations-route-smoke-concurrent-idempotency-release-gate-proof.json`, and `coordination/reports/2026-06-28-teaching-operations-idempotency-conflict-release-gate-proof.json`. |
| Many operations only recorded an action, without domain objects | Improved. The route now persists operation ledger receipt and then domain objects such as course settings, roster sync, knowledge index, content publish, dashboard, quiz, grading, export, and invite-code records. Provider-sync receipts are represented for relevant actions. | Domain persistence starts after operation execution at `src/app/api/teaching/operations/route.ts:220`; release-gate required domain/provider result keys include course settings, roster provider sync, knowledge provider sync, content provider publish, export provider, grading provider, and invite join at `scripts/production-e2e-release-gate.mjs:300`. |
| UI failure could silently keep local feedback | Improved. Main teaching inline browser smoke now requires failure alert, audit-pending gating, alert notification readback, and rollback persistence. Course-cover UI also preserves generated cover assets on partial binding failure and surfaces a trace-aware alert. | Main inline required browser-smoke keys are listed at `scripts/teaching-operation-detail-browser-smoke.mjs:116` and enforced by release gate at `scripts/production-e2e-release-gate.mjs:357`. Course-cover partial failure UI test is at `tests/teaching-page.test.tsx:4251`. |
| Audit/observability lacked production audit table, trace id, source, and rollback | Improved but not fully production-observability complete. Route and smoke evidence require trace headers, auth session, request source provenance, audit readback, alert summary/notification readback, and rollback readback. Remaining gap: integration with an operator-facing observability/alerting platform and a live production incident/recovery drill. | Route-smoke proof list includes trace, auth session, request source, audit readback, alert notifications, rollback, and backup/restore at `scripts/teaching-operations-route-smoke.mjs:30`; audit event normalization includes trace/auth/session/request source in `src/lib/server/teaching-operations-store.ts:3434`. |
| Production gate focused on AI/PPT, not ordinary teaching | Improved. Production release gate now requires ordinary teaching operation route smoke, teaching operation detail browser smoke, course-management route smoke, and local/orchestrator alignment. | Main `/teaching` browser keys enforced at `scripts/production-e2e-release-gate.mjs:357`; course-management route-smoke keys enforced at `scripts/production-e2e-release-gate.mjs:433`; route set in accepted evidence includes `/api/teaching/course-cover`, `/api/teaching/courses`, `/api/teaching/operations`, invite join, and membership approval at `tests/production-release-gate.test.ts:4889`. |
| AI contract APIs could be called directly in contract mode | Improved. The AI route smoke now verifies unsigned/signed-session direct-call denial for the teacher AI session route and required AI contract routes, including legacy scoped-header policy. | Direct-call boundary invoked at `scripts/ai-route-smoke.mjs:740`; production gate requires all direct-call probes and legacy scoped-header probes at `scripts/production-e2e-release-gate.mjs:7340`; required direct-call probe list starts at `scripts/production-e2e-release-gate.mjs:163`. |
| Generated course cover was not bound to course assets | Largely addressed. The cover route stores the generated asset, attempts course binding, returns partial-failure recovery details if binding fails, and the course-create UI forwards `coverAssetId` to `/api/teaching/courses`. Course-create route validates cover-asset ownership before accepting the course. | Cover route calls binding at `src/app/api/teaching/course-cover/route.ts:199`; UI sends `coverAssetId` during course creation at `src/components/pages/teaching-page.tsx:3511`; course-create body includes `coverAssetId` at `src/components/pages/teaching-page.tsx:1188`; ownership validation is at `src/app/api/teaching/courses/route.ts:295`. |

## Button Completion Reassessment

| Surface | Earlier estimate | Current evidence-based estimate | Notes |
| --- | ---: | ---: | --- |
| `/teaching/[operation]` 11 operation pages x 2 buttons | backend contract 60%, enterprise 35% | backend/gate 85%, enterprise 70% | Browser smoke now proves primary/secondary persistence, audit readback, domain projection, trace/actor/session display, duplicate-submit blocking, failure alert, and invite artifact gating. Still needs same-run live production acceptance. |
| Main `/teaching` inline buttons | 20% | gate-backed implementation 70%, enterprise 55% | `runInlineWorkspaceAction` now POSTs `/api/teaching/operations` with course id, source action, optional course-settings patch, and idempotency key at `src/components/pages/teaching-page.tsx:1445`. Browser smoke and release gate cover the inline workspace keys. |
| Main invite-code workspace | 50% | gate-backed implementation 75%, enterprise 60% | Route smoke publishes invite codes and exercises student join at `scripts/teaching-operations-route-smoke.mjs:1543`; release gate requires `invitePublishClassJoinEntryReturned` and `studentInviteJoinReturned` at `scripts/production-e2e-release-gate.mjs:318`. Course-management smoke separately requires invite join, duplicate join idempotency, and membership approval at `scripts/production-e2e-release-gate.mjs:467`. |
| New course / new class create flows | 15% | gate-backed implementation 70%, enterprise 55% | Main `/teaching` now creates via `/api/teaching/courses` and reads back persisted state at `src/components/pages/teaching-page.tsx:1188`. Course-management release gate requires course/class create, readback, duplicate create denial, foreign course-id denial, and student visibility after membership. |
| Generate cover | 45% | gate-backed implementation 80%, enterprise 65% | Cover asset persistence, revision readback, audit readback, course binding, existing-course binding, and binding audit-source are required by route smoke and release gate at `scripts/teaching-course-management-route-smoke.mjs:1025` and `tests/production-release-gate.test.ts:4938`. |
| AI/PPT teacher workflow | 80-85% | 85% | Prior status remains broadly accurate, with direct-call boundary stronger than before. The residual gap is still owner-approved live production mutation/generation evidence, not local contract shape. |

## Remaining Enterprise Risks

- Same-run production proof is still missing for the full ordinary teaching chain. Existing evidence is strong but split across code, tests, dry-run/live harnesses, and prior proof JSON files.
- External storage is a production-ready adapter contract in the repository, but this audit does not prove the owner-selected production database backup/restore/SLO posture outside the app-level smoke gates.
- Provider integrations for email, roster sync, content publish, export, grading feedback, and knowledge sync are represented by provider receipts and gate keys; this audit does not prove each third-party provider performed real-world side effects in production.
- Observability is trace/audit/alert-summary capable, but this audit does not prove integration with a production alerting system, dashboard, or runbook escalation path.
- Live production route mutation remains approval-gated by design. That is the right safety posture, but it means final enterprise acceptance needs an explicit approved run.

## Current Release-Gate Blocker Shape

The latest inspected aggregate release-gate summaries from 2026-06-27 remain blocked. Their redacted blocker reasons are evidence/runtime binding gaps rather than missing local route implementation:

- `teaching-operations-route-smoke-evidence-missing`
- `teaching-operation-detail-browser-smoke-not-live-passed`
- `teaching-course-management-route-smoke-evidence-missing`
- `external-storage-smoke-not-live-passed`
- `external-storage-service-readiness-not-live-ready`
- `external-storage-service-teaching-operations-schema-not-proven`
- `vercel-env-not-applied`
- `vercel-production-deployment-not-proven`
- `deployment-route-smoke-response-shape-not-proven`
- `app-auth-provider-readiness-not-live-ready` in the stricter latest-evidence files
- AI/PPT side blocker: `teacher-workflow-browser-smoke-api-interception-not-proven`

The inspected blocker files preserve safety fields with `secretsRedacted`, `evidenceValuesRedacted`, `responseBodiesOmitted`, and `localPrivatePathsOmitted` all true.

## Recommended Next Small Slices

1. Run an owner-approved live production ordinary-teaching route smoke with a fresh release-run id, then feed the evidence into `scripts/production-e2e-release-gate.mjs`.
2. Run the teaching operation detail browser smoke in live mode for the main `/teaching` inline workspace and operation detail pages, again bound to the same release-run id.
3. Produce a single current production acceptance bundle that links: auth provider readiness, app auth readiness, external storage readiness, ordinary teaching route smoke, browser smoke, AI direct-call boundary, and Vercel deployment evidence.
4. Only after the same-run bundle passes, reassess whether the enterprise goal can move from "release-gate hardened" to "production accepted".

## Checks Run For This Audit

- `git status --short`
- Targeted `rg`/`sed`/`nl` inspections for `/api/teaching/operations`, `/api/teaching/course-cover`, `/api/teaching/courses`, teaching-page UI, route-smoke scripts, production release gate, and production gate tests.
- Read redacted top-level blocker reasons from the latest inspected 2026-06-27 aggregate release-gate JSON summaries.
- Not run: full Vitest, lint, or build in this audit slice because this change is documentation/evidence-only. Prior adjacent S22 proof files and session log entries record the latest full-suite/lint/build runs after code-gate changes.
