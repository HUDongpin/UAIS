# Enterprise Gap Evidence Map

Date: 2026-06-27 22:57 HKT
Responsible session: S22 production reliability

## Purpose

This note maps the original enterprise-runthrough concerns to the current local code/test/evidence state after the 2026-06-27 hardening work. It is a coordination artifact only: it does not clear the production gate and it does not replace same-run live production evidence.

## Current Aggregate Gate

- Latest aggregate evidence: `coordination/reports/2026-06-27-production-e2e-release-gate-current-latest-evidence-refresh.json`
- Status: `blocked`
- Current model: 23 production requirements
- Local-production diagnostic: `coordination/reports/2026-06-27-local-production-e2e-smoke-current-course-assets-adapter-fix-refresh.json`
- Local-production result: passed, including course-cover and existing-course-cover checks

## Original Gap Map

| Original concern | Current local/code state | Remaining production proof needed |
| --- | --- | --- |
| `/api/teaching/operations` default teacher and weak RBAC | Route now requires signed teacher auth before body parsing, denies signed student sessions, validates safe actor/session ids, requires course id, checks teacher-course ownership, and fails production if default ownership access would use non-external storage. Evidence includes `tests/teaching-operation-backend.test.ts`, `tests/teaching-operation-page.test.tsx`, and `tests/teaching-operations-route-smoke.test.ts`. | Same-run live `teaching-operations-route-smoke` and operation detail browser smoke against production with teacher auth, app auth, Vercel deployment, and external storage readiness bindings. |
| Local JSON persistence instead of production database | Ordinary teaching operations, course management, and course assets now fail closed in production unless external storage/readback carries managed database adapter evidence, migration status, backup policy, concurrency control, and revision/readback contracts where required. | Live external-storage service readiness must prove all three schemas and managed database adapters; live route smokes must bind that readiness evidence. |
| Business semantics only record actions | Route smoke contract now requires domain object projections for course settings, roster sync, knowledge index, content publish/provider publish, invite/email, exports, quizzes, grading, gradebook release/rollback, backup/restore, alerts, and idempotency. | Live production route smoke must execute and read back those domain projections under owner-approved provider configuration. |
| Frontend failure may silently retain local state | Teaching page and operation page tests cover fail-closed API feedback, receipt/audit identity matching, inline trace feedback, invite artifact audit gating, and signed-session failures. | Live browser smokes must show production UI interactions use live teaching APIs, not fixture-only interception. |
| Audit and observability gaps | Route receipts include trace id, signed auth session provenance, request source, audit readback, rollback trace closure, alert summary, alert notification queue/readback, and external rollback append evidence. | Live production audit/readback and alert notification evidence must be generated in the same release run. |
| Production deployment coverage focused only on AI/PPT | Release gate now includes ordinary teaching operations route smoke, teaching operation detail browser smoke, teaching course-management route smoke, external-storage service consistency, app auth readiness, and production release-run consistency. | Current live artifacts are still missing/stale for ordinary teaching route/browser smokes and external storage readiness. |
| AI API direct-call risk in contract mode | AI workflow routes require signed AI access sessions before body-sensitive execution; direct-call boundary probes include PPT narration, chat, voice sample, voice preflight/status/revoke, and PPT audio/export downloads. | Production protected route smoke must provide current response-shape/direct-call proof from the deployed release. |

## Blocked Items Still Needing Owner-Approved Live Evidence

- Vercel env placement with all current app-auth, teacher-auth, ordinary teaching backend/provider, external-storage, DeepSeek, and DashScope variables.
- Vercel production deployment proof for the same release run.
- App auth provider readiness in production.
- Teacher auth provider readiness in production.
- External-storage service readiness with teaching operations, course-management, and course-assets schema/database-adapter proof.
- External-storage container build readiness; current local build attempt is blocked by Docker daemon unavailability.
- Production deployment route smoke with trusted route response-shape/direct-call proof.
- Production ordinary teaching operations route smoke.
- Production teaching operation detail browser smoke.
- Production teaching course-management route smoke.
- Production external-storage smoke including course-management and course-assets backup/restore drills.
- Production teacher workflow browser smoke with live workflow-status API behavior, followed by approved live generation smoke.
- Final aggregate release gate with all accepted artifacts sharing one `releaseRunId`.

## Handoff

The biggest active gap is no longer a single missing `/api/teaching/operations` guard in source code. The active gap is same-run production evidence: the current code/test contracts are substantially hardened, but the aggregate gate must remain blocked until the owner-approved production environment and live smoke artifacts are regenerated under one release run.
