# Current Enterprise Runthrough Live-Proof Runbook

Date: 2026-06-29 12:40 HKT
Purpose: close the current 24-requirement production release gate after the enterprise-live evidence audit was added to the final gate.

This runbook intentionally uses placeholders only. Do not paste secret values into reports, logs, screenshots, or command output.

## Inputs

- `<release-run-id>`: one shared non-secret release run id for every command.
- `<env-file>`: owner-approved production env file, not committed, containing the required UAIS/Vercel/provider/storage variables.
- `<deployment-url>`: production remote-HTTPS deployment base URL.
- `<vercel-project-readiness-evidence>`: current ready Vercel project evidence.
- `<vercel-env-sync-evidence>`: current approved production env apply evidence.
- `<vercel-env-inventory-evidence>`: current redacted production/preview env inventory evidence.
- `<app-auth-provider-readiness-evidence>`: current production app-auth readiness evidence.
- `<vercel-production-deployment-evidence>`: current production deployment evidence.
- `<deployment-domain-reachability-evidence>`: same-release custom production domain reachability evidence for the deployment URL.
- `<trusted-teacher-auth-route-chain-evidence>`: current trusted teacher auth route chain contract evidence.
- `<teacher-auth-provider-readiness-evidence>`: current production teacher-auth readiness evidence.
- `<external-storage-production-launch-contract-evidence>`: current production storage launch contract evidence.
- `<external-storage-container-build-readiness-evidence>`: current approved local container-build readiness evidence.
- `<external-storage-persistence-evidence>`: current external storage persistence evidence.
- `<reports-dir>`: redacted reports directory containing the same-date production-live evidence JSON files.
- `<report-date>`: report date used in the production-live evidence filenames.
- `<enterprise-live-evidence-audit-evidence>`: enterprise live evidence audit output.
- `<teacher-cookie>`, `<student-cookie>`, `<other-teacher-cookie>`: owner-approved smoke cookies; never log values.
- `<class-id>`: owner-approved class id used by ordinary teaching invite-code and roster smoke.

## Evidence Hygiene Preflight

Before running the enterprise live evidence audit, make sure non-evidence templates do not match the `*-production-live*.json` audit glob. The current blocker report is:

- `coordination/reports/2026-06-28-enterprise-live-evidence-hygiene-blocker.md`

In the current 2026-06-28 evidence set, this template must be moved or renamed by authorized owner/S22 cleanup before final acceptance:

- `coordination/reports/2026-06-28-ppt-manual-playback-acceptance-record-template-production-live.json`

Do not delete or rename files during the live run unless that cleanup is explicitly assigned. After authorized cleanup, regenerate the enterprise live evidence audit and aggregate release gate.

## Canonical Orchestrator Step Coverage

The canonical executable source is `scripts/production-e2e-orchestrator.mjs --dry-run`. The ordered proof chain below adds context, but this checklist must stay aligned with every orchestrator step:

- `1. s05-teacher-workflow-ui-smoke`: `node -- scripts/teacher-workflow-ui-smoke.mjs > <evidence>`
- `2. s22-vercel-project-readiness`: `node -- scripts/vercel-project-readiness.mjs --project-name <approved-project-name> --scope <approved-scope> > <evidence>`
- `3. s19-vercel-env-sync-apply-evidence`: `node -- scripts/vercel-env-sync.mjs --apply --approved --project <approved-project> --env-file <env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <evidence>`
- `4. s19-vercel-env-inventory-observation`: `node -- scripts/vercel-env-inventory.mjs --method rest --project-dir <vercel-project-dir> --release-run-id <release-run-id> > <evidence>`
- `5. s22-app-auth-provider-readiness`: `node -- scripts/app-auth-provider-readiness.mjs --live --approved --environment production --env-file <env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> > <evidence>`
- `6. s12-trusted-teacher-auth-route-chain-contract`: `node -- scripts/trusted-teacher-auth-route-chain-contract.mjs > <evidence>`
- `7. s22-external-storage-production-launch-contract`: `node -- scripts/external-storage-service-production-launcher.mjs --dry-run > <evidence>`
- `8. s22-external-storage-container-build-readiness`: `node -- scripts/external-storage-container-build-readiness.mjs --build --approved --image-tag <non-secret-image-tag> --release-run-id <release-run-id> > <evidence>`
- `9. s22-external-storage-persistence`: `node -- scripts/external-storage-persistence-smoke.mjs --live --approved --environment production --phase read --env-file <env-file> --teacher-id <redacted-smoke-teacher-id> --proof-id <redacted-persistence-proof-id> --release-run-id <release-run-id> > <evidence>`
- `10. s22-external-storage-service-readiness`: `node -- scripts/external-storage-service-readiness.mjs --live --approved --environment production --env-file <env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> --external-storage-production-launch-contract <external-storage-production-launch-contract-evidence> --external-storage-persistence <external-storage-persistence-evidence> > <evidence>`
- `11. s22-vercel-production-deployment`: `node -- scripts/vercel-production-deployment-evidence.mjs --live --approved --deploy --environment production --env-file <env-file> --scope <approved-scope> --vercel-project-readiness <vercel-project-readiness-evidence> --vercel-env-sync <vercel-env-sync-evidence> --release-run-id <release-run-id> > <evidence>`
- `12. s22-deployment-domain-reachability`: `node -- scripts/deployment-reachability-diagnostics.mjs --live --approved --environment production --base-url <deployment-url> --release-run-id <release-run-id> --domain-reachability-evidence > <evidence>`
- `13. s22-teacher-auth-issuer-route-smoke`: `node -- scripts/ai-route-smoke.mjs --live --approved --environment production --teacher-auth-issuer-only --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> > <evidence>`
- `14. s22-teacher-auth-provider-readiness`: `node -- scripts/teacher-auth-provider-readiness.mjs --live --approved --environment production --env-file <env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> --trusted-teacher-auth-route-chain <trusted-teacher-auth-route-chain-evidence> --route-smoke <teacher-auth-issuer-route-smoke-evidence> > <evidence>`
- `15. s22-deployed-teacher-workflow-page-smoke`: `node -- scripts/teacher-workflow-deployment-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <evidence>`
- `16. s22-deployed-teacher-workflow-browser-smoke`: `node -- scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --api-mode live-workflow-status > <evidence>`
- `17. s22-deployed-teacher-workflow-live-generation-smoke`: `node -- scripts/teacher-workflow-live-generation-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <evidence>`
- `18. s22-deployed-learning-ppt-playback-smoke`: `node -- scripts/learning-ppt-playback-deployment-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <evidence>`
- `19. s22-protected-deployment-route-smoke`: `node -- scripts/ai-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> > <evidence>`
- `20. s22-deployed-teaching-operations-route-smoke`: `node -- scripts/teaching-operations-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <evidence>`
- `21. s22-deployed-teaching-operation-detail-browser-smoke`: `node -- scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --api-mode live-teaching-operations > <evidence>`
- `22. s22-deployed-teaching-course-management-route-smoke`: `node -- scripts/teaching-course-management-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <evidence>`
- `23. s22-production-external-storage-smoke`: `node -- scripts/external-storage-smoke.mjs --live --approved --environment production --teacher-id <redacted-smoke-teacher-id> --env-file <env-file> --release-run-id <release-run-id> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <evidence>`
- `24. s24-manual-ppt-playback-acceptance`: `node -- scripts/ppt-manual-playback-acceptance.mjs --package-json <kangxia-package-json> --preflight-report <desktop-preflight-report> --manual-record <manual-record> --vercel-production-deployment <vercel-production-deployment-evidence> > <evidence>`
- `25. s22-enterprise-live-evidence-audit`: `node -- scripts/enterprise-live-evidence-audit.mjs --reports-dir <reports-dir> --date <report-date> --output <evidence>`
- `26. s22-production-e2e-release-gate`: `node -- scripts/production-e2e-release-gate.mjs --teacher-workflow-ui <teacher-workflow-ui-evidence> --deployed-teacher-workflow-ui <deployed-teacher-workflow-ui-evidence> --teacher-workflow-browser-ui <teacher-workflow-browser-ui-evidence> --teacher-workflow-live-generation <teacher-workflow-live-generation-evidence> --learning-ppt-playback <learning-ppt-playback-evidence> --vercel-project-readiness <vercel-project-readiness-evidence> --vercel-env-sync <vercel-env-sync-evidence> --vercel-env-inventory <vercel-env-inventory-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --trusted-teacher-auth-route-chain <trusted-teacher-auth-route-chain-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --external-storage-production-launch-contract <external-storage-production-launch-contract-evidence> --external-storage-container-build-readiness <external-storage-container-build-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --vercel-production-deployment <vercel-production-deployment-evidence> --route-smoke <route-smoke-evidence> --teaching-operations-route-smoke <teaching-operations-route-smoke-evidence> --teaching-operation-detail-browser-smoke <teaching-operation-detail-browser-smoke-evidence> --teaching-course-management-route-smoke <teaching-course-management-route-smoke-evidence> --external-storage-smoke <external-storage-smoke-evidence> --ppt-acceptance <ppt-acceptance-evidence> --enterprise-live-evidence-audit <enterprise-live-evidence-audit-evidence> --local-production-e2e-smoke <local-production-e2e-smoke-evidence> > <evidence>`

## Ordered Proof Chain

1. Apply/refresh production env with ordinary teaching backends included.

```bash
node scripts/vercel-env-sync.mjs --apply --approved --apply-method rest --scope full --env-file <env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-evidence>
```

Required ordinary teaching env names now include:

- `UAIS_TEACHING_OPERATIONS_BACKEND`
- `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND`
- `UAIS_TEACHING_COURSE_ASSETS_BACKEND`
- `UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER`
- `UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL`
- `UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN`
- `UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN`
- `UAIS_STUDENT_ROSTER_SYNC_PROVIDER`
- `UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL`
- `UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN`
- `UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER`
- `UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL`
- `UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN`
- `UAIS_GRADEBOOK_RELEASE_PROVIDER`
- `UAIS_GRADEBOOK_RELEASE_PROVIDER_URL`
- `UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN`
- `UAIS_COURSE_CONTENT_PUBLISH_PROVIDER`
- `UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL`
- `UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN`
- `UAIS_COURSE_EXPORT_PROVIDER`
- `UAIS_COURSE_EXPORT_PROVIDER_URL`
- `UAIS_COURSE_EXPORT_PROVIDER_TOKEN`
- `UAIS_GRADING_FEEDBACK_PROVIDER`
- `UAIS_GRADING_FEEDBACK_PROVIDER_URL`
- `UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN`

2. Observe the redacted Vercel env inventory for the same release run.

```bash
node scripts/vercel-env-inventory.mjs --method rest --project-dir <vercel-project-dir> --release-run-id <release-run-id> > <vercel-env-inventory-evidence>
```

The inventory evidence must prove required production and preview env names were observed without printing values.

3. Prove the app-auth provider readiness binding produced by the env apply.

```bash
node scripts/app-auth-provider-readiness.mjs --live --approved --environment production --env-file <env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> > <app-auth-provider-readiness-evidence>
```

The evidence must prove the trusted app-account provider selector, session cookie pair contract, Vercel env binding, redacted token strength, and release-run id.

4. Generate approved local external-storage container build readiness evidence.

```bash
node scripts/external-storage-container-build-readiness.mjs --build --approved --image-tag <non-secret-image-tag> --release-run-id <release-run-id> > <external-storage-container-build-readiness-evidence>
```

The evidence must prove the Dockerfile contract, `.dockerignore` secret/generated-output exclusions, Docker daemon availability, approved build invocation, redacted Docker output, redacted image tag handling, and release-run binding. If the local Docker daemon is unavailable, keep the blocked evidence and do not treat the final release gate as complete.

5. Refresh external storage service readiness with schema/database-adapter proof.

```bash
node scripts/external-storage-service-readiness.mjs --live --approved --environment production --env-file <env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> --external-storage-production-launch-contract <external-storage-production-launch-contract-evidence> --external-storage-persistence <external-storage-persistence-evidence> > <external-storage-service-readiness-evidence>
```

The health evidence must prove teaching operations, course-management, and course-assets schema sections plus production database adapter details.

6. Refresh external storage smoke with backup/restore drill proof.

```bash
node scripts/external-storage-smoke.mjs --live --approved --environment production --env-file <env-file> --release-run-id <release-run-id> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <external-storage-smoke-evidence>
```

7. Refresh custom production-domain reachability evidence for route-smoke deployment binding.

```bash
node scripts/deployment-reachability-diagnostics.mjs --live --approved --environment production --base-url <deployment-url> --release-run-id <release-run-id> --domain-reachability-evidence > <deployment-domain-reachability-evidence>
```

Use the same `<deployment-url>` string for this command and the route-smoke commands below so the redacted deployment fingerprint binds cleanly.

8. Refresh protected deployment route smoke after the env/storage refresh.

```bash
node scripts/ai-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> > <route-smoke-evidence>
```

9. Run ordinary teaching operations route smoke.

```bash
node scripts/teaching-operations-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --teacher-id <teacher-id> --course-id <course-id> --class-id <class-id> --cookie <teacher-cookie> --student-cookie <student-cookie> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teaching-operations-backend external --teaching-course-management-backend external --collaboration-invite-email-provider external --student-roster-sync-provider external --knowledge-index-sync-provider external --gradebook-release-provider external --course-content-publish-provider external --course-export-provider external --grading-feedback-provider external > <teaching-operations-route-smoke-evidence>
```

10. Run `/teaching/[operation]` browser-click smoke against the real ordinary teaching API.

```bash
node scripts/teaching-operation-detail-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --api-mode live-teaching-operations > <teaching-operation-detail-browser-smoke-evidence>
```

11. Run teaching course-management route smoke.

```bash
node scripts/teaching-course-management-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --teacher-id <teacher-id> --other-teacher-id <other-teacher-id> --student-id <student-id> --cookie <teacher-cookie> --other-teacher-cookie <other-teacher-cookie> --student-cookie <student-cookie> --release-run-id <release-run-id> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --vercel-production-deployment <vercel-production-deployment-evidence> --deployment-domain-reachability <deployment-domain-reachability-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --teacher-ai-ownership-backend external --course-management-backend external --course-assets-backend external --teaching-operations-backend external > <teaching-course-management-route-smoke-evidence>
```

12. Run real teacher workflow live-generation smoke.

```bash
node scripts/teacher-workflow-live-generation-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> > <teacher-workflow-live-generation-evidence>
```

13. Audit production-live evidence bodies before final acceptance.

Before this command, confirm every non-evidence template is outside the `*-production-live*.json` glob. In the current blocker report, `coordination/reports/2026-06-28-ppt-manual-playback-acceptance-record-template-production-live.json` must not remain in the audited reports directory for a final acceptance run.

```bash
node scripts/enterprise-live-evidence-audit.mjs --reports-dir <reports-dir> --date <report-date> --output <enterprise-live-evidence-audit-evidence>
```

This audit is required even when filenames contain `production-live`. The evidence must prove body-level live production acceptance, a shared release-run id across production-live files, required safety redaction flags, filename-only evidence rejection, and all 16 required production-live targets, including `ppt-manual-playback-acceptance` as a `record`/`accepted` evidence target.

14. Re-run the aggregate gate with all current evidence.

```bash
node scripts/production-e2e-release-gate.mjs --teacher-workflow-ui <teacher-workflow-ui-evidence> --deployed-teacher-workflow-ui <deployed-teacher-workflow-ui-evidence> --teacher-workflow-browser-ui <teacher-workflow-browser-ui-evidence> --teacher-workflow-live-generation <teacher-workflow-live-generation-evidence> --learning-ppt-playback <learning-ppt-playback-evidence> --vercel-project-readiness <vercel-project-readiness-evidence> --vercel-env-sync <vercel-env-sync-evidence> --vercel-env-inventory <vercel-env-inventory-evidence> --app-auth-provider-readiness <app-auth-provider-readiness-evidence> --trusted-teacher-auth-route-chain <trusted-teacher-auth-route-chain-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence> --external-storage-production-launch-contract <external-storage-production-launch-contract-evidence> --external-storage-container-build-readiness <external-storage-container-build-readiness-evidence> --external-storage-service-readiness <external-storage-service-readiness-evidence> --vercel-production-deployment <vercel-production-deployment-evidence> --route-smoke <route-smoke-evidence> --teaching-operations-route-smoke <teaching-operations-route-smoke-evidence> --teaching-operation-detail-browser-smoke <teaching-operation-detail-browser-smoke-evidence> --teaching-course-management-route-smoke <teaching-course-management-route-smoke-evidence> --external-storage-smoke <external-storage-smoke-evidence> --ppt-acceptance <ppt-acceptance-evidence> --enterprise-live-evidence-audit <enterprise-live-evidence-audit-evidence> --local-production-e2e-smoke <local-production-e2e-smoke-evidence> > <production-e2e-release-gate-evidence>
```

## Completion Criteria

The active enterprise goal can only be considered complete when the final aggregate gate reports:

- `status: "ready"`
- all 24 requirements `status: "satisfied"`
- `blockedReasons: []`
- enterprise live evidence audit reports `status: "ready"` and all 16 required production-live targets.
- matching same-run release id and deployment binding across production env, app-auth readiness, deployment, AI live-generation, ordinary teaching smoke, storage smoke, and PPT acceptance evidence.
