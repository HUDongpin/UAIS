# UAIS — Next Development Plan

- **Date:** 2026-07-18
- **Project:** UAIS — University AI System / University Adaptive Interactive System (`/Users/dongpinhu/Desktop/UAIS`, live at `www.uais.top`)
- **Prepared for:** Dr. Peter Hu, Founder / Project Owner
- **Prepared by:** Claude (planning pass, read-only assessment of the current tree)
- **Anchors:** the 8 July 2026 Senior Technical Advisory (`docs/technical-advisory/`), the B-07 scope boundary (`SCOPE.md`), the architecture map (`docs/architecture-map.md`), and the coordination contract (`AGENTS.md`)
- **Status of this document:** proposal for owner review. It changes no feature code and should not be committed without owner approval, per the coordination contract.

---

## 执行摘要 (Chinese Executive Summary)

UAIS 已在 `www.uais.top` 稳定上线，双语界面、课程广场、学习回放、人机聊天室与教师工作台均可用，且刚完成第 4 轮缺陷排查（2000 项测试、类型检查与 lint 全绿）。自 7 月 8 日技术顾问报告以来，最重要的进展是：生产环境已接入受管 Postgres（LangGraph 持久化）、已配置 Neon 数据库、并已收紧生产环境的演示登录。

但顾问报告指出的三大根基性风险仍未真正解决：**核心业务数据（用户、课程、选课、成绩、成员）仍运行在 JSON/内存存储上**，在 Serverless 环境下不持久；**最大的文件仍然过大**（`teaching-page.tsx` 约 7,700 行、教学存储约 6,700 行），难以安全修改。因此，本季度的方向仍应是"打地基，而非加功能"。

本计划建议按优先级推进：先落地待审的缺陷修复切片（阶段 0），随后把核心实体逐一迁移到 Postgres（阶段 1，最高优先级），统一并加固认证（阶段 2），拆分最危险的大文件（阶段 3），把测试从"发布文书"转向真实用户旅程并打通预发布/生产发布通道（阶段 4），最后在稳固地基上补齐自适应学习、性能/无障碍与课程内容（阶段 5）。

**最需要决策的事项：** 是否授权把核心实体切换到 Postgres 为读路径；是否批准从本地可靠执行迁移的方案；以及是否为真实学生队列设定隐私基线与上线检查单。

## English Executive Summary

UAIS is stably live at `www.uais.top` — the bilingual course plaza, learner playback, human-AI chatroom, and teacher workspace all work, and the project just completed its 4th bug-detection pass (2000 tests, typecheck, and lint all green). Since the 8 July advisory, the most significant progress is real infrastructure: managed Postgres (LangGraph persistence) is deployed to production, a dedicated Neon database is provisioned, and the production demo login has been tightened.

The advisory's three foundational risks, however, are **not yet truly resolved**: core business data (users, courses, enrolments, gradebooks, memberships) still runs on **JSON / in-memory stores** that are not durable on serverless hosting, and the worst files are still enormous (`teaching-page.tsx` ~7,700 lines; the teaching store ~6,700). The correct direction this quarter remains **"foundations, not features."**

This plan proposes a prioritized sequence: land the pending bug-fix slice (Phase 0); cut core entities over to Postgres one at a time (Phase 1, highest priority); consolidate and harden auth (Phase 2); decompose the most dangerous large files (Phase 3); redirect testing from release paperwork toward real user journeys and stand up the staging→production promotion lane (Phase 4); and only then build adaptive learning, performance/accessibility, and real course content on the now-solid foundation (Phase 5).

---

## 1. Where UAIS stands on 2026-07-18

### 1.1 What is solid

| Area | Evidence |
| --- | --- |
| Live product | `www.uais.top` resolves to a `READY` deployment (`dpl_6F7V…`, S22 log 2026-07-10). |
| Core routes | `/courses`, `/learning`, `/learning/chatroom`, `/teaching`, `/student-dashboard`, `/login`, `/healthz`, `/privacy`, `/terms` all present under `src/app/`. |
| Baseline gates green | Typecheck (`tsc --noEmit`), lint (`eslint .`), and the full suite (2000 tests / 159 files) all pass per the 2026-07-18 bug-detection pass. |
| Production AI path | Multi-agent learning guide runs live (DeepSeek → Qwen → DeepSeek), bounded to 256 tokens, ~26s response. |
| Managed persistence seam (partial) | Official LangGraph `PostgresSaver`/`PostgresStore` deployed in the isolated `uais_langgraph` schema; migration `0001_core_poc.sql` applies from the Vercel build network. |
| Auth tightened | Guarded production demo access restored (`49f0db3`); signed app-session validation in `src/lib/server/uais-app-session.ts` + role routing in `src/proxy.ts`. |
| Scope discipline documented | `SCOPE.md` (B-07) freezes the core POC surface and parks voice-clone / PPT-narration / enterprise-evidence modules. |

### 1.2 Progress since the 8 July advisory

The advisory's Weeks 1–2 ("stop the bleeding") and Weeks 3–4 ("get organised") are largely addressed: production demo login is gated, Sentry/uptime/`/healthz` are wired, scope is frozen (`SCOPE.md`), the DB schema is designed (`docs/core-schema-design.md`, 14 Drizzle tables), and a staging/promotion runbook exists (`docs/runbooks/staging-preview.md`). The advisory's **Month 2 foundation work has only started** and **Month 3 has not.**

### 1.3 The gaps that still define the roadmap

These are grounded in the current tree, not the advisory's July snapshot:

1. **Core data is still not durable.** The Postgres *schema* exists, but the core *stores* still persist to JSON / in-memory maps — `src/lib/server/teaching-course-management-store.ts` (6,746 lines) and `src/lib/server/teaching-operations-store.ts` (4,926 lines) read/write files and Maps. Only the LangGraph checkpointer and a *transitional* teaching-course Postgres seam are wired to Postgres. **Users, courses, enrolments, submissions, and memberships are not yet cut over.** On serverless hosting this data is not reliably durable or shared between instances.
2. **The worst files are still too large to change safely.** Largest source files today: `teaching-page.tsx` **7,698**, `teaching-course-management-store.ts` **6,746**, `teaching-operations-store.ts` **4,926**, `external-storage-route-service.ts` **4,144**, `api/teaching/operations/route.ts` **4,121**, `learning-page.tsx` **3,601**. The advisory's "split the worst files" item is essentially untouched.
3. **Tests still skew toward release paperwork.** Of 159 test files, a large share are enterprise-evidence / owner-decision / release-gate tests. The `test:critical` gate covers ~5 journeys, but real browser E2E for the five canonical flows does not yet block merges.
4. **Local→DB migration is not reliably runnable.** Direct and pooled Neon migrations time out from the local environment (S22 2026-07-10); only the Vercel build network succeeds. A durable-data cutover needs a dependable migration path a developer can run.
5. **Product is still a two-course demo.** Real course content, a real cohort, and the privacy baseline sign-off remain ahead.
6. **Pending uncommitted work.** The 2026-07-18 bug-detection pass applied three fixes (SSR theme/FOUC, non-finite score guard, `maxAgentTurns` clamp) + 4 regression tests, plus an S06 CSS tweak — all uncommitted, awaiting owner review.

---

## 2. Guiding principles for this plan

1. **Foundations, not features** (advisory directive). Spend the quarter on durability, auth, and change-safety before new product surface.
2. **Respect the B-07 scope boundary.** Do not expand parked modules (voice clone, PPT narration, enterprise evidence) unless the owner opens a scoped decision. No new env vars for parked modules.
3. **Expand → migrate → contract** for every persistence change (architecture-map §Migration Rule): add the adapter behind the existing seam, dual-write/backfill one entity, prove parity in staging, switch reads, then remove the old path only after a rollback exists.
4. **One writer per file at a time** and stay inside session write scopes (`AGENTS.md`). Large shared files (`uais.ts`, `copy.ts`, `learning-page.tsx`, `teaching-page.tsx`, `globals.css`) are coordinated, not concurrently edited.
5. **No Git mutation without owner assignment.** The root checkout is an intake surface; feature work should move to assigned branches/worktrees, and slices are reviewed before commit.
6. **Every code task runs the checks the contract requires** before handoff (lint/test/build per change type), and states what was not run and why.

---

## 3. The plan — phased and prioritized

### Phase 0 — Land the pending bug-fix slice (this week, ~0.5 day)

- **Owning sessions:** S25 (intake/slicing) → owner review → S11 (regression confirm), S06 (its own CSS tweak).
- **Why first:** three verified fixes + four regression tests are sitting uncommitted; leaving them in the dirty root risks loss and blocks a clean baseline for Phase 1.
- **Tasks:**
  - S25 produces a preserve-first dirty-tree map splitting the tree into reviewable slices: (a) SSR theme fix — `layout.tsx` + `app-preferences.tsx` + `tests/app-preferences.test.tsx`; (b) non-finite score guard — `learner-profile.ts` + `tests/learner-profile.test.ts`; (c) `maxAgentTurns` clamp — `api/ai/chat/route.ts`; (d) S06 playback-dock CSS — `learning-page.tsx` + `tests/learning-page.test.tsx`.
  - Owner reviews and authorizes the commit slices (per the contract, S25 does not commit unassigned).
  - Browser-confirm the SSR theme fix on a preview or production load (bug report §checks-not-run flagged this as the one remaining manual confirmation): dark-mode returning user shows no theme flash and the correct header icon on first paint.
- **Acceptance:** clean `git status` after the authorized slices land; `npm run test`, `npm run lint`, `npm run build` green on the committed baseline; theme-flash confirmed absent in a browser.
- **Checks:** `npm run test`, `npm run lint`, `npm run build`; manual dark-mode browser load.

### Phase 1 — Durable core data foundation (Month 2 · highest priority · 2–3 weeks)

This is the single most important workstream. It directly closes advisory risk #1.

- **Owning sessions:** S12 (backend/API contracts, store adapters), S08 (data types/invariants), S22 (migration reliability, staging parity), S19 (redacted env/credentials placement only).
- **Objective:** move the core system-of-record entities off JSON/in-memory storage onto the provisioned Neon Postgres, one entity at a time, behind the existing store interfaces, with a proven rollback path.
- **Recommended entity order** (lowest-risk first, following `schema.ts`): `users` → `courses` → `enrollments`/`classes`/`invite_codes` → `submissions`/`assessments` → teaching `operations`/audit. Keep `learning_events`/`learner_profiles`/`recommendations` as the last cutover since analytics tolerate eventual consistency.
- **Prerequisite (blocker to unblock):** a dependable migration path a developer can run. Options for owner decision: (a) run migrations only from the Vercel build (`vercel-build` already does this) and treat local as read-only against a branch DB; (b) provision a local-reachable Neon branch/pooler with a working connection; (c) a one-shot owner-run migration job. **Do not** add a public migration endpoint.
- **Tasks (per entity, repeat):**
  1. Confirm the Drizzle table in `schema.ts` matches the store's current shape; add any missing columns via a new numbered migration (never edit `0001`).
  2. Implement a Postgres-backed adapter behind the existing store interface (mirror the pattern already used by `teaching-course-management-postgres-store.ts`).
  3. Dual-write (JSON + Postgres) and backfill existing JSON records; add parity assertions.
  4. Prove parity in staging (Phase 4 lane) for the same release slice.
  5. Switch reads to Postgres behind an env flag (`UAIS_*_BACKEND=postgres`), keep JSON as fallback.
  6. Remove the JSON path only after a rollback is demonstrated.
- **Acceptance:** for each cutover entity, create/read/update survives a server restart and is visible across instances; parity tests pass in staging; a documented rollback flips reads back to JSON without data loss.
- **Checks:** `npm run test` (+ targeted store/API tests), `npm run lint`, `npm run build`, `npm run db:migrate` against the branch DB, staging smoke.
- **Risks:** local migration timeout (mitigate via the migration-path decision above); dual-write divergence (mitigate with parity tests and a single backfill window); serverless connection limits (use the Neon pooler).

### Phase 2 — Auth consolidation & secrets hygiene (Month 2 · 1 week, parallelizable with Phase 1)

Closes advisory risk #2.

- **Owning sessions:** S12 (session model), S19 (redacted env/secrets placement), S10 (docs).
- **Objective:** one coherent, trustworthy login model; production demo fully gated; secrets server-only.
- **Tasks:**
  - Audit `src/lib/server/uais-app-session.ts`, `uais-app-auth-provider.ts`, and `src/proxy.ts` and confirm the gate validates a signed session (not mere cookie presence) on every protected route; add tests for forged/absent/expired cookies if any path is uncovered.
  - Confirm the built-in demo credential (`Phoebe / 12345`) cannot authenticate in production except via the explicit owner opt-in, and document the exact opt-in switch.
  - Consolidate the split teacher-auth/OIDC issuer-proof paths (currently parked behind legacy readiness) behind the single app-session model, or explicitly keep them parked in `SCOPE.md` with a dated rationale.
  - Verify no secret reaches a `NEXT_PUBLIC_` variable, log, report, or screenshot; keep the redacted env inventory current (`docs/env-surface.md`).
- **Acceptance:** forged-cookie rejection and production-demo-gating are covered by tests in `test:critical`; a one-paragraph "auth contract" is documented; no plaintext secret in the repo or logs.
- **Checks:** `npm run test:critical`, `npm run test`, `npm run lint`.
- **Stop condition:** any need to place real secrets → stop and route to S19 with owner approval.

### Phase 3 — Decompose the most dangerous files (Month 2–3 · 2 weeks · high care)

Closes advisory risk #3. Do this *after* the entities it touches have test coverage.

- **Owning sessions:** S05 (`teaching-page.tsx`, operations route), S12 (the stores + `external-storage-route-service.ts`), S03/S04 (`learning-page.tsx`), S06 (design-only extraction), S11 (characterization tests first).
- **Objective:** reduce the top files below a maintainable size by extracting workflow logic from rendering and splitting stores by concern — behavior-preserving, no public-behavior change.
- **Priority targets:** `teaching-page.tsx` (7,698 → split view vs. workflow/hooks/sections), `teaching-course-management-store.ts` (6,746 → split by aggregate), `api/teaching/operations/route.ts` (4,121 → split by operation family), `learning-page.tsx` (3,601 → playback vs. chatroom vs. companion).
- **Method (mandatory):** (1) S11 adds characterization tests capturing current behavior of the target *before* any move; (2) extract in small, reviewable, behavior-preserving commits; (3) run the full suite after each extraction; (4) no feature change rides along.
- **Acceptance:** each target materially smaller with the same behavior; full suite green after each step; no route/UI behavior change observable in the browser.
- **Checks:** `npm run test`, `npm run lint`, `npm run build`; browser spot-check of `/teaching` and `/learning`.
- **Risk:** highest-regression-risk workstream — gated on characterization coverage and small commits; do not start a target that lacks tests.

### Phase 4 — Real journey tests + staging/production promotion lane (Month 3 · 1–2 weeks)

- **Owning sessions:** S11 (test architecture, E2E), S22 (staging lane, promotion gate), S10 (CI/docs).
- **Objective:** make the five canonical flows real, blocking tests, and unblock production promotion with proper preview→staging evidence.
- **Tasks:**
  - Build browser E2E (or route-level integration if E2E infra is deferred) for: login → first protected redirect; student enrolment / invite join; learner playback + progress event recording; chatroom message + export/share; teacher course create/read/update. Wire these into the CI gate (`.github/workflows/critical-flow.yml`).
  - Trim or park enterprise-evidence/owner-decision/release-gate tests out of the critical path so the gate reflects real user journeys (coordinate with S11; move parked tests behind a non-blocking lane, do not delete history).
  - Stand up the staging lane per `docs/runbooks/staging-preview.md` and `src/lib/release/deployment-lanes.ts`; produce preview + staging evidence for one real release slice so production promotion is no longer blocked.
- **Acceptance:** the five flows block merges on breakage; a staging deployment exists for a release slice with promotion evidence; `test:critical` is free of enterprise-evidence tests.
- **Checks:** `npm run test:critical`, CI run, staging smoke, documented promotion checklist (`docs/runbooks/pre-deploy-checklist.md`).

### Phase 5 — Product depth on a solid foundation (Month 3+ · after Phases 1–4)

Only after data is durable, auth is coherent, and the worst files are split.

- **5a — Adaptive learning (B-18/B-17):** persist deterministic recommendations (`src/lib/adaptive-learning/recommendations.ts`) and learner profiles once the DB lands; surface "next lesson" + rationale in `/learning`. Owners: S15, S12. Keep LLM output out of the system of record.
- **5b — Performance & accessibility baseline (B-19/B-20):** run Lighthouse + axe on the core routes; fix top contrast/label/keyboard and bundle/LCP issues; record against `docs/performance-accessibility-baseline.md`. Owners: S06, S09.
- **5c — Course content & cohort readiness:** deepen the two courses or add real content behind the content pipeline; sign off the privacy baseline (`docs/privacy-baseline.md`) before any real student cohort. Owners: S02/S08/S18/S21, with owner sign-off on privacy.
- **Acceptance:** recommendations persist and render; core routes meet the a11y/perf baseline targets; privacy baseline is owner-approved before a cohort is invited.

---

## 4. Sequencing & dependencies

```
Phase 0 (land bug slice)  ──► clean baseline
        │
        ├─► Phase 1 (durable data) ──────────────► gates Phase 5a (adaptive persistence)
        │        │
        │        └─ needs: reliable migration path (owner decision)
        ├─► Phase 2 (auth)  ── parallel with Phase 1
        │
        └─► Phase 3 (decompose) ── needs Phase 1 entity tests + S11 characterization tests
                 │
                 └─► Phase 4 (journey tests + staging lane) ──► unblocks production promotion
                              │
                              └─► Phase 5 (adaptive / perf-a11y / content)
```

Critical path: **Phase 0 → Phase 1 → Phase 4 → Phase 5a.** Phase 2 runs in parallel; Phase 3 is gated on test coverage from Phases 1 and 4.

---

## 5. Session assignment matrix

| Session | Role | This quarter's package |
| --- | --- | --- |
| S25 | Git hygiene / release intake | Phase 0 slicing; ongoing dirty-root discipline; per-phase intake maps (non-destructive). |
| S12 | Backend / API platform | Phase 1 Postgres adapters; Phase 2 session model; Phase 3 store/route splits; Phase 5a persistence. |
| S08 | Data contract | Phase 1 schema/type alignment and data invariants; migration shape review. |
| S22 | Release engineering | Phase 1 migration reliability + parity; Phase 4 staging lane + promotion evidence. |
| S19 | API env / secrets | Phase 1/2 redacted env + credential placement only (owner-approved). |
| S05 | Teacher workspace | Phase 3 decomposition of `teaching-page.tsx` and operations route. |
| S03/S04 | Learner / chatroom | Phase 3 `learning-page.tsx` split; Phase 4 chatroom E2E. |
| S11 | QA / release quality | Phase 3 characterization tests; Phase 4 journey E2E + gate cleanup. |
| S06 | Design system / CSS | Phase 0 CSS tweak; Phase 3 design-only extraction; Phase 5b a11y/perf. |
| S09 | Copy / i18n / a11y | Phase 5b accessibility labels + bilingual parity for new surfaces. |
| S15 | Adaptive learning | Phase 5a recommendations + profile surfacing. |
| S02/S18/S21 | Course plaza / content QA / pipeline | Phase 5c content depth + cohort readiness. |
| S10 | Tooling / docs / reports | CI gate updates, runbook upkeep, phase reporting, president reports. |

---

## 6. Risks & mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Data loss before Phase 1 lands | High — real users could lose enrolments/grades | Prioritize Phase 1; until then, treat production as demo-only and do not invite a real cohort. |
| Local migrations time out | Blocks Phase 1 cadence | Owner decision on migration path (Vercel-build-only vs. reachable branch DB vs. one-shot job); no public migration endpoint. |
| Decomposition regressions | High — 7.7k-line files are fragile | Characterization tests before any move; small behavior-preserving commits; full suite after each. |
| Dual-write divergence | Medium — split-brain data | Parity tests, single backfill window, env-flagged read switch with JSON fallback. |
| Dirty-root accumulation | Medium — lost/unreviewable work | Feature work on assigned branches/worktrees; `release:clean-check` before root work; per-phase S25 intake. |
| Scope creep into parked modules | Medium — re-inflates the scaffold | Enforce `SCOPE.md`; parked work needs a scoped owner decision + tests before rejoining the gate. |
| Secret exposure | High | Server-only secrets; no `NEXT_PUBLIC_`; redacted inventories; S19-only placement with owner approval. |

---

## 7. Owner decisions needed

1. **Approve Phase 0 commit slices** — authorize S25 to (or the owner to) commit the four reviewed bug-fix/CSS slices, clearing the dirty root.
2. **Migration path for Phase 1** — choose (a) Vercel-build-only migrations, (b) a locally reachable Neon branch/pooler, or (c) an owner-run one-shot migration job.
3. **Entity cutover order & go-ahead** — confirm the proposed order (`users → courses → enrolments → submissions → operations`) and authorize switching reads to Postgres per entity.
4. **Auth: production demo posture** — confirm whether the demo login remains available under explicit opt-in, or is fully disabled in production.
5. **Privacy baseline sign-off** — required before any real student cohort (Phase 5c); approve retention, deletion, provider-processing, and incident-contact choices in `docs/privacy-baseline.md`.
6. **Parked-module posture** — confirm voice-clone / PPT-narration / enterprise-evidence modules stay parked this quarter.

---

## 8. Definition of done for the quarter

- Core entities (users, courses, enrolments, submissions, memberships) persist in Postgres, survive restarts, are consistent across instances, and have a proven rollback.
- One coherent, tested auth model; production demo gated; no plaintext secrets.
- The top files are materially smaller with unchanged behavior and characterization coverage.
- The five canonical journeys are real, blocking CI tests; `test:critical` is free of enterprise-evidence noise.
- A staging lane exists and production promotion is unblocked with preview→staging evidence.
- Adaptive recommendations persist and render; core routes meet the perf/a11y baseline.
- Privacy baseline is owner-approved — the gate before inviting a real cohort.

---

## Checks run for this planning pass

- Not run: documentation/planning-only change (no feature code touched). Findings are grounded in a read-only inspection of the working tree (`git status`, source line counts, `src/lib/db/schema.ts`, the core stores, `SCOPE.md`, `docs/architecture-map.md`, the 8 July advisory, the 2026-07-18 bug report, and the 2026-07-10 S22 production handoff). Baseline gate status (2000 tests / typecheck / lint green) is cited from the 2026-07-18 bug-detection pass, not re-run here.
