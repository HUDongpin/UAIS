# UAIS Dirty-Tree Inventory

- Date: 2026-06-30 23:45 HKT
- Prepared by: S25
- Branch: `codex/uais-dirty-rescue-2026-06-30`
- Backup: `/Users/dongpinhu/Desktop/UAIS-dirty-worktree-backups/2026-06-30-2345-HKT`
- Scope: Non-destructive intake plus cleanup routing

## Starting State

Fresh status before cleanup edits and archive moves showed:

- `1197` total porcelain status entries.
- `10` tracked modified files.
- `1187` untracked files.
- One linked worktree only: `/Users/dongpinhu/Desktop/UAIS`.

Tracked modifications were limited to `.gitignore`, `AGENTS.md`, `README.md`, `next.config.ts`, package files, the favicon, and root app files. The untracked work covered app routes, API routes, components, data/i18n, scripts, tests, public learning/login assets, coordination evidence, docs, generated Playwright output, and one local source archive.

## Top-Level Untracked Inventory

| Top-level path | Files | Disposition |
| --- | ---: | --- |
| `coordination/` | 776 | Retain as coordination evidence and reports; commit as S10/S22/S24/S25 evidence slice. |
| `src/` | 137 | Retain as reviewed source slices by owner area. |
| `output/` | 97 | Archive outside the repo; keep ignored as generated/local evidence. |
| `tests/` | 80 | Retain as S11 test coverage slice. |
| `scripts/` | 45 | Retain release/test helpers; hygiene scripts belong to S10/S25. |
| `public/` | 42 | Retain app assets as S24/public asset slice. |
| `docs/` | 3 | Retain as documentation slice. |
| Config/root files | 7 | Retain or ignore according to owner map. |
| `OpenMAIC-main.zip` | 1 | Archive outside the repo and ignore. |

## Secret-Like Handling

No real secret values were inspected. The only secret-like untracked categories observed by path were:

- `.env.local.example`, which is an example file owned by S19.
- Redacted report filenames referring to secret rotation or deploy-token diagnostics; keep as evidence files only if they contain no real values.
- Login password-lock screenshots under `output/`, which are generated visual artifacts and are archived/ignored.

## Recommended Review Slices

1. S10/S25 hygiene and coordination: `.gitignore`, `AGENTS.md`, release-intake docs, dirty-map scripts, and package script aliases.
2. S10/S22 release config: `.dockerignore`, `.vercelignore`, `Dockerfile.external-storage`, `next.config.ts`, `vercel.json`, package files.
3. S01/S06 shell and design: root app files, layout/provider components, globals, favicon.
4. S02-S05 route/page surfaces: course, learning, login, student-dashboard, teaching, privacy/terms, page components, teaching components.
5. S08/S09 data and copy: `src/data/` and `src/i18n/`.
6. S12 backend/API: `src/app/api/`, `src/lib/server/`, and `src/proxy.ts`.
7. S07 AI/LRS/library helpers: `src/lib/ai/`, `src/lib/learning-records/`, `src/lib/learning/`, auth and chat helpers.
8. S11 test suite: `tests/` and `vitest.config.mts`.
9. S24 public assets: retained public learning/login assets.

## Cleanup Rule

Do not use `git add .`. Every commit in this rescue branch must use explicit pathspecs matching `coordination/release-intake/owner-pathspecs.json`.

## Archive Disposition

The generated/local-only paths `output/` and `OpenMAIC-main.zip` were moved out of the repository after the full backup was created. Their live archive location is `/Users/dongpinhu/Desktop/UAIS-dirty-worktree-backups/2026-06-30-2345-HKT/moved-local-only`.
