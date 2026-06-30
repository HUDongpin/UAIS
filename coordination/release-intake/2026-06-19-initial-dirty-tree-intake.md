# Initial Dirty-Tree Intake

- Date: 2026-06-19
- Prepared by: S10 as an initial coordination seed
- Intended validator: S25
- Scope: Non-destructive inventory only
- Status: Draft intake seed. S25 should validate before this is used for PR slicing or release claims.

## Current Status Summary

`git status --short` currently shows:

- 9 modified tracked entries.
- 20 untracked top-level entries.
- Large untracked project areas under `coordination/`, `docs/`, `scripts/`, `src/`, and `tests/`.
- At least one secret-like local document or local credential artifact is present. It must stay redacted by category and must not be inspected, staged, committed, copied, screenshotted, or summarized.

No staging, commit, branch, push, reset, delete, or revert operation was performed.

## Ownership Map Seed

| Area | Current status shape | Default owner/session | Intake note |
| --- | --- | --- | --- |
| `.gitignore`, `AGENTS.md`, `README.md`, package/config docs | Modified tracked files | S10, with S22 coordination for build-impacting config | Keep docs/config slices separate from feature UI. |
| `next.config.ts`, `.vercelignore`, deployment hygiene files | Modified or untracked config/release files | S22, with S10 docs coordination | Release-impacting changes need narrow S22 package and build/deploy evidence. |
| `.env.local.example` | Untracked env example | S19, with S10 docs coordination | Example files only; no real secrets. |
| Secret-like local credential artifacts | Untracked local artifact category | S19 only if owner explicitly assigns credentials work | Redacted category only. Do not inspect values or include exact secret material. |
| Local archive or external-source bundle | Untracked local artifact category | S21/S24/S10 depending on owner assignment | Treat as local/private until provenance is documented. |
| `Dockerfile.external-storage`, external-storage launch/support files | Untracked release/storage support | S22/S12 boundary | Keep storage runtime proof separate from backend route contracts. |
| `coordination/` | Untracked coordination logs/reports/blockers/intake | S10/S22/S24/S25 depending on subfolder | S25 should identify canonical vs stale evidence before release claims. |
| `scripts/` | Untracked release/test/helper scripts | S10/S11/S22 depending on script purpose | Script ownership should be mapped before edits continue. |
| `tests/`, `vitest.config.mts` | Untracked or modified test surface | S11, with feature-session focused tests by assignment | S11 should own broad regression matrix and release-gate coverage clarity. |
| `src/app/api/` | Untracked backend/API routes | S12 | Backend/API contract changes should not be absorbed by S22. |
| `src/app/courses/` | Untracked route surface | S02 | Course plaza/package work. |
| `src/app/learning/` | Untracked route surface | S03/S04 | Split learner workspace from chatroom work. |
| `src/app/teaching/` | Untracked route surface | S05/S13 | S05 for current teaching page, S13 for future management subroutes. |
| `src/components/` | Untracked component surface | Mixed S01/S02/S03/S04/S05/S06/S09 | Requires file-level owner mapping before parallel edits. |
| `src/data/` | Untracked shared data surface | S08 | Shared schema/data changes need data-contract checks. |
| `src/i18n/` | Untracked copy/localization surface | S09 | Keep bilingual terminology changes coordinated. |
| `src/lib/` | Untracked library/helpers surface | Mixed S04/S07/S12/S15/S22 | Map by function before further work. |
| `output/` | Untracked generated/local output category | S24/S10 depending on provenance | Should not be committed unless explicitly approved and provenance is clear. |

## Evidence Freshness Seed

S25 should validate the latest canonical evidence before S10 or S22 uses it in release summaries. Current likely candidates by report naming and modification time include:

- Release gate: `coordination/reports/2026-06-19-production-e2e-release-gate-current-vercel-preview-timeout-with-learning.json`
- Owner checklist: `coordination/reports/2026-06-19-production-owner-decision-checklist-current-vercel-personal-scope.json`
- Vercel readiness: `coordination/reports/2026-06-19-vercel-project-readiness-current-uais.json`
- Vercel env sync dry-run: `coordination/reports/2026-06-19-vercel-env-sync-current-post-link-dry-run.json`
- Deployment reachability diagnostics: latest `coordination/reports/2026-06-19-deployment-reachability-diagnostics-*.json`
- Teacher workflow live preview smoke: `coordination/reports/2026-06-19-teacher-workflow-deployment-smoke-vercel-preview-live.json`
- Learning PPT live preview smoke: `coordination/reports/2026-06-19-learning-ppt-playback-deployment-smoke-vercel-preview-live.json`
- External-storage local reference evidence: `coordination/reports/2026-06-19-external-storage-container-local-reference-service-readiness.json` and `coordination/reports/2026-06-19-external-storage-container-local-reference-smoke.json`
- PPT manual acceptance gate: `coordination/reports/2026-06-19-kangxia-ppt-manual-playback-acceptance-gate-current.json`

This list is intentionally cautious. It identifies likely current files; it does not assert release completion.

## Immediate Recommended Packages

| Priority | Session | Package | Acceptance evidence |
| --- | --- | --- | --- |
| 1 | S25 | Validate this dirty-tree intake and produce the authoritative `YYYY-MM-DD-dirty-tree-inventory.md`. | Owner/session map, stale/current evidence list, and PR/commit slice recommendation. |
| 2 | S10 | Convert S25 intake into the next nightly assignment and president-report summary. | Nightly assignment references one narrow S22 package and current blockers. |
| 3 | S11 | Build a release-quality matrix from current release-gate requirements. | Matrix separates local proof, preview proof, production proof, waiting evidence, and blockers. |
| 4 | S22 | Take one release-chain segment only after S25 intake is validated. | A single refreshed report or harness result, not a broad all-in-one release pass. |
| 5 | S12/S19/S24 | Accept handoffs only for backend/API, env, or PPT/export blockers surfaced by the narrow S22 segment. | Each handoff stays inside its owner scope. |

## Release-Control Decision

Do not add S26+ roles now. The current evidence supports tighter intake, smaller release packages, and clearer evidence freshness tracking.
