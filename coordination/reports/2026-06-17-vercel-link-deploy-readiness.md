# UAIS Vercel Link and Deploy Readiness

- Date: 2026-06-17
- Session: S22
- Scope: Non-mutating Vercel CLI/project-link and upload-hygiene readiness check.
- Status: Blocked before deploy: Vercel CLI is installed, but the local UAIS workspace is not linked to a Vercel project.
- Redaction rule: This report records tool presence, version, boolean project-link state, and file-pattern hygiene only. It does not include Vercel account names, org IDs, project IDs, deployment URLs, provider keys, auth tokens, cookies, or local secret values.

## Readiness Results

| Check | Result | Release implication |
| --- | --- | --- |
| Vercel CLI path | Present | CLI commands can be run locally. |
| Vercel CLI version | `54.9.0` | CLI is available for future link/env/deploy actions. |
| `.vercel/project.json` | Missing | `vercel link` must run before `scripts/vercel-env-sync.mjs --apply --approved` can place env values. |
| `vercel.json` | Missing | No project-specific Vercel config is currently present. |
| `.vercelignore` | Present after this S22 update | Deployment upload now excludes local env, secret docs, generated assets, and large local bundles. |

## Machine-Readable Evidence

- New evidence script: `scripts/vercel-project-readiness.mjs`
- Current evidence file: `coordination/reports/2026-06-17-vercel-project-readiness.json`
- Current evidence status: `blocked`
- Current blocker: `vercel-project-not-linked`
- Production E2E gate behavior: `coordination/reports/2026-06-17-production-e2e-release-gate.json` now requires this evidence and remains blocked until the Vercel project link check is `present`.

## Upload Hygiene

The new `.vercelignore` excludes:

| Pattern | Purpose |
| --- | --- |
| `.env`, `.env.*`, `!.env.local.example` | Exclude real local env files while allowing the example env file. |
| `All API Keys.docx` | Exclude local credential document from deployment upload. |
| `OpenMAIC-main.zip` | Exclude large local source bundle from deployment upload. |
| `.tmp/`, `output/`, `coordination/`, `docs/` | Exclude local generated artifacts, reports, and non-runtime docs from deployment upload. |
| `node_modules/`, `.next/`, `out/`, `build/`, `.playwright-cli/`, `coverage/` | Exclude dependency/build/test outputs. |
| `tsconfig.tsbuildinfo`, `next-env.d.ts`, `.DS_Store`, debug logs | Exclude local generated/noise files. |

## Required Next Steps

1. S19/S22 should link the local project to the intended Vercel project after owner approval.
   - Command to run interactively when approved: `vercel link`
   - Do not print or commit resulting project IDs.
   - After linking, rerun `node scripts/vercel-project-readiness.mjs`.

2. S19 should rerun redacted env sync dry-run after link.
   - `node scripts/vercel-env-sync.mjs --dry-run --project uais --env-file .env.local`

3. S19 should apply env values only after owner approval and linked project confirmation.
   - `node scripts/vercel-env-sync.mjs --apply --approved --project uais --env-file .env.local`

4. S22 should deploy or inspect the owner-approved deployment URL, then run live smoke.
   - `node scripts/teacher-workflow-deployment-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file .env.local --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence>`
   - `node scripts/ai-route-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file .env.local --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --teacher-auth-provider-readiness <teacher-auth-provider-readiness-evidence>`

## Non-Completion Statement

This report improves deployment hygiene and identifies the missing Vercel project link. It does not place Vercel env values, create a deployment, or prove live route smoke. The production deployment chain remains incomplete until the project is linked, env values are applied, a deployment URL exists, and the live smoke gates pass.
