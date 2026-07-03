# UAIS Enterprise Runthrough Review Slice Index

Status: `review-slice-index-created`
Release gate: `blocked`
Owner queue: `owner-decisions-cleared-awaiting-production-evidence`
Dirty paths covered: 147 / 147
Uncovered paths: 0
Duplicate path assignments: 0
Release ready: `false`

This index lists explicit pathspecs only. Do not stage with a wildcard command.

## Review Groups

| Group | Owner | Paths |
| --- | --- | ---: |
| `s10-governance-tooling` | S10/S25 | 3 |
| `dirty-worktree-rescue-evidence` | S25/S10 | 3 |
| `owner-decision-package` | S22/S10/S25 | 112 |
| `enterprise-live-evidence-triage` | S22/S10/S25 | 4 |
| `release-blocker-dependency-graph` | S22/S10/S25 | 4 |
| `release-blocker-diagnosis-coverage` | S22/S25 | 2 |
| `enterprise-runthrough-bundle-manifest` | S22/S10/S25 | 4 |
| `enterprise-runthrough-review-slice-index` | S25/S22 | 4 |
| `enterprise-runthrough-package-gate` | S25/S22 | 4 |
| `release-intake-current-state-probes` | S25/S10 | 2 |
| `s10-president-report` | S10/S25 | 4 |
| `s22-session-log` | S22 | 1 |

## Aggregate Explicit Pathspecs

- .gitignore
- AGENTS.md
- package.json
- coordination/release-intake/2026-07-03-dirty-worktree-rescue-archive-manifest.json
- coordination/release-intake/2026-07-03-dirty-worktree-rescue-pathspecs.txt
- coordination/reports/2026-07-03-dirty-worktree-rescue-closeout.md
- coordination/reports/2026-07-01-owner-decision-package-manifest-enterprise-runthrough.json
- coordination/reports/2026-07-01-owner-decision-package-manifest-enterprise-runthrough.md
- coordination/reports/2026-07-02-owner-decision-response-gap-matrix-enterprise-runthrough.json
- coordination/reports/2026-07-02-owner-decision-response-gap-matrix-enterprise-runthrough.md
- scripts/app-auth-env-source-intake.mjs
- scripts/app-auth-production-evidence-gate.mjs
- scripts/app-auth-production-evidence-preflight.mjs
- scripts/app-auth-vercel-env-sync-evidence-gate.mjs
- scripts/enterprise-live-evidence-audit-production-evidence-gate.mjs
- scripts/enterprise-live-evidence-audit-production-evidence-preflight.mjs
- scripts/external-storage-env-source-intake.mjs
- scripts/external-storage-production-evidence-gate.mjs
- scripts/external-storage-production-evidence-preflight.mjs
- scripts/external-storage-vercel-env-sync-evidence-gate.mjs
- scripts/manual-ppt-playback-acceptance-production-evidence-gate.mjs
- scripts/manual-ppt-playback-acceptance-production-evidence-preflight.mjs
- scripts/ordinary-teaching-production-evidence-gate.mjs
- scripts/ordinary-teaching-production-evidence-preflight.mjs
- scripts/ordinary-teaching-production-evidence-prerequisite-index.mjs
- scripts/owner-decision-action-packet-index.mjs
- scripts/owner-decision-app-auth-response-template.mjs
- scripts/owner-decision-app-auth-response-validation.mjs
- scripts/owner-decision-enterprise-live-evidence-audit-response-template.mjs
- scripts/owner-decision-enterprise-live-evidence-audit-response-validation.mjs
- scripts/owner-decision-external-storage-response-template.mjs
- scripts/owner-decision-external-storage-response-validation.mjs
- scripts/owner-decision-first-blocker-request.mjs
- scripts/owner-decision-live-run-approval-gate.mjs
- scripts/owner-decision-manual-ppt-playback-acceptance-response-template.mjs
- scripts/owner-decision-manual-ppt-playback-acceptance-response-validation.mjs
- scripts/owner-decision-ordinary-teaching-production-evidence-response-template.mjs
- scripts/owner-decision-ordinary-teaching-production-evidence-response-validation.mjs
- scripts/owner-decision-package-manifest.mjs
- scripts/owner-decision-production-release-run-response-template.mjs
- scripts/owner-decision-production-release-run-response-validation.mjs
- scripts/owner-decision-response-completion-extract.mjs
- scripts/owner-decision-response-completion-from-responses.mjs
- scripts/owner-decision-response-completion-packet.mjs
- scripts/owner-decision-response-completion-validation.mjs
- scripts/owner-decision-response-gap-matrix.mjs
- scripts/owner-decision-response-package-manifest.mjs
- scripts/owner-decision-response-postvalidation-suite.mjs
- scripts/owner-decision-teacher-auth-response-template.mjs
- scripts/owner-decision-teacher-auth-response-validation.mjs
- scripts/owner-decision-vercel-env-deploy-response-template.mjs
- scripts/owner-decision-vercel-env-deploy-response-validation.mjs
- scripts/production-env-source-handoff.mjs
- scripts/production-evidence-execution-plan.mjs
- scripts/production-evidence-reuse-audit.mjs
- scripts/production-release-run-production-evidence-gate.mjs
- scripts/production-release-run-production-evidence-preflight.mjs
- scripts/teacher-auth-env-source-intake.mjs
- scripts/teacher-auth-production-evidence-gate.mjs
- scripts/teacher-auth-production-evidence-preflight.mjs
- scripts/teacher-auth-vercel-env-sync-evidence-gate.mjs
- scripts/vercel-env-deploy-production-evidence-gate.mjs
- scripts/vercel-env-deploy-production-evidence-preflight.mjs
- tests/app-auth-env-source-intake.test.ts
- tests/app-auth-production-evidence-gate.test.ts
- tests/app-auth-production-evidence-preflight.test.ts
- tests/app-auth-vercel-env-sync-evidence-gate.test.ts
- tests/enterprise-live-evidence-audit-production-evidence-gate.test.ts
- tests/enterprise-live-evidence-audit-production-evidence-preflight.test.ts
- tests/external-storage-env-source-intake.test.ts
- tests/external-storage-production-evidence-gate.test.ts
- tests/external-storage-production-evidence-preflight.test.ts
- tests/external-storage-vercel-env-sync-evidence-gate.test.ts
- tests/manual-ppt-playback-acceptance-production-evidence-gate.test.ts
- tests/manual-ppt-playback-acceptance-production-evidence-preflight.test.ts
- tests/operator-input-packet-markdown-visibility.test.ts
- tests/operator-input-packet-safety-propagation.test.ts
- tests/ordinary-teaching-production-evidence-gate.test.ts
- tests/ordinary-teaching-production-evidence-preflight.test.ts
- tests/ordinary-teaching-production-evidence-prerequisite-index.test.ts
- tests/owner-decision-action-packet-index.test.ts
- tests/owner-decision-app-auth-response-template.test.ts
- tests/owner-decision-app-auth-response-validation.test.ts
- tests/owner-decision-enterprise-live-evidence-audit-response-template.test.ts
- tests/owner-decision-enterprise-live-evidence-audit-response-validation.test.ts
- tests/owner-decision-external-storage-response-template.test.ts
- tests/owner-decision-external-storage-response-validation.test.ts
- tests/owner-decision-first-blocker-request.test.ts
- tests/owner-decision-live-run-approval-gate.test.ts
- tests/owner-decision-manual-ppt-playback-acceptance-response-template.test.ts
- tests/owner-decision-manual-ppt-playback-acceptance-response-validation.test.ts
- tests/owner-decision-ordinary-teaching-production-evidence-response-template.test.ts
- tests/owner-decision-ordinary-teaching-production-evidence-response-validation.test.ts
- tests/owner-decision-package-manifest.test.ts
- tests/owner-decision-production-release-run-response-template.test.ts
- tests/owner-decision-production-release-run-response-validation.test.ts
- tests/owner-decision-response-completion-extract.test.ts
- tests/owner-decision-response-completion-from-responses.test.ts
- tests/owner-decision-response-completion-packet.test.ts
- tests/owner-decision-response-completion-validation.test.ts
- tests/owner-decision-response-gap-matrix.test.ts
- tests/owner-decision-response-package-manifest.test.ts
- tests/owner-decision-response-postvalidation-suite.test.ts
- tests/owner-decision-teacher-auth-response-template.test.ts
- tests/owner-decision-teacher-auth-response-validation.test.ts
- tests/owner-decision-vercel-env-deploy-response-template.test.ts
- tests/owner-decision-vercel-env-deploy-response-validation.test.ts
- tests/production-env-source-handoff.test.ts
- tests/production-evidence-execution-plan.test.ts
- tests/production-evidence-reuse-audit.test.ts
- tests/production-release-run-production-evidence-gate.test.ts
- tests/production-release-run-production-evidence-preflight.test.ts
- tests/teacher-auth-env-source-intake.test.ts
- tests/teacher-auth-production-evidence-gate.test.ts
- tests/teacher-auth-production-evidence-preflight.test.ts
- tests/teacher-auth-vercel-env-sync-evidence-gate.test.ts
- tests/vercel-env-deploy-production-evidence-gate.test.ts
- tests/vercel-env-deploy-production-evidence-preflight.test.ts
- coordination/reports/2026-07-01-enterprise-live-evidence-triage-enterprise-runthrough.json
- coordination/reports/2026-07-01-enterprise-live-evidence-triage-enterprise-runthrough.md
- scripts/enterprise-live-evidence-triage.mjs
- tests/enterprise-live-evidence-triage.test.ts
- coordination/reports/2026-07-01-release-blocker-dependency-graph-enterprise-runthrough.json
- coordination/reports/2026-07-01-release-blocker-dependency-graph-enterprise-runthrough.md
- scripts/release-blocker-dependency-graph.mjs
- tests/release-blocker-dependency-graph.test.ts
- scripts/release-blocker-diagnosis-coverage.mjs
- tests/release-blocker-diagnosis-coverage.test.ts
- coordination/reports/2026-07-01-enterprise-runthrough-bundle-manifest.json
- coordination/reports/2026-07-01-enterprise-runthrough-bundle-manifest.md
- scripts/enterprise-runthrough-bundle-manifest.mjs
- tests/enterprise-runthrough-bundle-manifest.test.ts
- coordination/reports/2026-07-01-enterprise-runthrough-review-slice-index.json
- coordination/reports/2026-07-01-enterprise-runthrough-review-slice-index.md
- scripts/enterprise-runthrough-review-slice-index.mjs
- tests/enterprise-runthrough-review-slice-index.test.ts
- coordination/reports/2026-07-01-enterprise-runthrough-package-gate.json
- coordination/reports/2026-07-01-enterprise-runthrough-package-gate.md
- scripts/enterprise-runthrough-package-gate.mjs
- tests/enterprise-runthrough-package-gate.test.ts
- coordination/release-intake/2026-07-03-current-rescue-dirty-map.json
- coordination/release-intake/2026-07-03-final-rescue-dirty-map.json
- coordination/reports/2026-07-01-president-report.docx
- coordination/session-logs/2026-07-01-S10.md
- coordination/session-logs/2026-07-02-S10.md
- coordination/session-logs/2026-07-03-S25.md
- coordination/session-logs/2026-06-30-S22.md
