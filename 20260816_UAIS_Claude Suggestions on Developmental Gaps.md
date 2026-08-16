# UAIS — Claude Suggestions on Developmental Gaps

- **Date:** 2026-08-16 (audit executed 2026-08-15)
- **Project:** UAIS — University AI System / University Adaptive Interactive System (`/Volumes/Starship/UAIS`, production target `www.uais.top`)
- **Prepared for:** Dr. Peter Hu, Founder / Project Owner
- **Question answered:** *What is still unfinished or malfunctional in UAIS today, and what is the plan to close those gaps before the September 2026 launch (~200 university students, chatroom + lesson learning MVP)?*
- **Method:** read-only multi-agent workflow over the **current dirty working tree** (HEAD `54dacb4` + ~1,600 uncommitted lines): nine parallel subsystem audits (student auth, teacher auth, chatroom, storage, content pipeline, enrolment ops, deployment/env, UX/i18n, quality gates), adversarial verification of the top five blocker claims (4 CONFIRMED, 1 ADJUSTED, 0 refuted — including one **live probe of www.uais.top**), and a completeness pass for non-code launch gates. 15 agents, 568 tool calls. No feature code was changed.
- **Relationship to prior report:** this supersedes the gap portions of `20260811_Unfinished Functions of UAIS.md`. Roughly **half of that report's blockers are now substantially fixed in uncommitted working-tree code** — this report credits those fixes explicitly, then plans the remainder.

---

## ⚠️ Urgent notice (read first)

**A live probe on 2026-08-15 found that `www.uais.top` currently accepts the repo-public demo credentials.** `POST /api/auth/app-session` on the live site reports `productionStatus: "ready"` with `demoProductionAccess.enabled: true`, meaning `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` is set on the production deployment. The Phoebe (teacher) and Peter (student) accounts, whose password `12345` is committed to this repository, therefore authenticate on the public internet **today**. The live build also predates 2026-08-08 (the chatroom API 404s; `/healthz` returns the old shape), so the exposure is bounded to read-only demo surfaces — but the credential exposure is real and internet-wide.

**Action (owner, ~5 minutes): unset `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` in Vercel production now**, and re-enable demo access only on preview lanes if needed. This is Phase 0 item P0.1 below.

---

## 执行摘要 (Chinese Executive Summary)

自 8 月 11 日报告以来，工作树中新增的约 1,600 行未提交代码**实质性地修复了当时六大阻塞项中的一半以上**：真实的学生账号体系已在代码中完整落地（`database-accounts` 提供方、scrypt 密码哈希、按账号锁定的防爆破、200 人 CSV 名单导入脚本）；教师生产环境写权限桥已建成（`database-account-cookie`）；聊天室 @提及门控已实现（普通消息立即入库、零 AI 调用、诚实的 429 提示）；课件发布管道已存在（JSON 课件包 + 发布脚本 + 按课程路由播放）；虚构的"梯度下降"兜底课件已被诚实的空状态取代；数据库连接已池化、课程管理存储已有生产默认值、/healthz 已探测数据库。**代码质量门全绿**（lint、tsc、2401 个测试全部通过）。

但按"9 月开学"标准，仍有四个层面的缺口：

1. **所有修复都未提交、未部署。** 线上 `www.uais.top` 仍是 8 月 8 日之前的构建，且**实测发现演示登录开关在生产环境处于开启状态——仓库中公开的 12345 密码今天就能登录线上站点**（须立即关闭）。修复只存在于脏工作树中，Vercel 无法构建未提交的代码。
2. **认证"最后一公里"未走完。** 五个环境变量未设置、名单未导入、发布链自身的就绪门**只认可不存在的 `trusted-account-provider`**，会对唯一可行的九月配置报"不通过"；没有任何文档提到新认证方案；没有任何密码重置路径。
3. **单行存储架构原样未动（两名对抗验证员独立确认）。** 全部转录仍在一个 Postgres jsonb 行、全部选课数据在另一行；且新的快速路径 + 2.5 秒轮询让这两行承受**更大**压力；写入失败仍对学生静默丢失（客户端从不读服务器返回的落库回执）；开学日 200 人扫码仍会撞出 409 风暴。最新迁移文件 0004 的注释本身就写明拒绝这种模式——"开学日 9 点的自我拒绝服务"。
4. **课堂规模运营与移动端未动。** 逐个审批、无退课/移除、40 个小组全手工、二维码不可扫、多课程操作静默指向第一门课、手机端无导航无退出登录、课程广场两张演示卡现在点进去就是 403。

**建议路径（约 3 周）：** 第 0 阶段（本周末）：关闭线上演示登录开关 → 切片提交 WIP → 部署 → 设置五个环境变量 → 导入名单 → 对线上跑冒烟测试。第 1 阶段（8/17-23）：按房间/按课程拆分存储键 + 客户端读回执 + 重试抖动；教会发布链新认证方案；密码重置脚本。第 2 阶段（8/24-30）：批量审批/移除/自动分组/真二维码包；教师冻结/隐藏消息最小闭环;移动端导航；课件管道补全（幻灯片图片、英文界面品牌、入口链接）。第 3 阶段（8/31-9/6）：LRS 决策、负载测试、双语使用手册、隐私签署、监控与消费上限、试点彩排。详见 §5。

---

## English Executive Summary

Since the 2026-08-11 report, ~1,600 uncommitted lines in the working tree have **substantially fixed more than half of that report's blockers**: a real first-party student account system exists in code (`database-accounts` provider, scrypt hashing, per-account lockout, a 200-student CSV roster importer); the production teacher write bridge is built (`database-account-cookie`); chatroom @mention gating is real (plain messages persist immediately with zero AI calls, honest 429s with rollback); a content publish pipeline exists (validated JSON decks + operator script + per-course playback routing); the fabricated fallback lecture is gone; connections are pooled, course-management has a production default, and `/healthz` probes the database. **All quality gates are green** (lint, tsc, 2,401 tests passing).

Measured against September, four layers of gap remain:

1. **Nothing is committed or deployed.** `www.uais.top` still serves a pre-2026-08-08 build — and a live probe found **demo auth switched ON in production, so the repo-public password `12345` logs into the live site today** (must be unset immediately). Vercel builds from commits; the dirty tree cannot ship as-is.
2. **The auth last mile is unwalked.** Five env values are unset, the roster is unseeded, **the project's own release/readiness/env-sync chain only accepts the nonexistent `trusted-account-provider`** and will false-red the only launch-viable configuration, no document anywhere names the new selectors, and there is no password reset path of any kind.
3. **The single-row storage architecture is untouched** (independently confirmed by two adversarial verifiers). All transcripts still live in one Postgres jsonb row and all course/enrolment data in another; the new fast path + 2.5s poll put **more** load on those rows than the old design did; failed writes are still silently dropped (the client never reads the persistence receipt the server now returns); enrolment day still produces 409 storms. Migration 0004's own comment rejects this exact pattern as "a self-inflicted denial of service at 09:00 on the first day of term."
4. **Classroom-scale operations and mobile are untouched.** One-by-one approval, no reject/remove, ~40 hand-built groups, a non-scanning "QR code", multi-course operations silently targeting the first course, no mobile navigation or sign-out, and plaza cards that now dead-end in 403s.

**Recommended path (~3 weeks):** Phase 0 (this weekend): kill the live demo-auth flag → slice and commit the WIP → deploy → apply the five env values → seed the roster → smoke-test the live site. Phase 1 (Aug 17–23): per-room/per-course storage keys + client receipt handling + retry jitter; teach the release chain the new auth providers; password reset script. Phase 2 (Aug 24–30): bulk approve / remove / auto-group / real QR; minimal teacher freeze-hide; mobile nav; content pipeline completion. Phase 3 (Aug 31–Sep 6): LRS decision, load test, bilingual user guides, privacy sign-off, monitoring and spend caps, pilot rehearsal. See §5.

---

## 1. How to read this report

| Severity | Meaning |
| --- | --- |
| **Blocker** | The September launch is impossible or unsafe until this is resolved. |
| **High** | Launch survives, but the classroom experience visibly breaks or data is at risk. |
| **Medium** | A rough edge real users will notice. |
| **Low** | Polish. |

| Status | Meaning |
| --- | --- |
| `missing` | Does not exist. |
| `mock-only` | Demo/hardcoded data pretending to work. |
| `partial` | Happy path exists; the real-world path does not. |
| `fragile` | Works, but will fall over at classroom scale/conditions. |
| `decision-needed` | Code seams exist; an owner decision blocks completion. |
| `broken` | Exists but does the wrong thing. |

| Delta vs 2026-08-11 | Meaning |
| --- | --- |
| `still-open` | Unchanged since the last report. |
| `partially-addressed` | In-tree work moved it forward; a gap remains. |
| `new` | Introduced by, or first discovered in, the new work. |

Every finding cites `file:line` evidence from the current working tree. The five highest-severity claims were re-verified by adversarial agents instructed to refute them; none were refuted (see Appendix B).

---

## 2. What the uncommitted work already fixed (credit where due)

These 2026-08-11 findings are **resolved in the working tree** — the plan below must *ship* them, not rebuild them:

- **Student accounts exist in code.** `database-accounts` provider wired end-to-end: login route → closed dispatch → `uais_users` + `uais_user_login_identifiers` (`src/app/api/auth/app-session/route.ts:418-419`, `src/lib/server/uais-app-account-store.ts:165-180`, migrations 0004/0005). Real salted scrypt hashing with timing-equalizing burn (`uais-app-password-hash.ts:33-82`). A regression test pins that Phoebe/Peter/`12345` are **rejected** on the new provider (`tests/uais-app-account-auth.test.ts:362-386`).
- **Login brute-force protection exists**: durable per-account (deliberately not IP-keyed — campus NAT safe) 10-failure/15-minute lockout on a keyed table (`migrations/0004`, `uais-app-login-failure-store.ts`).
- **Roster import exists**: `scripts/seed-uais-accounts.mjs` — header-driven CSV, generated initial passwords into a `0600` file, re-run-safe `ON CONFLICT DO NOTHING`.
- **The production teacher write path exists in code**: `UAIS_TEACHER_AUTH_PROVIDER=database-account-cookie` + `resolveVerifiedTeacherAccountAuthBridge` mints the teacher cookie at login for DB-verified `role=teacher` rows; all sixteen teaching write routes accept it (`teacher-auth-provider-contract.ts:209-235`, `local-teacher-auth-bridge.ts:169-219`). The local bridge still refuses deployed runtimes — safety not softened.
- **@mention gating is real**: a no-mention message persists on a fast path with **zero provider calls** (`route.ts:623-657`), verified by a test that fails if the provider factory is ever constructed (`tests/learning-chatroom-mention-gating.test.ts:177-230`). The 6/min spend throttle now applies only to agent-triggering messages; plain chat gets an honest 429 with Retry-After and optimistic-bubble rollback in both locales.
- **Playback routes by course**: `/learning` fetches the arrival `courseId` (demo only as bare-URL fallback), authorized per-course by membership; the student dashboard emits real `/learning?courseId=…&classId=…` links.
- **A content publish pipeline exists**: validated JSON decks in `data/learning-ppt-playback/` override the compiled-in demo by courseId (`published-playback-store.ts`, `ppt-playback-catalog.ts:312-330`), with a `--check`-capable operator script and script-to-runtime round-trip tests.
- **The fabricated gradient-descent lecture is gone** — honest bilingual empty states replace the fake lecture, fake subtitles, and fake chapter rail (`learning-page-slides.tsx:295-315`).
- **Storage plumbing improved**: module-scoped pooled Neon client (max 2, `prepare:false` for `-pooler`, idle/lifetime timeouts) replaces connection-per-operation (`core-database.ts:105-159`); one unified backend selector auto-defaults course management + transcripts + shares to Postgres in production with a core DB (`uais-durable-snapshot-backend.ts:35-49`) — the false-green 503 trap is closed.
- **Ops fixes in code**: `/healthz` probes the DB with 503 semantics (`healthz/route.ts:51-98`); client Sentry init uses statically-inlined `NEXT_PUBLIC_*` reads; the ai-guide route has an enforce-by-default per-actor rate limiter; `vercel-build` migrations are deploy-safe (skip without URL, refuse preview→production); `outputFileTracingIncludes` covers narration audio and deck JSONs.
- **Demo seed transcript** no longer renders to real-course students on failure (gated on `isDemo`); retention windows are now a recorded owner decision (group 500 / solo 200).
- **Quality gates are green on the dirty tree**: `npm run lint` clean, `npx tsc --noEmit` clean, `npm run test` = **2,401 passed** across 182 files (up from 2,298), 5 skipped.

The problem is no longer that the foundations were never built. It is that **the finished foundations are stranded in an uncommitted tree, behind unset env values, under a release-gate chain that rejects them — while the storage shape and the classroom-operations layer remain exactly as fragile as in August.**

---

## 3. The remaining gaps (ranked)

### 3.1 BLOCKER — Nothing is deployed, and the live site runs demo auth

**Status: `fragile` · Verified: CONFIRMED + live probe · Effort: S–M (process, not code)**

- Every fix in §2 is uncommitted work on HEAD `54dacb4`; migrations 0004/0005, `data/`, and all six new server modules are **untracked**. Vercel builds from commits — none of this can deploy as-is.
- Live probes (2026-08-15): the chatroom API still 404s on `www.uais.top`; `/healthz` returns the old no-DB-probe shape; `POST /api/teaching/courses` → 401. The deployed build predates 2026-08-08.
- **`UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` is set on production** — `demoProductionAccess.enabled:true` live — so the two repo-public demo credentials authenticate on the internet today (see Urgent notice).
- No deployed-lane smoke has ever run; the staleness went unnoticed for a month precisely because nothing probes the live site (`core-journey-smoke.mjs` fully supports `--base-url` but has never been pointed at production).

**Fix (Phase 0):** unset the demo flag now; S25-slice and commit the WIP; deploy; run the journey smoke against `www.uais.top` with a seeded test account; archive the output as release evidence; point an uptime monitor at `/healthz`.

### 3.2 BLOCKER — The auth last mile: env unset, roster unseeded, runbook nonexistent

**Status: `decision-needed` · Verified: CONFIRMED (2 verifiers) · Effort: S once decided**

- An unset `UAIS_APP_AUTH_PROVIDER` normalizes to `local-demo` (`uais-app-auth-provider.ts:219-221`), which is blocked in production → every login 503s before reading credentials (`app-session/route.ts:84-93`). Nothing auto-selects `database-accounts`; once selected but unseeded, logins become uniform 401s — still total failure.
- Required set for September: `UAIS_APP_AUTH_PROVIDER=database-accounts`, `UAIS_APP_SESSION_SIGNING_SECRET`, `UAIS_TEACHER_AUTH_PROVIDER=database-account-cookie`, `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET` (≥32 chars), `UAIS_CORE_DATABASE_URL` (pooled `-pooler` endpoint) — plus the approved `DEEPSEEK_API_KEY`/`DASHSCOPE_API_KEY` and the LangGraph backend for the ask-box.
- **Zero documentation names any of this.** Repo-wide grep finds no `database-accounts` mention in any `.md`; `docs/auth-contract.md:77` is actively stale (still documents the trusted-provider story); the seed script's own header admits *"the database-accounts auth provider has an empty table and nobody can sign in — which is the state the deployment is in today."*
- Migrations 0004/0005 auto-apply on deploy **only if** `UAIS_CORE_DATABASE_URL` is in the Vercel *build* env — see §3.4's skip-trap.

**Fix (Phase 0):** owner applies the env set in Vercel; runs `seed-uais-accounts.mjs` with the real roster **including one `role=teacher` row** (not `admin` — an admin row gets no write bridge and 401s on every teaching write); a short bilingual runbook lands in `docs/` naming the selectors, the seed command, and credential-slip handling.

### 3.3 BLOCKER — Single-row snapshot storage is untouched, and the new code loads it harder

**Status: `fragile` · Verified: CONFIRMED by two independent verifiers · Effort: ~1 week**

- `snapshotKey = "default"` in **all four** stores: transcripts (`learning-chatroom-transcript-postgres-store.ts:45`), shares (`:45`), course management (`:16`), teaching operations (`:14`). Every write re-reads and rewrites the entire deployment's blob under `FOR UPDATE` with a sha256 revision over the whole corpus — so appends to *different rooms* conflict with each other.
- **Pressure increased since August:** the mention-gating fast path persists *every* human message immediately (each chat line = whole-corpus rewrite), and the poll halved to 2.5s; each GET does **two** whole-blob reads (course-management snapshot for authorization + full transcript corpus). 200 online students ≈ ~80 GET/s ≈ 160 whole-blob SELECTs/s.
- **Silent message loss persists**: append retries are 2 (solo) / 4 (group) with no jitter; exhaustion throws 409 which the runtime swallows into `{status:"unavailable"}` while the API returns 200. The route now *returns* that receipt — **but the client never reads `body.transcript`** (`use-learning-chatroom.ts:1084-1091`), so the sender keeps their bubble, classmates never see the message, and drops correlate with the busiest classroom moments.
- Enrolment-day joins/approvals still race one global revision with exactly **one** retry (`teaching-course-management-store.ts:207,270,…`) → raw `409 "snapshot changed; retry required"` to students.
- The tree's own newest migration rejects this pattern in writing: `migrations/0004_app_account_login.sql:8-12` refuses "the single-row jsonb snapshot pattern the chatroom and course-management stores use" because it "would serialise every … attempt in the cohort through one FOR UPDATE lock, which is a self-inflicted denial of service at 09:00 on the first day of term." **The transcripts, shares, course management, and operations stores still use it.**
- Still no backup/restore path: every write is a whole-snapshot REPLACE; one bad write destroys all cohort data; Neon PITR is unverified and no restore runbook exists.

**Fix (Phase 1):** re-key transcripts **per room** and course management **per course** (the stores already compute per-room/per-course identifiers; shares can stay global); client reads the transcript receipt and shows a failed-bubble retry (re-POST is idempotent by messageId); raise join/approve attempts to ~5 with decorrelated jitter; verify/enable Neon PITR + write the one-page restore runbook.

### 3.4 BLOCKER — The release-gate chain rejects the only launch-viable configuration

**Status: `broken` · Effort: ~2–3 days**

- `production-e2e-release-gate.mjs:252` accepts only `trusted-account-provider` (a service that **does not exist anywhere**); `app-auth-provider-readiness.mjs:435-444` normalizes `database-accounts` to "unsupported"; `vercel-env-sync.mjs:711-713` won't plan the correct values; `teacher-auth-provider-readiness.mjs` and `ai-route-smoke.mjs:1897-1899` know only `trusted-cookie-issuer`/`oidc-jwks` and refuse `database-account-cookie`; `local-production-e2e-smoke.mjs:29-39` demands an issuer secret the September config doesn't use.
- `env-surface.ts` compounds it: still marks the trusted-provider `_URL`/`_TOKEN` as **required** (the database provider needs neither), still **quarantines** the two now-required teacher-auth vars (`:487-494`), omits `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` entirely, and never names `database-accounts`. The teaching-operations selector `UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND` is cataloged nowhere at all.
- Consequence: applying the correct September configuration makes the project's own gates report **blocked**, steering the operator toward a provider that doesn't exist — the same false-green/false-red pattern that let the August staleness go unnoticed. Either the gates get hand-bypassed (losing their safety) or launch stalls on false negatives.
- Related tripwire never built: **no gate fails when `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` is set** on a production target — the exact flag that is live right now (§3.1).

**Fix (Phase 1):** teach `database-accounts` / `database-account-cookie` to the readiness, e2e-gate, env-sync, and smoke scripts (readiness = core DB + sufficient secrets); re-tier the env catalog (URL/TOKEN conditional on trusted selector; promote the teacher-auth vars; catalog the demo flag and the operations selector); add a hard gate failure whenever the demo flag is set in production.

### 3.5 HIGH — Account lifecycle gaps: no password reset, no session revocation, weak-secret floor

**Status: `missing`/`partial` · Effort: ~3–4 days**

- **No password reset or change path of any kind** — no route, no script, no UI affordance; the seed script deliberately cannot update passwords. A student who loses the printed slip is locked out until an engineer hand-writes SQL with a hand-computed scrypt hash against production. The teacher account has the same exposure.
- **No session revocation**: stateless 8h HMAC cookies; disabling an account blocks new logins only — a leaked teacher cookie keeps full write authority for up to 8 hours with no kill switch.
- The app-session signing secret has **no strength floor** in production (unlike the teacher secret's 32-char check), and an unset secret still silently *weakens* the proxy gate instead of failing loudly (`proxy.ts:46-52`).
- Small but real: `seed-uais-accounts.mjs` advertises `--env-file` in its help but never implements it (risk: seeding the wrong database); mixed-case hand-created `uais_users.account` rows can never sign in (lookup lowercases input but compares exactly).

**Fix (Phase 1):** a `reset-uais-account-password.mjs` operator script reusing the seed script's hashing (minimum bar); enforce a ≥32-char app-session secret in deployed runtimes; shorten the teacher cookie TTL and document secret rotation as the emergency revocation procedure; implement or delete `--env-file`; document the lowercase-account invariant.

### 3.6 HIGH — Enrolment and group operations still do not scale to 200 students

**Status: `partial`/`missing`/`broken` · none of the handler/workspace files changed since 08-11 · Effort: ~1 week**

All verbatim still open, now one env decision away from being *live* problems:

- **Approval is strictly one-by-one** — ~200 clicks, each a whole-snapshot rewrite racing incoming joins.
- **No reject/remove/withdraw membership exists** — wrong-class joins are permanent (re-join 409s), dropped students unremovable all semester.
- **Group formation for ~40 groups is fully manual** over a flat 200-checkbox list; cross-group double-assignment is unchecked server-side (one student can be in two chatrooms); "Generate group suggestions" still returns a success receipt containing **no suggestions** (self-declared "Not wired yet"); a solo remainder student is ungroupable (min size 2).
- **The invite "QR code" still does not scan** (hand-drawn decorative pattern, no QR library in `package.json`), and the projected dialog directs students to a code-entry box **that does not exist anywhere in the UI** — the only working entry is the `/courses?invite=` URL.
- **`selectedCourseAction` still has no setter** (`use-teaching-workspace.tsx:167-170`) — inline teacher operations *including invite-code generation* silently target the first listed course, which is a compiled-in demo course. Invite codes minted there attach students to the wrong course.
- **Invite codes are sequential from `55395057`, immortal, capacity-free, undisable-able**, behind an unratelimited join route — any logged-in student can enumerate neighboring codes; the workspace displays fabricated "Valid until 2026-12-17 / Join limit 60" claims enforced nowhere.
- Unauthenticated invite-link landing still dead-ends (no login handoff, no manual code entry); ungrouped students still get a silent solo room before the teacher finishes grouping; roster "sync" still persists a receipt claiming `sis-provider-synced` while importing nothing.

**Fix (Phase 2, package P2.1):** bulk-approve endpoint + "Approve all N pending"; membership DELETE/status-patch with a Reject button and re-join-after-removal; server-side cross-group duplicate rejection + already-grouped badges + one-click "auto-split remaining N into groups of K"; real QR encoding of the join URL (small self-contained client library); wire the course selector (disable inline ops until a course is explicitly chosen); random codes with expiry/disable + join rate limit; login handoff with `returnTo` + manual code entry on the plaza; honest roster-recount copy.

### 3.7 HIGH — Chatroom: moderation absent, drops invisible, share links immortal

**Status: `missing`/`fragile` · Effort: ~4–5 days**

- **Zero teacher moderation**: no message-hide, no room-freeze, no flag. A prompt-injected or abusive message replays to every member's poll, the export PDF, and the live public share page; the only lever is revoking share links. (The completeness pass adds: there is **no prompt-injection defense at all** — student text goes verbatim into billed DeepSeek/Qwen prompts and agent output returns unmoderated.)
- **Share links still never expire and expose the live room** — one paste into a public QQ/WeChat group exposes all future messages + member names for the semester. (Live-view semantics is now a recorded decision; the missing TTL is not.)
- The silent-drop receipt gap (§3.3) and: an @mention message is still invisible to the room and locks the sender's composer until the 45s agent round settles; the "agents thinking" bubble shows even for plain messages that invoke no agent; a 429 rollback discards the student's typed text; window-trim eviction is undisclosed in room, export, and share.
- All chatroom rate limits remain **per-serverless-instance** (real ceiling = limit × instances, resets on cold start); no global spend cap exists anywhere, and no evidence documents provider-console caps.

**Fix (Phase 2, package P2.2):** minimal teacher-only freeze-room + hide-message endpoint filtered from replay/export/share; `expiresAt` on share mints; pre-persist student rows before the agent round; `agentsPending` only when a mention exists; restore draft text on 429; trim notice; an injection-hardening system-prompt preamble; **set provider-console spend caps this week** (no code) and record redacted evidence.

### 3.8 HIGH — Mobile and day-1 UX: still no nav, no sign-out, broken dark theme, dishonest surfaces

**Status: `missing`/`partial` · every 08-11 mobile/theme finding untouched · Effort: ~1 week cumulative**

- **No navigation menu and no sign-out below 768px** (`header.tsx:189-192,253`) — on the primary campus device students cannot sign out (shared-device session leakage) and teachers cannot reach `/teaching` at all.
- **Chatroom mobile**: roster still stacks above the thread at 375px (composer below the fold), and every poll delivery force-scrolls the thread to bottom — now up to **every 2.5s** instead of 5s.
- **Course plaza**: still two hardcoded demo courses with fabricated progress — and with per-course playback wired, both "Enter Learning" buttons now dead-end in access-denied/empty states. Real courses never appear.
- **en-US dashboard still greets every student as "Peter"** (`student-dashboard-page.tsx:197`) with static demo metrics in both locales; the dashboard's primary "continue learning" CTA routes to the demo course and 403s — the only working path (the membership card) is unexplained lower on the page.
- **Dark theme still broken** on the header and all of `/learning` (44 hardcoded light hex classes, zero `dark:` variants) while every neighboring surface is theme-aware — the toggle sits in the header inviting the breakage.
- Session expiry is still a dead end: **no auth-failure surface anywhere links to `/login`**; the "No published lesson yet" empty state renders under 401/403/500 too, blaming the teacher for an auth failure.
- i18n honesty: en-US still labels the code-assistant "Teaching TA" with a divergent prompt; the en-US slide frame hardcodes "Elementary Mathematics Research / Dr. Kang Xia" onto **every** published deck and never shows the real slide image; the outline tab fabricates the demo syllabus + 42% progress for any course; error labels say "mathematics PPT" for every course; raw English server strings surface inside Chinese sentences on login/join failures; dead controls remain (subtitle search, Course materials, Calendar, Bell).

**Fix (Phase 2, packages P2.3/P2.4/P2.5):** mobile drawer nav + sign-out; thread-first mobile order + scroll-position guard; `/login?from=` links on every auth-failure surface; dark theme — fix tokens or force-light those routes for September; plaza fed from real memberships; dashboard greeting from session displayName + CTA to first approved membership; en-US frame uses `publishedPlayback.courseTitle/teacherName` + real slide images; agent label/prompt alignment; reason-code → localized copy mapping; remove or disable dead controls.

### 3.9 HIGH — Content pipeline: publishable, but a documented publish ships an image-less, misbranded lesson

**Status: `partial` · Effort: ~3–4 days**

- The publish script handles deck JSON + narration WAVs but **not slide images** (`page-NN.jpg` expected under `public/learning/ppt-playback/slides/…` — no `--slides-dir`, no warning, README silent) → following the docs exactly ships every slide as a grey "课件图片准备中" placeholder while narration plays. `durationSeconds` must be hand-typed even though the WAVs are in hand.
- The script skips the localized-copy validation the runtime enforces → a deck with malformed en-US copy publishes cleanly then **silently vanishes at runtime** (students see "no published lesson yet", the reason only in server logs). Cross-deck `audioManifestId` collisions are unchecked.
- The unsafe-text filter rejects any narration containing the word "token" or "secret" — a CS lecture cannot be published.
- The deployment smoke for playback is unauthenticated and pinned to the demo deck — it **cannot** verify the audio-tracing fix or the real September deck on any auth-enforcing deployment.
- `data/` must ship in the commit (not gitignored — correct), but today the entire pipeline is uncommitted; and **no real September deck has been published yet** — `data/learning-ppt-playback/` contains only a README. The end-to-end operator path has never been rehearsed.

**Fix (Phase 2, package P2.4):** `--slides-dir` copy + presence warnings; derive durations from WAV headers; run the runtime's localized normalization inside the script + collision warnings; narrow the unsafe-text regex to key-value shapes; teach the smoke script a session cookie + course override and run it once against a preview deploy; **publish the real Week-1 lecture as the rehearsal**.

### 3.10 HIGH — Learning records: a semester of progress silently evaporates

**Status: `partial` · unchanged since 08-11 · Effort: decision + ~2–3 days**

- All four `UAIS_LRS_*` vars are optional and undecided; unconfigured, the recorder **drops** events (blocked ≠ queued), and the browser reporter permanently dedupes the 424 so events are never retried. Slide completion lives only in per-device `localStorage` (phone + laptop never completes); no UI reads real progress back; the analytics/learner-profile/adaptive chain has neither data source nor consumer.

**Fix (Phase 3):** owner decides the LRS provider (or explicitly records "no LRS for this cohort — participation evidence via transcript export only"); if LRS: gate the deploy on its presence and run the existing live write-read smoke; move completion aggregation server-side when time allows.

### 3.11 HIGH — Launch gates that are not code

From the completeness pass (§4 of the 08-11 report — all still open, none tracked by any current workstream):

1. **Privacy-baseline sign-off** (`docs/privacy-baseline.md:73-74` — *"No production cohort may start until the owner or institution records the approved retention schedule"*): several Production Stop Conditions are true today, every Open Decision is still open, and `/privacy` promises access/correction/deletion/export rights nothing implements. By the repo's own contract, the cohort cannot start.
2. **Chinese regulatory posture**: zero repo references to ICP/备案/等保/实名; **there is no footer component at all**, so an ICP number could not even be displayed; PIPL cross-border (US-hosted Neon/Vercel) deferred to "the institution" with no confirmation artifact; mainland campus reachability of Vercel never tested.
3. **No teacher day-1 guide, no student quick-start, no reachable support channel** — all four runbooks are engineer-facing; error states name roles, not channels.
4. **Zero load-test harness** — the storage collapse (and its fix) cannot be sized or verified before enrolment day; no k6/artillery/autocannon anywhere.
5. **Assessment/attendance posture unrecorded** for a credit-bearing course.
6. Smaller: transcript PDF has no glyph fallback beyond GB2312 (emoji/rare name hanzi = tofu or 500 — untested); no `robots.txt`/noindex anywhere, so leaked share URLs (student names + full transcripts) are search-indexable; root-level secret-like artifacts (`All API Keys.docx`, 86MB `OpenMAIC-main.zip`) sit one `.gitignore` line away from a bad `git add .` in a 25-session shared checkout.

### 3.12 MEDIUM — Notable engineering debt (summary; full inventory in Appendix A)

- **Migration-skip blind spot**: the new `--deploy` skip mode's own comment claims `/healthz` surfaces a skipped migration, but `/healthz` only runs `SELECT 1` — a build env missing the DB URL ships a green deploy whose login 500s for the whole cohort against missing tables. Add a migration-currency check to `/healthz`.
- **Teaching-operations cutover half-finished**: its selector is cataloged nowhere, has no production default, and its Postgres writes pass **no `expectedRevision`** — concurrent teacher operations are last-writer-wins.
- **Default test gate runs zero real-Postgres assertions**: all three integration suites `skipIf(!databaseUrl)` — the September-critical durable-store paths ship untested by the gate everyone runs. Add a DB-backed test lane.
- Relational schema beyond the login tables still has zero runtime consumers (memberships remain in the blob); readiness hardcodes `["0001_core_poc"]` while the runner applies 0001–0005; pooled-client path untested and the `-pooler` endpoint unenforced; export "download" still returns its own manifest with a redaction check hardcoded to pass; teacher-operations metrics are hardcoded demo numbers; two chatroom files hover at the 1,500-line lint cap.

---

## 4. Verification record

| # | Claim | Verdict |
| --- | --- | --- |
| 1 | Production login still defaults to 503; nothing selects `database-accounts`; no runbook exists | **CONFIRMED** (refinements: migrations auto-apply on deploy if build env has the URL; post-seed failure mode is 401 not 503) |
| 2 | Teacher write path is code-complete but ungated: env undecided, work uncommitted, deployment stale | **ADJUSTED** — core blocker holds; live probe found login is *not* 503 today because **demo auth is enabled on production**, adding an internet-wide credential exposure the original claim missed |
| 3 | All rooms' transcripts serialize through one global snapshot row; fast path writes it on every chat line | **CONFIRMED** (verifier notes the claim *understates* — each GET does two whole-blob reads; 200 solo rooms share the same lock) |
| 4 | All transcripts/shares/course data still in one global row each; drops silent; client ignores receipt | **CONFIRMED** (blob plateaus at window caps rather than unbounded; drops self-heal only if the same sender posts again) |
| 5 | Production enrolment journey still 503s until the auth decision is executed; unblocking mechanism exists in-tree | **CONFIRMED** |

No claim was refuted. 0/5 refutation rate across two independent storage verifiers and one live-site probe.

---

## 5. The plan (sequenced, ~3 weeks to term)

Working back from a ~September 1–7 start. Owner-decision items are marked **[OWNER]**; suggested session assignments follow the AGENTS.md model.

### Phase 0 — Ship what exists and contain the exposure (now → Aug 17)

| # | Work package | Owner / session | Effort |
| --- | --- | --- | --- |
| P0.1 | **[OWNER] Unset `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` on Vercel production immediately.** Re-enable on preview lanes only if needed. | Owner | 5 min |
| P0.2 | Release intake: `npm run release:dirty-map`, slice the ~1,600-line WIP into reviewed commits per owner pathspecs (suggested slices: auth/accounts, storage plumbing, chatroom gating, content pipeline, ops/env, tests). No `git add .`. | S25 (inventory) + owner-assigned committer | 0.5–1 d |
| P0.3 | **[OWNER] Decide and apply the production env set**: `UAIS_APP_AUTH_PROVIDER=database-accounts`, `UAIS_APP_SESSION_SIGNING_SECRET` (≥32), `UAIS_TEACHER_AUTH_PROVIDER=database-account-cookie`, `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET` (≥32), `UAIS_CORE_DATABASE_URL` (**pooler endpoint, in both build and runtime env** — the migration-skip trap), `UAIS_LANGGRAPH_PERSISTENCE_BACKEND`, approved `DEEPSEEK_API_KEY`/`DASHSCOPE_API_KEY`, `UAIS_LEARNING_CHATROOM_GROUPS_MODE=on`, Sentry DSNs. **Set spend caps in the DeepSeek/DashScope consoles the same day.** | Owner + S19 | 0.5 d |
| P0.4 | Deploy current main; verify migrations 0001–0005 applied; run `seed-uais-accounts.mjs` with the real roster (**teacher row = `role=teacher`, not admin**); run `core-journey-smoke.mjs --base-url https://www.uais.top` with a seeded test account; archive evidence; point an uptime monitor at `/healthz`. | S22 | 0.5 d |
| P0.5 | Write the bilingual auth/deploy runbook (`docs/`): the five selectors, seed command, credential-slip handling, rollback pointer. Update `docs/auth-contract.md`. | S10/S19 | 0.5 d |

**Exit criteria:** a student test account logs in on `www.uais.top`; the teacher test account creates a course on production; demo credentials are rejected; smoke evidence archived.

### Phase 1 — Foundations under load (Aug 17–23)

| # | Work package | Session | Effort |
| --- | --- | --- | --- |
| P1.1 | **Storage re-keying**: transcript snapshots per room, course-management per course (shares stay global); migration + `WHERE snapshot_key=` in both Postgres stores; fold teaching-operations into the unified selector and thread `expectedRevision` through its writes. | S12 | 3–4 d |
| P1.2 | **Honest persistence**: client reads the POST transcript receipt → failed-bubble + tap-to-retry; pre-persist student rows before the agent round; join/approve retries to ~5 with decorrelated jitter; friendly copy for terminal 409s. | S12 + S04 | 2 d |
| P1.3 | **Release chain learns the real providers**: accept `database-accounts`/`database-account-cookie` across readiness, e2e-gate, env-sync, and smoke scripts; re-tier `env-surface.ts` (conditional URL/TOKEN, un-quarantine teacher-auth vars, catalog the demo flag + operations selector); **hard gate failure when the demo flag is set in production**; `/healthz` migration-currency check. | S22 | 2–3 d |
| P1.4 | **Account lifecycle minimum**: password-reset operator script; ≥32-char app-session secret floor in deployed runtimes; shorter teacher-cookie TTL + rotation runbook; fix or delete `--env-file`. | S12 | 1–2 d |
| P1.5 | **DB-backed test lane**: provide a database URL (Neon branch or throwaway Postgres) so the three Postgres integration suites run in the release gate; loudly enumerate skipped launch-critical suites otherwise. | S11 | 1 d |

**Exit criteria:** two rooms append concurrently without cross-conflict in the integration lane; a forced append failure shows a retry state in the UI; the September env configuration passes every project gate; a password reset works end-to-end.

### Phase 2 — Classroom operability (Aug 24–30)

| # | Work package | Session | Effort |
| --- | --- | --- | --- |
| P2.1 | **Enrolment at scale**: bulk approve; reject/remove membership + re-join; auto-split grouping + cross-group duplicate rejection + grouped badges; real QR of the join URL; wire `selectedCourseAction` (explicit course selection required); random/expiring/disableable invite codes + join rate limit; login handoff with `returnTo` + manual code entry; extend the no-group notice to the ungrouped-everyone case; honest roster-recount copy. | S13 + S05 (server: S12 coord) | 4–5 d |
| P2.2 | **Chatroom safety minimum**: teacher freeze-room + hide-message (filtered from replay/export/share); share-link `expiresAt`; injection-hardening preamble on agent prompts; `agentsPending` only on real mentions; 429 draft restore; trim-notice. | S04 | 3 d |
| P2.3 | **Mobile + auth UX**: drawer nav with sign-out; chatroom thread-first mobile order + scroll-position guard; `/login?from=` on every auth-failure surface (incl. the empty-state/pill contradiction); dark theme — fix header+`/learning` tokens or force-light + hide toggle there for September. | S01 + S06 | 3–4 d |
| P2.4 | **Content pipeline completion**: `--slides-dir` + WAV-derived durations + script-side localized validation + collision warnings; narrow the unsafe-text regex; en-US slide frame uses real course/teacher/images; dashboard CTA → first approved membership; plaza fed from real memberships (demo cards demoted); course-neutral error labels; authenticated smoke with course override run against a preview deploy; **publish the real Week-1 deck as the rehearsal**. | S03 + S24 | 3–4 d |
| P2.5 | **Copy/i18n sweep**: "Teaching TA"→Code Assistant alignment; reason-code→localized error mapping (login, invite join); localized aria-labels; email-aware login placeholder + support-channel line; consent wording ("By signing in you agree…") or a real checkbox. | S09 | 1–2 d |

**Exit criteria:** a rehearsed dry run — teacher creates course → issues QR invite → 20 test joins → bulk approve → auto-group → group chat with an @mention and a hidden message → real Week-1 lesson plays with images — all on a preview/production lane, on a phone.

### Phase 3 — Assurance and launch gates (Aug 31 – Sep 6)

| # | Work package | Session | Effort |
| --- | --- | --- | --- |
| P3.1 | **[OWNER] LRS decision**: provider + retention, or a recorded "no LRS this cohort" acceptance; if LRS — gate deploy on presence, run the live write-read smoke; server-side completion aggregation if time allows. | Owner + S15 | decision + 2 d |
| P3.2 | **Ops assurance**: verify/enable Neon PITR + restore runbook; confirm Sentry events arrive from a deployed lane; uptime monitor evidence; per-deploy smoke as a standing gate. | S22 | 2 d |
| P3.3 | **Load test as a release gate**: (a) 200 concurrent invite joins; (b) 40 rooms × 5 users posting with 2.5s polls for 10 min; (c) sustained ai-guide traffic — against staging with the re-keyed stores. | S11 | 2 d |
| P3.4 | **People-facing launch kit**: bilingual teacher day-1 guide + student quick-start; one monitored support channel named in error states; privacy-baseline sign-off recorded **[OWNER + institution]**; ICP/PIPL/AIGC confirmation with the university **[OWNER]** (+ a footer component able to display an ICP number); one-paragraph assessment/attendance decision **[OWNER]**; `robots.txt` + noindex on share pages. | S10 + S16 + owner | 3 d |
| P3.5 | **Dress rehearsal**: pilot group (5–10 real students) end-to-end on production infrastructure — login → join → group → lesson → chatroom → export. Fix what it finds. **Freeze scope.** | All assigned | 2 d |

**Explicitly deferred (unchanged from 08-11):** teacher AI-agent configuration and rich teaching activities (Nov 2027); voice-clone/PPT-narration authoring; LMS/LTI; adaptive recommendations surfacing; video lectures; SSE delivery (poll is acceptable once storage is per-room); full relational cutover beyond memberships; global shared-storage rate limiter (console spend caps suffice for September).

---

## 6. Owner decisions needed (consolidated)

1. **Kill the live demo-auth flag** on `www.uais.top` — today (§3.1, P0.1).
2. **Adopt `database-accounts` + `database-account-cookie`** as the September auth posture and apply the env set (P0.3). The code is built; this is now purely an operational decision.
3. **Approve AI provider keys + console spend caps** (DeepSeek/DashScope) for production (P0.3).
4. **Storage re-keying green light** (P1.1) — a schema-shape change during launch prep; the alternative (ship the single row) is rejected by the repo's own migration commentary.
5. **Dark theme for September**: fix `/learning` + header tokens, or ship those routes documented light-only (P2.3).
6. **Semester export**: build the real payload or remove the export cards so the UI stops advertising it (§3.12).
7. **LRS provider or recorded acceptance of no learning records** (P3.1).
8. **Privacy-baseline sign-off** with the institution — the repo forbids the cohort without it (P3.4).
9. **Regulatory posture**: foreign hosting acceptable vs mainland deployment; ICP; PIPL cross-border; AIGC labeling adequacy (P3.4).
10. **Assessment/attendance**: one recorded paragraph (P3.4).

---

## Appendix A — Full finding inventory (56 open findings)

Sorted by severity within each area. Evidence for every row is in §3 or the audit transcript.

### A. Student accounts, login, sessions

| Severity | Status | Delta | Finding | Effort |
| --- | --- | --- | --- | --- |
| blocker | decision-needed | partially-addressed | Production login still defaults to 503; nothing selects `database-accounts`; no runbook exists | S |
| high | broken | new | Entire release/readiness/env-sync chain rejects the only launch-viable auth provider | M |
| high | missing | still-open | No password reset or change path of any kind | S |
| high | partial | still-open | `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` is a live trap with no release-gate tripwire — **and is set on production today** | S |
| medium | missing | still-open | No session revocation: stolen/outdated sessions live the full 8h TTL | M |
| medium | fragile | still-open | App-session secret has no strength floor; unset secret silently weakens the proxy gate | S |
| medium | broken | new | `seed-uais-accounts.mjs` advertises `--env-file` but never implements it | S |
| medium | partial | new | Env-surface catalog contradicts the new auth reality (teacher vars quarantined, trusted vars required) | S |
| low | missing | new | Login-failure table prune documented but not implemented | S |
| low | partial | new | Login copy predates the email cohort; no recovery affordance | S |
| low | fragile | new | Mixed-case `uais_users.account` rows can never sign in | S |

### B. Teacher authentication / production write path

| Severity | Status | Delta | Finding | Effort |
| --- | --- | --- | --- | --- |
| blocker | decision-needed | partially-addressed | Teacher write path code-complete but ungated: env unapplied, work uncommitted, deployment stale | S |
| medium | partial | new | Smoke/readiness tooling refuses `database-account-cookie` (demands issuer secrets it doesn't need) | S |
| medium | missing | new | New auth story exists nowhere outside code comments | S |
| medium | partial | still-open | Suspending an account does not revoke its live teacher cookie (≤8h exposure) | M |
| low | decision-needed | new | `role=admin` gets no teacher write authority — owner seeded as admin would 401 on every write | S |
| low | partial | new | No test drives the database-account teacher cookie through a real teaching write route | S |

### C. Chatroom at classroom scale

| Severity | Status | Delta | Finding | Effort |
| --- | --- | --- | --- | --- |
| blocker | fragile | still-open | All transcripts in one global snapshot row; fast path now writes it on every chat line | M |
| high | missing | still-open | No teacher hide/freeze/moderation controls — zero progress | M |
| high | fragile | still-open | Persist-failed message silently shown to its sender as delivered (client ignores receipt) | S |
| medium | partial | partially-addressed | @mention messages invisible to the room and composer locked until the 45s round settles | S |
| medium | partial | partially-addressed | Poll-only delivery; 2.5s poll consumes 80% of the per-actor GET budget (two devices → 429 storms) | S |
| medium | decision-needed | still-open | All rate limits per-serverless-instance; no global spend ceiling | M |
| medium | partial | still-open | Share links never expire and expose the live room | S |
| low | partial | new | 429 rollback discards the student's typed text | S |
| low | partial | partially-addressed | Rolling-window eviction undisclosed in room, export, and share | S |
| low | fragile | new | "Agents thinking" bubble shows for mention-free messages that invoke no agent | S |

### D. Data durability and storage

| Severity | Status | Delta | Finding | Effort |
| --- | --- | --- | --- | --- |
| blocker | fragile | still-open | Transcripts/shares/course/ops each in one global jsonb row; new code multiplies the load | M |
| high | fragile | still-open | Lost optimistic races silently drop messages; retries 2/4 with zero jitter | S |
| high | fragile | still-open | Enrolment-day joins/approvals race one global revision with exactly one retry | S |
| high | missing | still-open | No backup/restore path or PITR verification for the core database | S |
| medium | partial | still-open | Teaching-ops cutover half-finished: uncataloged selector, no prod default, **no optimistic concurrency** | M |
| medium | fragile | new | `--deploy` migration skip undetectable: `/healthz` checks connectivity, never schema | S |
| medium | partial | partially-addressed | Relational schema beyond login tables has zero runtime consumers; memberships still in the blob | L |
| low | partial | still-open | Readiness migration inventory hardcodes `["0001_core_poc"]` vs applied 0001–0005 | S |
| low | fragile | new | Pooled-client path untested; `-pooler` endpoint unenforced | S |
| low | fragile | new | File-published catalog not traced into chatroom/ai-guide bundles; empty-cache for process life | S |

### E. Content pipeline and playback

| Severity | Status | Delta | Finding | Effort |
| --- | --- | --- | --- | --- |
| high | partial | partially-addressed | Primary student entry points (dashboard CTA, both plaza cards) route to demo ids that 403 | S |
| high | partial | new | Publish pipeline omits slide images and hand-offloads durations → image-less lessons | M |
| medium | mock-only | new | en-US slide frame hardcodes demo-course branding onto every deck; never shows real slides | S |
| medium | fragile | new | Script skips localized validation the runtime enforces → decks silently vanish at runtime | S |
| medium | fragile | partially-addressed | Audio-tracing fix unverifiable: smoke unauthenticated and pinned to the demo deck | M |
| medium | mock-only | partially-addressed | Outline tab and cockpit still fabricate demo course identity + 42% progress around real playback | M |
| medium | decision-needed | new | Entire pipeline uncommitted; `data/` must ship in the commit; no real deck published yet | S |
| low | partial | new | Error labels hardcode "mathematics PPT"; unsafe-text filter blocks the word "token" | S |

### F. Enrolment, groups, teacher operations

| Severity | Status | Delta | Finding | Effort |
| --- | --- | --- | --- | --- |
| blocker | decision-needed | partially-addressed | Production enrolment journey 503s until the auth decision is executed (mechanism now in-tree) | S |
| high | fragile | partially-addressed | Joins/approvals serialize through one snapshot row, two attempts, raw 409s to students | M |
| high | missing | still-open | Approval strictly one-by-one; no bulk approve anywhere | M |
| high | missing | still-open | No reject/remove/withdraw membership — wrong joins permanent, drops unremovable | M |
| high | partial | still-open | ~40 groups fully manual; suggestions a no-op receipt; cross-group double-assignment unchecked | M |
| high | broken | still-open | Invite "QR" doesn't scan; dialog directs students to a UI that does not exist | S |
| high | fragile | still-open | `selectedCourseAction` never set — inline ops (incl. invite codes) silently target the first/demo course | S |
| medium | fragile | still-open | Invite codes sequential/immortal/capacity-free/undisable-able; join route unratelimited; fabricated validity claims | M |
| medium | partial | still-open | Unauthenticated invite landing dead-ends: no login handoff, no manual code entry | S |
| medium | partial | partially-addressed | Ungrouped student lands in a silent solo room (notice covers only wrong-room cases) | S |
| medium | mock-only | still-open | Roster "sync" persists a receipt claiming SIS provenance; imports nothing | S |
| medium | mock-only | still-open | Semester export downloads its own manifest; redaction validation hardcoded to pass | M |
| medium | mock-only | still-open | Course plaza shows only two hardcoded demo courses | M |
| low | partial | still-open | English store errors interpolate untranslated into Chinese join-failure messages | S |

### G. Deployment, environment, monitoring, cost

| Severity | Status | Delta | Finding | Effort |
| --- | --- | --- | --- | --- |
| blocker | fragile | partially-addressed | Deployment stale; every ops fix uncommitted WIP; no deploy or probe evidence; **demo auth live on production** | M |
| blocker | decision-needed | still-open | Production-required env values undecided with no applied-in-Vercel evidence | M |
| high | fragile | new | Migration-skip has no detection (`/healthz` claims vs `SELECT 1` reality) | S |
| high | missing | still-open | No smoke has ever run against a deployed lane | S |
| medium | partial | new | Env-surface stale vs `database-accounts`; demo-auth flag uncataloged | S |
| medium | missing | still-open | No release gate refuses the demo-auth flag on the cohort deployment | S |
| medium | partial | still-open | No global AI spend ceiling; no provider-console cap evidence | S |
| medium | partial | still-open | Monitoring unevidenced: DSNs optional, observability readiness gates nothing | S |

### H. Student-facing UX, mobile, i18n

| Severity | Status | Delta | Finding | Effort |
| --- | --- | --- | --- | --- |
| high | missing | still-open | No navigation menu and no sign-out on mobile (<768px) | M |
| high | fragile | still-open | Chatroom mobile: roster above thread; poll force-scroll now every 2.5s | M |
| high | mock-only | still-open | Plaza: two demo courses, fabricated progress, Enter buttons now dead-end in 403s | M |
| high | mock-only | still-open | en-US dashboard greets every student as "Peter"; static demo metrics both locales | S |
| medium | partial | still-open | Dark theme broken on header + `/learning` while neighbors are theme-aware | L |
| medium | partial | still-open | Session-expiry/auth-failure surfaces have no `/login` link anywhere | S |
| medium | partial | still-open | en-US "Teaching TA" mislabel with divergent prompt vs zh-CN and server persona | S |
| medium | fragile | new | en-US slide stage misbrands every deck as the demo course (see E) | S |
| medium | mock-only | still-open | Outline tab fabricates demo syllabus/progress; dead controls remain (search, materials, calendar, bell) | M |
| low | fragile | new | "No published lesson yet" heading also renders under 401/403/500, contradicting its own pill | S |
| low | partial | still-open | Raw English server strings under zh-CN on login/join failures | S |
| low | partial | still-open | Chinese-only password-toggle aria-label; consent line asserts agreement never collected | S |

### I. Quality gates and self-declared unfinished work

| Severity | Status | Delta | Finding | Effort |
| --- | --- | --- | --- | --- |
| medium | fragile | new | Default test gate silently skips all real-Postgres integration coverage (3 suites) | S |
| medium | partial | partially-addressed | Teaching-ops Postgres cutover keys on an env var nothing sets or catalogs | S |
| low | mock-only | still-open | Teacher operations pages display hardcoded demo metrics (64 students, 14 groups) | S |
| low | partial | partially-addressed | Duplicated projection verifiers; two chatroom files at ~1,600 lines vs the 1,500 lint cap | M |

### J. Non-code launch gates (completeness pass)

| Severity | Status | Finding |
| --- | --- | --- |
| high | decision-needed | Privacy-baseline sign-off absent; the repo's own stop conditions forbid the cohort; `/privacy` promises rights nothing implements |
| high | decision-needed | Chinese regulatory posture unassessed (ICP/PIPL/MLPS/AIGC); no footer to even display an ICP number; mainland reachability untested |
| high | partial | LRS pipeline silently discards all progress in production; completion per-device localStorage only; analytics/adaptive chain has no data source or consumer |
| medium | missing | No prompt-injection defense on student text entering billed agent prompts |
| medium | missing | No teacher day-1 guide, student quick-start, or reachable support channel |
| medium | missing | Zero load-test harness — the predicted storage collapse and its fix are unverifiable |
| medium | decision-needed | Assessment/attendance/grade-visibility posture unrecorded |
| medium | fragile | Transcript PDF has no glyph coverage beyond GB2312 (emoji/rare hanzi untested) |
| low | missing | No robots.txt/noindex — leaked share pages (names + transcripts) are search-indexable |
| low | fragile | Root-level secret-like artifacts (`All API Keys.docx`, 86MB MAIC archive) one `.gitignore` line from a bad stage in a 25-session shared checkout |

---

## Appendix B — Method and verification detail

- **Tree audited:** `/Volumes/Starship/UAIS` working tree on 2026-08-15 — HEAD `54dacb4` (2026-08-11) plus ~1,633 uncommitted inserted lines across 33 modified files and 18 untracked paths.
- **Agents:** 9 subsystem auditors → 5 adversarial verifiers (instructed to refute; one performed live probes of `www.uais.top`) → 1 completeness critic. 15 agents, 568 tool calls, ~2.0M tokens.
- **Quality gates run during audit:** `npm run lint` ✅ clean · `npx tsc --noEmit` ✅ clean · `npm run test` ✅ 2,401 passed / 5 skipped across 182 files (26.5s). `npm run build` not run (no route/config change was being made by the audit).
- **Checks not run:** none required — documentation-only deliverable; no feature code changed.
- **Live probes (verifier #2, 2026-08-15):** `GET /api/learning/chatroom` → 404 (`_not-found`); `GET /healthz` → pre-dirty-tree shape; `POST /api/auth/app-session` → `productionStatus:"ready"`, `demoProductionAccess.enabled:true`; `POST /api/teaching/courses` → 401. Conclusion: deployed build predates 2026-08-08 and demo auth is enabled.

*Prepared by Claude (multi-agent read-only audit). This report is the deliverable for the owner-set goal of 2026-08-15/16; it supersedes the gap sections of the 2026-08-11 report while preserving its severity/status vocabulary for continuity.*
