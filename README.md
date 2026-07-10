# UAIS Teaching Website Template

UAIS is a personal teaching website template for `uais.top`. The name supports both
University AI System and University Adaptive Interactive System.

The interface is MAIC-informed at the pattern level: course plaza cards, learner playback,
human-AI group chat, and a teacher course-management workspace. It does not include private
ClosedMAIC screenshots, internal identities, proprietary assets, or copied MAIC content.

## Stack

- Next.js App Router
- React and TypeScript
- Tailwind CSS v4
- Phosphor Icons
- Vitest acceptance tests

## Routes

- `/courses` - 课程广场, with exactly two course cards: 大学研究方法 and 数学教学法.
- `/learning` - 我的学习, with enrolled courses, playback-style learning panel, and a chatroom entry button.
- `/learning/chatroom` - full 人机协作聊天室 interface for group messages, AI agents, PDF export, and sharing.
- `/teaching` - 我的教学, with teacher course cards and management entry points.
- `/` - redirects to `/courses`.

## Project Structure

- `src/data/uais.ts` - mock courses, learning records, AI agents, chat messages, and teacher dashboard items.
- `src/i18n/copy.ts` - bilingual copy for `zh-CN` and `en-US`, with Simplified Chinese as the default.
- `src/lib/chat-actions.ts` - UI-ready mocked PDF export and share-link helpers.
- `src/components/providers/app-preferences.tsx` - language and light/dark theme state.
- `src/components/layout/` - app shell and top navigation.
- `src/components/pages/` - page-level UI for the three teaching areas.
- `tests/uais-data.test.ts` - acceptance checks for the brief-critical data contract.

## Extending

Replace mock data in `src/data/uais.ts` first, then update page components only when the shape of the
workflow changes. Real PDF export and share links can be connected behind `src/lib/chat-actions.ts`
without changing the chatroom UI.

## Development

```bash
npm run dev
npm run test
npm run test:critical
npm run lint
npm run build
npm run db:migrate
```

## Operator Docs

- `CONTRIBUTING.md` - small-team setup, coding, review, and safety rules.
- `SCOPE.md` - B-07 core POC boundary and parked experimental surface.
- `docs/architecture-map.md` - current and near-term architecture map.
- `docs/core-schema-design.md` - B-10 core database schema draft and migration
  order.
- `docs/adaptive-recommendations.md` - B-18 deterministic recommendation rules
  and privacy boundary.
- `docs/learner-profiles.md` - B-17 learner-profile projection from persisted
  xAPI evidence.
- `docs/env-surface.md` - B-21 active, optional, and quarantined env surface.
- `docs/API.md` - core POC API contracts only.
- `docs/privacy-baseline.md` - B-22 minimum student PII, role access,
  retention, and production stop conditions.
- `docs/performance-accessibility-baseline.md` - B-19/B-20 dynamic-shell,
  route-title, and remaining Lighthouse/a11y audit contract.
- `docs/runbooks/observability.md` - B-05 Sentry, uptime, and health-check
  operating contract.
- `docs/runbooks/staging-preview.md` - B-09 preview, staging, and production
  promotion contract.
- `docs/runbooks/pre-deploy-checklist.md` - checks before promoting a deployment.
- `docs/runbooks/production-rollback.md` - two-minute rollback procedure.

## Database

B-11 now has a provider-neutral Drizzle/Postgres foundation:
`src/lib/db/schema.ts`, `migrations/0001_core_poc.sql`, and
`npm run db:migrate`. The runner requires a server-only
`UAIS_CORE_DATABASE_URL` or compatible Postgres URL and prints only redacted
status. `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=postgres` selects the
transitional teaching-course Postgres repository, while
`UAIS_LANGGRAPH_PERSISTENCE_BACKEND=postgres` selects the official LangGraph
Postgres checkpointer and store. The same migration command creates both the
core schema and the isolated `uais_langgraph` schema; a
dedicated Neon Launch resource is provisioned for UAIS Production.
`npm run vercel-build` applies the idempotent migrations before `next build`.
Credential values remain deployment-owner work and must stay server-only.

## CI Gate

`.github/workflows/critical-flow.yml` runs the current B-16 gate for pull
requests and pushes to `main`: install, lint, `npm run test:critical`,
advisory-governance checks, and a compile-only Next route build. Repository
branch protection still needs to require this workflow before it can block
merges on GitHub.
