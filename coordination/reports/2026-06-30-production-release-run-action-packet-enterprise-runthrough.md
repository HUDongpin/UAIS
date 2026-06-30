# UAIS Production Release-Run Action Packet

Status: `waiting-for-upstream-evidence`
Release gate: `blocked`
Queue rank: 8
Decision: `production-release-run`

Release-run binding must wait until the final release gate is ready.

## Owner Question

Do not bind the production release-run ID until the release gate is ready.

## Current Evidence Summary

- Requirement status: `blocked`
- Evidence status: `waiting-for-production-evidence`
- Blocked reason: `vercel-production-deployment-not-proven`
- Waiting release-run evidence: 15
- Present release-run evidence: 1
- Matched release-run evidence: 0
- Match status: `waiting`

## Release-Run Evidence Status By Source

- `vercelEnvSync`: `waiting`
- `vercelProductionDeployment`: `waiting`
- `deployedTeacherWorkflowUi`: `waiting`
- `teacherWorkflowBrowserUi`: `waiting`
- `teacherWorkflowLiveGeneration`: `waiting`
- `learningPptPlayback`: `waiting`
- `appAuthProviderReadiness`: `waiting`
- `teacherAuthProviderReadiness`: `waiting`
- `externalStorageContainerBuildReadiness`: `present`
- `externalStorageServiceReadiness`: `waiting`
- `routeSmoke`: `waiting`
- `teachingOperationsRouteSmoke`: `waiting`
- `teachingOperationDetailBrowserSmoke`: `waiting`
- `teachingCourseManagementRouteSmoke`: `waiting`
- `externalStorageSmoke`: `waiting`
- `pptAcceptance`: `waiting`
- `match`: `waiting`

## Required Evidence

- `one-public-release-run-id-used-across-production-evidence`
- `final-release-gate-ready`

## Command Templates

- Final release gate check: `node -- scripts/production-e2e-release-gate.mjs <release-gate-inputs> > <production-e2e-release-gate-output>`
- Release-run binding review: `review production-release-run-consistency in <production-e2e-release-gate-output> and bind one public release-run ID only after status is ready`

## Safe Next Actions

- `wait-for-final-release-gate-ready`
- `bind-one-public-release-run-id-after-all-production-evidence-is-ready`
- `verify-owner-checklist-has-no-waiting-or-blocked-decisions`
- `publish-release-run-summary-with-redacted-evidence-only`

## Stop Conditions

- Stop if the final release gate is not ready.
- Stop if any upstream owner decision or production live evidence remains blocked.
- Stop if release-run IDs across production evidence are missing or mismatched.
- Stop if a release-run ID would be bound while the release gate is blocked.
- Stop if production evidence comes from multiple release-run IDs.
- Stop if local private paths, raw URLs, response bodies, or secret-like values would be included in the release summary.

## Forbidden Until Approved

- `bind-release-run-id-while-release-gate-blocked`
- `mix-production-evidence-from-multiple-release-run-ids`
- `include-local-private-paths-or-secret-values-in-release-run-summary`
- `treat-owner-decisions-required-as-release-ready`
