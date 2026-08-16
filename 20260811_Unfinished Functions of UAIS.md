# UAIS — Unfinished Functions for Real University Classroom Implementation

- **Date:** 2026-08-11
- **Project:** UAIS — University AI System / University Adaptive Interactive System (`/Volumes/Starship/UAIS`, production target `www.uais.top`)
- **Prepared for:** Dr. Peter Hu, Founder / Project Owner
- **Question answered:** *What are the biggest unfinished functions if UAIS is implemented in the real university classroom context?*
- **Launch context:** functional delivery of the **chatroom** and **lesson learning** to a real cohort of **~200 university students in September 2026**. The teacher workspace for configuring AI agents and rich teaching activities is explicitly **out of scope** (deferred to November 2027) and is not reported as a gap here, except where a missing *minimal* teacher action blocks students.
- **Method:** read-only multi-agent audit of the working tree at HEAD `54dacb4` (2026-08-11): seven parallel subsystem audits (auth/accounts, enrolment, chatroom scale, learning content, data durability, operations/deployment, student UX) producing 77 evidence-cited findings; adversarial verification of the top seven blocker claims (5 confirmed, 2 confirmed-with-corrections, 0 refuted); and a completeness pass for non-code launch gates. One live probe was made against `www.uais.top` (see §3.6). No code was changed.

---

## 执行摘要 (Chinese Executive Summary)

UAIS 的代码库比七月时明显更成熟：聊天室的核心链路是真实的（DeepSeek/Qwen 实时对话、提供商故障切换、Postgres 持久化转录、可撤销分享链接、服务端 CJK PDF 导出），选课审批流程端到端存在，会话 Cookie 安全机制扎实。**但按"2026 年 9 月让 200 名真实大学生上课"的标准衡量，目前最大的未完成功能不在界面，而在根基。**

按严重程度排序，六个"不解决就无法开学"的缺口是：

1. **学生账号体系完全缺失。** 系统只有两个写死在代码里的演示账号（Phoebe/Peter，密码 12345 已随代码公开）；没有注册、没有名单导入、没有密码存储与找回。`uais_users` 数据库表已建好但没有任何代码读写它。生产环境下 200 名学生一个都登录不进来（登录接口按设计返回 503）。
2. **教师在生产环境没有任何写权限。** 唯一能授予教师写权限的登录桥仅限本地运行；生产环境的教师登录后只能只读浏览，建课、审批学生、建小组全部 401。这是待定的架构决策，不是缺陷。
3. **真实课程内容进不了系统。** 全部课程目录是编译进代码包的一套 19 页演示课件；`/learning` 页面写死只播放这套演示课，真实课程的学生会遇到 403 后看到伪造的"梯度下降"课件兜底页。没有任何内容上传/发布管道。
4. **聊天室无法承载真实群聊。** 仅靠 5 秒轮询、消息要等 AI 回合（10–50 秒)结束后才落库、每条不@任何人的消息也会触发一次真实 AI 调用。同学之间无法正常对话，且花的都是真金白银的 API 费用。
5. **存储架构在课堂并发下会崩塌。** 全部转录存在**一行** Postgres jsonb 里，全部课程/选课/小组数据也在**另一行**里；每次写入重写整行、每次轮询新建两条 TLS 连接。开学日 200 人同时扫码加入会大面积 409 报错，学生消息会被静默丢失。
6. **线上部署已过期，环境决策未定。** 实测 `www.uais.top` 上聊天室 API 返回 404——最近一个月的全部 MVP 成果尚未部署；生产必需的环境变量（认证提供方、AI 密钥、存储选择器、小组开关）多项仍是未定的负责人决策，且从未对任何已部署环境跑过冒烟测试。

第二梯队（可开学但课堂体验会明显受损）：选课运营在 200 人规模下不可操作（逐个审批、无法退课/移除、40 个小组全手工组建、邀请"二维码"是装饰图案不可扫描）；学习进度记录不真实（LRS 未配置即静默丢弃、完成度存在浏览器本地、仪表盘显示静态演示数据）；无内容审核与提示注入防护、登录无暴力破解保护、AI 费用无全局上限；手机端（学生主力设备）没有导航菜单无法退出登录。

**代码之外的开学门槛**：仓库自身的隐私基线明确写着"机构未批准保留计划前不得启动真实队列"，该条件今天仍未满足；ICP 备案、PIPL 跨境传输（数据存在美国的 Neon/Vercel）、AIGC 标识等中国监管问题在仓库中零讨论；没有教师/学生使用手册、没有可触达的故障支持渠道、从未做过 200 人并发的压力测试。

**结论：九月开学在技术上仍可达成，但窗口很紧。** 关键路径是：本周做出认证与内容管道两项决策并修复部署链路 → 两周内落地账号体系+教师写权限+按房间拆分存储 → 第三四周打通真实课程内容、解耦聊天与 AI 回合、批量审批与自动分组 → 开学前两周用小规模试点班做一次真实彩排。详见 §5。

---

## English Executive Summary

The codebase is markedly more mature than in July: the chatroom's core loop is real (live DeepSeek/Qwen turns with provider failover, durable Postgres transcripts, revocable share links, server-rendered CJK PDF), the enrolment journey exists end-to-end, and the session-cookie machinery is solid. **Measured against "200 real students in class in September 2026," however, the biggest unfinished functions are not in the UI — they are in the foundations.**

Ranked by severity, six gaps make launch impossible until resolved:

1. **Student accounts do not exist.** The entire account universe is two hardcoded demo logins (Phoebe/Peter, password `12345`, committed to the repo). No registration, no roster import, no password storage or reset. The `uais_users` table is migrated on every deploy but no code reads or writes it. In production, none of the 200 students can log in at all — the login route returns 503 by design.
2. **Teachers have no write authority in production.** The only login→teacher-session bridge is local-runtime-only by design; a production teacher can list courses read-only and then 401s on create-course, invite-code issuance, membership approval, and group management. This is an unmade owner decision, not a bug.
3. **Real course content cannot enter the system.** The whole lesson catalog is one 19-slide demo deck compiled into the bundle; `/learning` is hardwired to fetch that demo course regardless of the student's real enrolment, and playback failure renders a *fabricated* gradient-descent lecture instead of an error. There is no ingestion or publish pipeline of any kind.
4. **The chatroom cannot sustain a real group conversation.** Delivery is 5-second polling only; a student's message is persisted only *after* the full AI round (10–50 s) completes; and every message — even with no @mention — triggers a live, billed AI completion. Classmates cannot talk to each other at conversational speed.
5. **The storage architecture collapses at classroom concurrency.** All transcripts live in **one** Postgres jsonb row and all course/enrolment/group data in **another single row**; every write rewrites the whole blob under one lock with 1–4 retries, and every poll opens two fresh TLS connections. Enrolment day (200 simultaneous QR joins) produces user-visible 409 storms, and losing chat messages is silent.
6. **The live deployment is stale and the env decisions are unmade.** A live probe shows the chatroom API 404s on `www.uais.top` — the last month of MVP work is not deployed. Multiple production-required env values (auth provider, AI keys, storage selectors, groups flag) are undecided owner items, and no smoke test has ever run against any deployed lane.

The second tier — launch survives, but the classroom visibly breaks: enrolment operations don't scale to 200 (one-by-one approval, no reject/remove/withdraw, ~40 groups built fully by hand, a decorative non-scannable "QR code"); learning progress is not truthful (optional LRS silently discards events, completion lives in per-device localStorage, the dashboard shows static demo data titled "Peter's learning home"); no moderation or prompt-injection defense, no login brute-force protection, no global AI cost ceiling; and on phones — the primary student device — there is no navigation menu and no sign-out.

**Beyond code**, the repo's own privacy baseline forbids starting a production cohort until the institution approves retention/contact/export rules — unmet today; Chinese regulatory posture (ICP filing, PIPL cross-border transfer to US-hosted Neon/Vercel, AIGC labeling) has never been assessed; and there is no teacher/student documentation, no reachable support channel, and no load-test evidence at any concurrency.

**Verdict: September is still achievable, but the window is tight.** Critical path: decide auth + content pipeline and fix the deploy chain this week → land accounts, teacher write path, and per-room storage keys within two weeks → wire real course content, decouple chat from AI rounds, and add bulk approve/auto-grouping in weeks three–four → full dress rehearsal with a pilot group two weeks before term. See §5.

---

## 1. How to read this report

| Severity | Meaning |
| --- | --- |
| **Blocker** | The September launch is impossible or unsafe until this is resolved. |
| **High** | Launch survives, but the classroom experience is visibly broken or data is at risk. |
| **Medium** | A rough edge real users will notice. |
| **Low** | Polish. |

| Status | Meaning |
| --- | --- |
| `missing` | Does not exist. |
| `mock-only` | Demo/hardcoded data pretending to work. |
| `partial` | Happy path exists; the real-world path does not. |
| `fragile` | Works, but will fall over at classroom scale/conditions. |
| `decision-needed` | Code seams exist; an owner decision blocks completion. |

Every blocker below was independently re-verified by an adversarial second agent against the current code; none were refuted. The full 84-item inventory (77 audit findings + 7 completeness findings) is in Appendix A.

---

## 2. What is already finished (credit where due)

To keep this report honest, these are **not** gaps:

- **Chatroom happy path is real, not mock**: live DeepSeek/Qwen completions with per-role provider failover, server-attributed group rooms, durable Postgres transcripts/rooms/shares (B1–B4 closed 2026-08-09), revocable share links, and a server-rendered CJK transcript PDF.
- **Teacher participation in group rooms is implemented** (`ab41737`; `src/lib/server/learning-ai-guide-access.ts:158-170`) — the 2026-08-08 follow-up is closed.
- **The enrolment journey exists end-to-end architecturally**: invite-code join → pending review → approve → group → group chatroom, failing closed correctly in production.
- **Session-cookie machinery is sound**: HMAC-signed HttpOnly pair, constant-time verification, forged-pair rejection once the secret is set, safe redirects, sign-out clears both cookie pairs.
- **AI attribution partially exists** (robot icon and label distinction in the room and `authorLabel · agentTag` in the PDF) — the AIGC question in §4.2 is about compliance adequacy, not a missing UI.
- **Quality gates are green** on the current tree (per the 2026-08-09 survey: 2298 tests, lint, typecheck, build all pass).

The problem is not code quality. It is that several *functions the classroom depends on* were never built past the demo.

---

## 3. The biggest unfinished functions (ranked)

### 3.1 BLOCKER — Student accounts and login do not exist for real users

**Status: `missing` · Verified: CONFIRMED · Effort: ~1–2 weeks**

- The entire account universe is a hardcoded two-entry array — Phoebe (teacher) and Peter (student), both password `"12345"` in plaintext in the repo (`src/lib/server/uais-app-auth-provider.ts:40-55`).
- The only alternative is a `trusted-account-provider` HTTP contract (`UAIS_APP_AUTH_PROVIDER_URL/_TOKEN`) — **no such provider service exists anywhere**; the release harness stubs it with a token fixture.
- The `uais_users` table (with `password_hash`, `role`, `status`) is migrated on every deploy but **no route, store, or script reads or writes it**. There is no bcrypt/argon2 dependency in `package.json`, no registration, no roster import, no password reset.
- In production with the default provider, `POST /api/auth/app-session` returns **503 before checking credentials** (`src/app/api/auth/app-session/route.ts:61-70`), so no student can log in; without a session, invite-join 401s.
- The one working switch, `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH`, is a trap: it would collapse all 200 students into the single shared identity "Peter" — shared chatroom rooms, shared transcripts, shared rate-limit budget — behind credentials that are public in the repository. **It must never be the September answer**, and the release gate should fail when it is set for the cohort deployment.
- Adjacent: `POST /api/auth/app-session` has **no rate limit, lockout, or failure delay** — once real passwords exist, credential-stuffing against 200 known university names is trivial and invisible (and any future limiter must not be purely IP-keyed: the whole class shares campus NAT egress).

**Classroom failure:** day one, 200 students open `/login` and there is literally no credential that works. Every downstream MVP feature (enrolment, chatroom identity, transcripts) keys off `appSession.account`, so this single gap gates everything.

**Minimum September fix:** implement the credential provider the schema already anticipates — an authenticator against `uais_users` (argon2/bcrypt, `status='active'`), wired as a first-class `providerKind` in the existing provider contract, plus a teacher/owner CSV roster-import script that seeds 200 accounts with initial passwords. Password reset can be a manual script for MVP. Add a durable per-account failure counter on login.

### 3.2 BLOCKER — Teachers cannot perform any write action in production

**Status: `decision-needed` · Verified: CONFIRMED · Effort: ~3–5 days once decided**

- Every teaching write (create course/class, issue invite code, approve membership, manage groups, all operations) resolves its actor from the HMAC-signed teacher cookie pair. Exactly two code paths can mint it: `POST /api/ai/teacher-auth/issue` (503s until an undecided trusted-issuer/OIDC provider is configured; **no client UI calls it**) and the local login bridge — which **refuses every deployed runtime by design** (`src/lib/server/local-teacher-auth-bridge.ts:68-70`).
- Net effect on `www.uais.top`: a signed-in teacher can list courses read-only, then 401s on every write. Students who join via invite code would sit pending forever, because the approve route also requires the teacher cookie.

**Classroom failure:** the class cannot be stood up at all — no course, no invite codes, no approvals, no groups — unless an engineer hand-mints cookies with curl and production secrets.

**Minimum September fix (owner decision now):** either (a) promote a production-approved variant of the existing login bridge for verified teacher accounts from the new Postgres-backed provider (with `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET` set in Vercel), or (b) commit to the trusted-issuer/OIDC path and build the missing issuer client. Option (a) is the only one that fits the timeline.

### 3.3 BLOCKER — Real course content cannot enter the system, and playback ignores the student's course

**Status: `missing` + `mock-only` · Verified: CONFIRMED · Effort: ~1–2 weeks**

- The **entire published lesson catalog is one hardcoded 19-slide deck** ("elementary-math-research", Dr. Kang Xia) compiled into the bundle (`src/lib/learning/ppt-playback-catalog.ts:58-309`), with hand-transcribed per-slide durations and WAV/JPG assets committed to `public/`. There is **no manifest upload, no publish script, no DB- or blob-backed catalog**; the teacher PPT-narration workflow ends at downloads and never publishes into the learning catalog.
- `/learning` is **hardwired to the demo course**: the playback fetch always targets `elementary-math-research` regardless of the URL's `courseId` (`src/components/pages/learning-page.tsx:379-381`), and unknown course ids collapse to the mock cockpit. A student enrolled in the real September course gets **403 `student-course-membership-required`** (their membership is for a different courseId) — over fake content.
- Worse, every playback failure renders a **fabricated machine-learning lecture** ("3.2 梯度下降算法 / Gradient Descent", fake chapter rail, fake subtitles with fabricated timestamps) instead of an honest error state (`src/components/pages/learning-page-slides.tsx:300,49-57`). Students in a mathematics-education course will screenshot it.
- Deployment hazard: narration audio is served by `fs.readFile` of `public/` inside a serverless function **without file tracing** — the exact failure mode `next.config.ts` already documents (and fixes) for the PDF font only. On Vercel, every slide's audio likely 404s even though local `next start` passes (`src/app/api/learning/ppt-playback/audio/.../route.ts:217-220`, `next.config.ts:8-16`).

**Classroom failure:** the core "lesson learning" promise only works if the cohort's course is literally the built-in demo. Getting the real Week-1 lecture in front of students currently requires a developer to hand-edit TypeScript, copy assets, commit, and redeploy — per lecture, per week — and even then students in the *real* course can't be authorized to see it.

**Minimum September fix:** (1) route playback by the enrolled `courseId` with an honest "no published lesson yet" state; (2) a course→published-playback mapping plus a repeatable operator script that converts a PPT+narration bundle into a catalog entry and manifest (or formally accept code-commit-per-lecture and rehearse it once end-to-end before term); (3) add `outputFileTracingIncludes` for the audio route and verify with the existing deployment smoke script; (4) replace the fabricated fallback lecture with a real error state.

### 3.4 BLOCKER — The chatroom's conversation model cannot carry a real group discussion

**Status: `partial` · Verified: CONFIRMED · Effort: ~1–2 weeks**

- Delivery is **request/response plus a 5-second poll** — no SSE/WebSocket anywhere (`src/components/pages/use-learning-chatroom.ts:50`).
- A student's message is **persisted only after the full agent round completes** (round budget 45 s, request budget 50 s; `src/app/api/learning/chatroom/route.ts:604-696,737-758`) — so a classmate sees "好的，3点图书馆见" only 10–50 seconds after it was sent, and the sender cannot send again until the round settles.
- **Every message triggers a live AI completion even with no @mention** — the director dispatches the highest-priority agent regardless (`src/lib/ai/orchestration/director.ts:47-64`). Human small talk burns provider money on every line.
- The **6-messages/minute throttle** breaks normal chat cadence, and a throttled message renders in the sender's own thread but is **never stored** — classmates never see it, and the error blames "the AI service" (`route.ts:459-474`, `use-learning-chatroom.ts:1346-1357`). The 120/day cap ends an active student's participation mid-afternoon.

**Classroom failure:** 40 group rooms experience this as a broken chat, not a slow one: seconds-long gaps between classmates, messages that silently vanish, and a per-message AI interjection nobody asked for — at real API cost.

**Minimum September fix:** persist the student message immediately (fast path) and run agent turns **only for @-mentioned messages** (no-mention → zero provider calls); rate-limit only agent-triggering messages; surface a real 429 message with retry-after and roll back or queue the optimistic bubble; then cut perceived latency with a 1–2 s poll (cheap once storage is per-room, §3.5) or SSE.

### 3.5 BLOCKER — Single-row snapshot storage collapses at classroom concurrency

**Status: `fragile` · Verified: CONFIRMED (with corrections that make it worse) · Effort: ~1 week for the re-keying**

- **All chatroom transcripts for the entire deployment live in ONE Postgres jsonb row** (`snapshotKey = "default"`, `src/lib/server/learning-chatroom-transcript-postgres-store.ts:41`). Every 5 s poll reads the whole blob *plus* the whole course-management snapshot for authorization; every append re-reads, rewrites, and re-hashes the entire deployment's transcript database inside `FOR UPDATE` with an optimistic revision and 2–4 attempts. Appends in *different rooms* conflict with each other; a lost race is **silent** — the student sees their message on screen, but it is absent from the durable transcript, the export, and the share page.
- **All courses, classes, ~200 enrolments, groups, and an unbounded audit log live in another single jsonb row** rewritten whole per write with exactly one retry (`teaching-course-management-postgres-store.ts:12,41-119`). On enrolment day, 200 simultaneous invite joins collide on the global revision and students see raw `409 "snapshot changed; retry required"` errors.
- **Every operation dials a brand-new unpooled Neon TLS connection** and closes it (`src/lib/db/core-database.ts:54-67` and each store) — ~200 students polling at 5 s ≈ 80 connection setups/second sustained, against limits designed for pooled access. Meanwhile the relational schema that would fix all of this (`uais_enrollments` etc.) is **migrated on every deploy but has zero runtime consumers**.
- There is **no backup/restore path**: the rollback runbook covers Vercel deployments only; a single bad write replaces all enrolment data in one statement, and nothing documents whether Neon PITR is even enabled.

**Classroom failure:** enrolment-day 409 storms, silently vanishing chat messages during class, connection exhaustion presenting as random "history unavailable" — and any one storage accident is unrecoverable.

**Minimum September fix:** re-key the transcript snapshot **per room** and the course-management snapshot per course (small change to the two Postgres stores plus a migration — the store already computes room keys); reuse a module-scoped pooled client (the LangGraph store at `postgres-persistence.ts:10-38` already shows the pattern) and require the Neon `-pooler` URL; raise join/approve retries with jitter; verify/enable Neon PITR and write a restore runbook; move memberships onto `uais_enrollments` as the first relational cutover when time allows.

### 3.6 BLOCKER — The live site is stale, the env checklist is undecided, and nothing has ever been smoke-tested

**Status: `fragile` + `decision-needed` · Effort: days, once decisions are made**

- **Live probe (2026-08-11):** `GET https://www.uais.top/api/learning/chatroom?...` → **404** (`x-matched-path: /_not-found`), while a route created 2026-06-30 responds — bounding the deployed build **before 2026-08-08**. The entire last month of launch-critical work (durable stores, group rooms, share/export, provider failover, hydrate fix) **is not deployed**. Most likely cause: build-time `db:migrate` failing without a database URL in the Vercel build env.
- **Course-management backend has no production default**: unset `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND` resolves to local JSON, which is *refused* in production → the student course list, invite join, approvals, and groups all 503 — while the readiness script wrongly reports "ready" for the same configuration (`teaching-course-management-external-store.ts:28-49` vs `scripts/chatroom-production-readiness.mjs:58-62`). Same class of risk: group rooms require the exact literal `UAIS_LEARNING_CHATROOM_GROUPS_MODE=on`.
- **Production-required env values are still owner-blocked or undecided**: auth provider selection (§3.1), `DEEPSEEK_API_KEY`/`DASHSCOPE_API_KEY` ("blocked-until-approved" in `env-surface.ts:322-356` — the chatroom 503s without the former; the `/learning` ask-box needs **both** plus LangGraph Postgres persistence or every typed question 503s), `UAIS_APP_SESSION_SIGNING_SECRET` (unset silently *weakens* the proxy gate instead of failing loudly).
- **No journey smoke has ever run against any deployed lane**; the staging/promotion lane exists only on paper. The stale-deploy finding went unnoticed precisely because nothing probes the live site.
- **Monitoring is effectively absent**: the client-side Sentry init reads its DSN dynamically, which bundlers cannot inline, so browser Sentry never boots even when the var is set (`src/instrumentation-client.ts:4`); `/healthz` never checks the database, so a Neon outage shows green to any uptime monitor.
- **No cost ceiling**: `/api/learning/ai-guide` has **zero throttling** — one stuck client loop buys unlimited live completions; all other limits are per-instance (×N on Vercel).

**Minimum September fix:** fix the Vercel build (database URL in build env or move migrations out of the build step), deploy current main, and verify with `core-journey-smoke` against the live URL; give course-management the same production+core-DB Postgres auto-default the chatroom backend already has; apply the full required env set and run the readiness preflight against it; statically reference `NEXT_PUBLIC_SENTRY_DSN`; add a DB check to `/healthz`; copy the existing rate limiter onto the ai-guide route and set hard spend limits on the provider consoles.

### 3.7 HIGH — Enrolment and group operations do not scale to 200 students

**Status: `partial`/`missing` · Effort: ~1 week**

- **Approval is strictly one-by-one** — 200 clicks, each a full snapshot rewrite racing incoming joins; the "student roster sync" operation looks like an SIS import but persists **nothing except a receipt** claiming `sis-provider-synced`.
- **No reject/remove/withdraw membership operation exists** anywhere — a student who joins the wrong class is permanently stuck (409 on re-join), and dropped students cannot be removed all semester.
- **Group formation for ~40 groups is fully manual**: one dialog per group over a flat 200-checkbox list with no already-grouped indicator; double assignment is unchecked server-side; "generate group suggestions" produces a success receipt and **no suggestions** (`learning-group-workspace.tsx:349-354` — "Not wired yet").
- **Invite codes are sequential/guessable, never expire, have no capacity or disable switch**, and the join route is unratelimited. The invite dialog's **"QR code" is a decorative hash pattern that does not scan** — in front of the whole class — and its instruction text points to a UI location that does not exist. The workspace also displays unenforced hardcoded claims ("Valid until 2026-12-17", "Join limit 60").
- A multi-course teacher's inline operations (including invite-code generation) **silently target the first course** — `selectedCourseAction` is declared with no setter (`use-teaching-workspace.tsx:167-170`) — guaranteed to misfire since the two demo courses are always present.

**Minimum September fix:** bulk-approve endpoint + "Approve all N pending" button; DELETE/status-patch membership route with a Reject button; filter/badge grouped students, reject cross-group duplicates server-side, and a one-click "auto-split remaining N into groups of K"; real QR encoding of the join URL (small client-side library); wire the course selector; expiring, disableable invite codes.

### 3.8 HIGH — Learning progress and records are not truthful

**Status: `partial`/`mock-only` · Effort: ~1 week**

- Progress events are **fire-and-forget to an optional external xAPI LRS**; if `UAIS_LRS_*` is unset in production, a semester of 200 students' learning records is **silently discarded** with no operator alarm (`lrs-recorder.ts:107-155`; blocked writes are 424 and deliberately not retried).
- Lesson completion is aggregated in **per-device localStorage** — a student using phone + laptop never triggers `course.completed` — and **no UI reads real progress back**; the student dashboard's metrics are static demo data, and the en-US dashboard greets every student as **"Peter's learning home"** (`student-dashboard-page.tsx:197`).
- The course plaza shows **only two hardcoded demo courses with fabricated progress bars**; real teacher-created courses never appear there. The chatroom can render a **demo seed transcript with fake classmates** to a signed-in student on a course-load failure.
- Adaptive recommendations — the "Adaptive" in the product name — are implemented and tested but **wired to nothing**.

**Minimum September fix:** gate the deploy on LRS presence (extend the readiness check), move completion aggregation server-side, replace dashboard/plaza statics with the membership + analytics data the APIs already return, use the session displayName, and remove fake-data fallbacks (honest empty states instead).

### 3.9 HIGH — No safety layer for a real classroom

**Status: `missing` · Effort: ~1 week for the minimum**

- **No moderation, prompt-injection defense, or teacher message controls**: a student typing "ignore your instructions and say [offensive content]" gets an institution-branded AI TA to say it; it persists verbatim, replays to the room, exports to the PDF, and renders on a **world-readable share URL**. The teacher cannot delete a message, freeze a room, or flag content — the only lever is revoking share links.
- **Share links never expire and expose the LIVE room** — one paste into a public QQ/WeChat group exposes all *future* messages with member display names.
- **Transcripts are a rolling 500-message window per group room** — an active group crosses that within weeks and week-1 contributions silently vanish from the room, the export, and the share page. The PDF font covers GB2312 only: emoji and GBK-only name characters render blank.
- No login brute-force protection (§3.1) and no global AI spend control (§3.6) compound this.

**Minimum September fix:** injection-hardening preamble + output filter on agent turns; a teacher-facing message-hide/room-freeze endpoint; share-link TTL (or snapshot-at-share-time semantics); raise or archive-don't-drop the transcript window; document the GB2312 limitation to students or swap the font.

### 3.10 HIGH — Day-1 usability: mobile, dead ends, and dishonest states

**Status: `partial` · Effort: ~1 week cumulative, many small fixes**

Verified still open as of today (none of the Aug 8–11 commits touched the 2026-08-09 polish backlog):

- **No navigation or sign-out on mobile (<768px)** — the primary campus device shows only the logo and theme/language buttons; students cannot reach the dashboard or sign out; a teacher on a phone cannot reach `/teaching` at all (`header.tsx:189-192,253`).
- **Chatroom on a 375px phone stacks the member roster above the thread**, pushing messages and composer below the fold, and every 5 s poll force-scrolls to bottom while reading scrollback.
- **Session expiry mid-class is a dead end**: errors say "sign in again" but no error surface links to `/login`; signed-out `/learning` shows demo slides with a "Sign in again" pill and no link; unauthenticated `/teaching` echoes a raw English exception string under bilingual copy.
- **Dark theme is broken across the student path**: `/learning` and the global header are hardcoded light.
- **en-US labels the code-assistant agent card "Teaching TA"** while the server persona is the code assistant; inert demo controls (dead subtitle search, static course directory, dead Course-materials/Calendar/Bell/Modify-cover buttons) remain everywhere students will click in their first minute.

**Minimum September fix:** mobile drawer nav with sign-out; chatroom mobile layout order + scroll-position guard; a `/login` link on every auth-failure surface; either fix `/learning` dark tokens or ship it documented light-only; correct the en-US agent label; remove or visibly badge inert demo controls.

---

## 4. Launch gates that are not code

From the completeness pass — these do not appear in any sprint plan but can each stop the launch:

### 4.1 Privacy baseline sign-off (HIGH, `decision-needed`)
The repo's own `docs/privacy-baseline.md` states **"No production cohort may start until the owner or institution records the approved retention schedule"** (lines 73–74) and lists Production Stop Conditions (93–108) that are **unmet today**; every item in its Open Decisions section (retention windows, DPA/privacy contact, approved providers) is still open. Record the institution's written retention schedule, privacy contact, and provider approvals in a dated document before onboarding the cohort — and reconcile the `/privacy` page's promises (deletion/export requests) with what actually exists.

### 4.2 Chinese regulatory posture (HIGH, `decision-needed`)
Zero references to ICP 备案, 等保/MLPS, or 实名 obligations anywhere in the repo; there is **no footer component at all**, so an ICP number could not even be displayed. The system would store 200 mainland students' identities, chat content, and education records on **US-hosted Neon/Vercel**, and the privacy page explicitly defers cross-border legal confirmation to the institution — no confirmation artifact exists. AIGC labeling partially exists in the UI but its compliance adequacy is unassessed. **This week:** confirm with the university's legal/IT office whether foreign hosting is acceptable or a mainland deployment is required, plus ICP/MLPS expectations for `uais.top`. Note the ops finding that functions are pinned to `iad1` (US-East) and mainland campus reachability has never been tested — the regulatory answer and the latency answer may share a solution.

### 4.3 Semester-end data export is mock-only (MEDIUM, `mock-only`)
The teacher export's "download" returns **the metadata manifest itself as the attachment** — no learning records, chat threads, or grades — and the redaction validation is hardcoded to pass (`export/[manifestId]/route.ts:161-168`). Either implement a real export (memberships + rosters + per-room transcripts, JSON/CSV) before semester end or remove the export cards so the UI stops advertising it.

### 4.4 Nobody knows how to run it, and nobody to call (MEDIUM, `missing`)
All four runbooks are operator/engineer-facing. There is **no teacher day-1 guide** (course → class → invite → approve → groups → chatroom session), **no student quick-start**, and **no concrete support channel** anywhere in the app — the terms/privacy pages name roles, not channels. Write two short bilingual documents and pick one monitored channel (email alias or class WeChat/QQ group), put it in the error states, and define a two-line mid-class incident protocol.

### 4.5 No load-test evidence (MEDIUM, `missing`)
Three auditors predicted the storage collapse; nothing in the repo can verify it — or verify the fix. No k6/artillery/autocannon anywhere; the most concurrent thing ever exercised is two parallel requests. Add a small scenario against staging: (a) 200 concurrent invite joins, (b) 40 rooms × 5 users posting with 5 s polls for 10 minutes, (c) sustained ai-guide traffic. Make passing it a release gate.

### 4.6 Assessment/attendance decision unrecorded (MEDIUM, `decision-needed`)
If the September course is credit-bearing: attendance does not exist in the repo (zero hits for 考勤/签到), `uais_assessments`/`uais_submissions` are migrated with zero consumers, and the gradebook-release flow has no student-visible surface. Record a one-paragraph decision: official grades and attendance live in the university's existing systems for this cohort; UAIS contributes participation evidence via (fixed) transcript export — or explicitly nothing.

---

## 5. The minimum September path (sequenced)

Working backwards from a September start (~4–5 working weeks):

**Week 1 (now) — decisions and the deploy chain.**
1. Owner decides: student auth = first-party provider on `uais_users` + roster import (§3.1); teacher write path = production login bridge for verified teachers (§3.2); content pipeline = operator publish script vs. rehearsed commit-per-lecture (§3.3).
2. Ask the university legal/IT office the §4.2 questions; start the §4.1 privacy sign-off.
3. Fix the Vercel build/promotion, deploy current main, run the journey smoke against `www.uais.top` (§3.6).
4. Land the two small high-leverage storage fixes: course-management production Postgres default, per-room/per-course snapshot keys + pooled client (§3.5, §3.6).

**Weeks 2–3 — the three big builds, in parallel tracks.**
- Track A (backend): accounts on `uais_users` + roster import + login rate limit; production teacher bridge; bulk approve + reject/remove; auto-split grouping.
- Track B (chatroom): decouple posting from agent rounds; @mention-only agent turns; honest 429; share TTL; teacher hide/freeze; ai-guide rate limit + provider spend caps.
- Track C (learning): playback routed by courseId; publish path for the real course's first lectures; audio file-tracing fix verified on a preview deploy; honest error states replacing fabricated content; LRS decision + server-side completion.

**Week 4 — make it operable.**
- Mobile nav + chatroom mobile layout; `/login` links on failure surfaces; dashboard/plaza real data; en-US label fixes.
- Apply the full production env set; Sentry client fix + healthz DB check; enable/verify Neon PITR + restore runbook.
- Load-test scenario against staging (§4.5); teacher runbook + student quick-start (§4.4).

**Week 5 — dress rehearsal.**
- Pilot run with one real group (5–10 students) on production infrastructure: login → join → group → lesson → chatroom → export. Fix what the rehearsal finds. Freeze scope.

**Explicitly deferred (agreed out of MVP):** teacher AI-agent configuration and rich teaching activities (Nov 2027); voice-clone/PPT-narration authoring modules (parked per SCOPE.md); LMS/LTI integration; adaptive recommendations surfacing; video lectures; relational cutover beyond memberships.

---

## 6. Owner decisions needed (consolidated)

1. **Student auth provider** — build first-party accounts on `uais_users` (recommended for timeline) or stand up an external trusted-account provider. Gates everything.
2. **Teacher production write path** — production login bridge (recommended) vs. trusted-issuer/OIDC build-out.
3. **Content pipeline** — operator publish script (recommended) vs. rehearsed commit-per-lecture for the September course.
4. **AI provider keys and budgets** — approve `DEEPSEEK_API_KEY`/`DASHSCOPE_API_KEY` for production, set console spend caps, decide the ask-box mode (multi-agent env vs. single-agent fallback).
5. **Hosting/regulatory posture** — confirm with the institution: foreign-hosted acceptable or mainland deployment required; ICP; PIPL cross-border; AIGC labeling adequacy.
6. **Privacy baseline sign-off** — retention schedule, contact path, export handling (the repo forbids a cohort without it).
7. **Assessment/attendance posture** — one recorded paragraph (§4.6).
8. **Demo-auth flag** — record that `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` must never be set on the cohort deployment; add the release-gate guard.

---

*Prepared by Claude (read-only multi-agent audit; no feature code changed). Findings verified against HEAD `54dacb4`, 2026-08-11. Checks not run: none required — documentation-only deliverable. Full finding inventory follows in Appendix A.*

---

## Appendix A — Full finding inventory (84 items)

Sorted by severity within each area. Evidence citations for every row are in the audit transcript; the highest-impact rows are expanded in §3–§4 above.

### A. Auth & accounts

| Severity | Status | Finding | Effort |
| --- | --- | --- | --- |
| blocker | missing | No account provisioning path for 200 real students: registration, roster import, password storage, and reset all absent | M |
| blocker | decision-needed | Production teacher write authority has no reachable mint path: teachers cannot create courses, approve students, or manage groups on www.uais.top | M |
| blocker | mock-only | The only working production login switch (UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH) collapses all 200 students into one shared identity with a public password | S |
| high | missing | No brute-force protection on POST /api/auth/app-session: no rate limit, no lockout, no failure delay | S |
| medium | fragile | App-session signing secret has no strength floor, and a committed dev secret becomes a session forgery key on any marker-free host | S |
| medium | partial | Sessions are stateless with no revocation and no renewal: a compromised or disabled account cannot be forced out, and 8h fixed expiry can hit mid-class | M |
| medium | decision-needed | Trusted-account-provider contract exists but is untested against any real backend and forwards plaintext passwords to a bearer-token endpoint | M |
| low | partial | Login consent line is decorative: terms/privacy agreement is asserted but never collected | S |
| low | fragile | Proxy navigation gate accepts an unverified cookie pair whenever its runtime lacks the signing secret | S |

### B. Enrolment & groups

| Severity | Status | Finding | Effort |
| --- | --- | --- | --- |
| blocker | decision-needed | Production student-auth gate 503s the entire enrolment journey; no real student accounts exist | L |
| high | fragile | Single-row whole-database JSON snapshot store collapses under 200 concurrent joins | L |
| high | missing | No reject/remove/withdraw membership operation — wrong-class joins are permanent, dropped students unremovable | M |
| high | partial | Approval is strictly one-by-one (200 clicks); bulk approve and roster import are mock receipts only | M |
| high | partial | Group formation for ~40 groups is fully manual; auto-assignment is an unwired mock and double-assignment is unchecked | M |
| medium | partial | Invite codes: sequential/guessable, never expire, no capacity, no disable, unratelimited join | M |
| medium | partial | Unauthenticated invite-link landing dead-ends: no login handoff and no manual code entry | S |
| medium | mock-only | Course plaza shows only two hardcoded demo courses; real teacher-created courses never appear there | M |
| medium | partial | Enrolled-but-ungrouped student silently gets a solo chatroom with no 'not grouped yet' notice | S |
| low | partial | Server error strings surface untranslated inside Chinese UI messages on join failure | S |

### C. Chatroom at scale

| Severity | Status | Finding | Effort |
| --- | --- | --- | --- |
| blocker | fragile | All chatroom transcripts stored as ONE Postgres jsonb snapshot row; whole DB read per 5s poll and rewritten per append over a fresh connection | L |
| blocker | partial | Delivery model cannot sustain a group conversation: poll-only, message persisted only AFTER the agent round, and every message triggers a live AI turn | L |
| high | fragile | 6-messages/min POST throttle breaks chat cadence; throttled message is shown to the sender but never delivered to the room, with a misleading error | M |
| high | decision-needed | Production chatroom availability depends on two env selectors the readiness gate and docs claim are defaulted — false-green 503 risk | S |
| high | missing | No moderation, prompt-injection defense, or teacher message controls; agent output is stored verbatim and replayed to the room, exports, and public share pages | M |
| medium | partial | Share links never expire and expose the LIVE room indefinitely to anyone holding the URL | S |
| medium | decision-needed | Transcript is a rolling window (500 messages/group room): a semester of chat silently loses early history from room, export PDF, and share page | M |
| medium | fragile | PDF export font covers GB2312 only: emoji, traditional characters, and name hanzi outside GB2312 render blank; export route also has no rate limit | M |
| medium | partial | Mobile: below 1280px the roster stacks ABOVE the thread, and every poll force-scrolls the thread to bottom while reading scrollback | S |
| medium | decision-needed | All rate limiting and spend control is per serverless instance; no global provider budget, per-course cap, or token-input cap | M |
| low | decision-needed | Group rooms ship dark: production launch requires UAIS_LEARNING_CHATROOM_GROUPS_MODE set to the exact literal 'on' | S |

### D. Lesson learning & content

| Severity | Status | Finding | Effort |
| --- | --- | --- | --- |
| blocker | missing | No content ingestion path: the entire lesson catalog is one hardcoded deck compiled into the bundle | L |
| blocker | mock-only | /learning is hardwired to the demo course; real enrolled courses can never reach playback authorization | M |
| high | fragile | Narration audio is served by fs.readFile of public/ inside a serverless function without file tracing — the exact failure mode next.config.ts already documents for the PDF font | S |
| high | mock-only | Playback failure fallback renders a fabricated machine-learning lecture instead of an honest error state | S |
| high | decision-needed | Ask-box always sends multi-agent mode, which 503s in production unless four env prerequisites are all configured | S |
| high | partial | Progress tracking is fire-and-forget to an optional LRS, aggregated in per-device localStorage, and never read back by any UI | M |
| medium | mock-only | Course outline, directory, and study-surface controls are decorative props | M |
| medium | decision-needed | No lecture video support — playback is slide JPG + per-slide WAV only | L |
| low | partial | Adaptive recommendation engine is implemented and tested but wired to nothing | M |

### E. Data durability

| Severity | Status | Finding | Effort |
| --- | --- | --- | --- |
| blocker | decision-needed | Course/class/membership store has no production Postgres default despite docs claiming it - unset selector 503s the whole teaching surface | S |
| blocker | fragile | All courses, classes, ~200 enrolments, groups and an unbounded audit log live in ONE jsonb row rewritten whole per write with a single retry - enrolment-day concurrency will throw user-visible 409s | L |
| blocker | missing | No user/account store exists - uais_users is migrated but unused, and production auth resolves to two hardcoded demo accounts or an unbuilt external provider | L |
| high | fragile | Every chatroom message across all rooms serializes through one Postgres row; appends that lose the optimistic race are silently dropped from the transcript | M |
| high | partial | Teaching-operations execution in production hard-requires the external storage service; the Postgres cutover is half-finished and the required env var is catalogued as quarantined-legacy | M |
| high | missing | No backup/restore path for the core Neon database; snapshot-replace writes mean one bad write permanently destroys all course and enrolment data | S |
| medium | partial | Learning-record events and learner profiles depend entirely on an optional external xAPI LRS; unconfigured or failing delivery silently drops events | M |
| medium | partial | Relational core schema is migrated on every deploy but has zero runtime consumers, and the migration inventory in code is stale | S |
| medium | fragile | Every snapshot read/write opens and closes a fresh Postgres connection - connection churn at classroom scale | S |

### F. Ops & deployment

| Severity | Status | Finding | Effort |
| --- | --- | --- | --- |
| blocker | fragile | Live production deployment is stale: the chatroom MVP is not deployed to www.uais.top | S |
| blocker | fragile | Single-row whole-corpus JSONB snapshot stores collapse under classroom concurrency | L |
| blocker | decision-needed | Day-1 production env checklist has undecided owner values with no applied-in-Vercel evidence | M |
| high | fragile | Connection-per-operation Neon access plus 5-second polling produces a connection storm | M |
| high | missing | No smoke has ever run against a deployed lane; staging/promotion lanes exist only on paper | M |
| high | partial | Operator monitoring absent: unevidenced Sentry DSNs, dead client-side Sentry init, healthz never checks the database | S |
| high | missing | No cost ceiling: the learning ask-box AI route is completely unthrottled and all other limits are per-instance | S |
| medium | fragile | History-poll budget clashes with real class-day usage | S |
| medium | decision-needed | Functions pinned to us-east (iad1) while students and AI providers are in China; mainland campus reachability never tested | S |
| medium | fragile | Build-time migrations couple every deploy to database availability and let preview builds migrate production | S |
| medium | decision-needed | Production demo-auth override remains a live seam (Phoebe/Peter, password 12345) | S |

### G. Student-facing UX

| Severity | Status | Finding | Effort |
| --- | --- | --- | --- |
| blocker | partial | /learning playback is hardcoded to one published course; every student in every course sees the same math PPT | M |
| high | mock-only | Course plaza shows only two static demo courses with fabricated progress; real enrolments never appear | M |
| high | missing | No navigation or account menu on mobile (<768px): no menu, no sign-out, no route switching | M |
| high | mock-only | Class invitation 'QR code' is a decorative hash pattern, not a scannable code | S |
| high | partial | Multi-course teacher operations silently target the first course (selectedCourseAction is never set) — including invite-code generation | S |
| high | partial | Learning ask-box hard-requires BOTH DeepSeek and DashScope keys (multi-agent only) and fails with a generic error while agent cards still work | S |
| high | mock-only | en-US student dashboard greets every student as 'Peter' and shows static demo learning snapshot | S |
| medium | partial | Dark theme is broken across the student path: /learning and the global header are hardcoded light | M |
| medium | partial | Signed-out or unenrolled /learning shows demo slides plus a 'Sign in again' pill with no sign-in link | S |
| medium | mock-only | Invite workspace shows unenforced hardcoded claims: 'Valid until 2026-12-17', 'Join limit 60', plus a placeholder invite code before generation | S |
| medium | partial | Unauthenticated/failed /teaching load echoes the raw English exception string under bilingual copy, no /login link | S |
| medium | partial | en-US labels the code-assistant agent card 'Teaching TA' while zh-CN and the server persona are the code assistant | S |
| medium | fragile | Chatroom demo seed transcript with fake classmates renders to signed-in students on course-load failure | S |
| medium | fragile | Chatroom mobile layout: roster stacks above the thread, pushing messages and composer below the fold at 375px | S |
| medium | mock-only | Inert demo controls still live on the /learning companion panel and header: dead subtitle search/filter, static course directory, dead Course-materials button, dead Calendar/Bell, dead Modify-cover | S |
| medium | partial | Session-expiry mid-class is a dead end: errors say 'sign in' but no surface links to /login | S |
| low | partial | Accessibility/i18n small defects on the student path: Chinese-only aria-label on password toggle, sub-AA gray text on /learning, misleading 'QR code' aria-labels | S |
| low | partial | Code-health backlog items §6.3/§6.9/§6.10 unchanged: duplicated operation verifiers, QA-matrix gaps G1/G2/G4/G8/G9, three files at the 1500-line lint cap | M |

### H. Completeness pass (non-code launch gates)

| Severity | Status | Finding |
| --- | --- | --- |
| high | decision-needed | Institutional privacy/data-protection sign-off is absent and the repo's own baseline forbids launching without it |
| high | decision-needed | Chinese regulatory posture never assessed: ICP filing, MLPS, PIPL cross-border transfer to US-hosted Neon/Vercel, real-name and AIGC-service filing |
| medium | mock-only | Semester-end course data export is mock-only: the 'download' returns a metadata manifest, and the redaction validation is hardcoded to pass |
| medium | missing | No teacher or student user documentation: all four runbooks are operator/engineer-facing; nothing tells the instructor how to run day 1 |
| medium | missing | No support or incident channel a student or teacher can actually reach when the system fails mid-class |
| medium | missing | Zero load-test harness or capacity evidence: 200-student concurrency has never been simulated in either direction |
| medium | decision-needed | No recorded decision on assessment, attendance, and grade visibility for a credit-bearing September course |

### Verification record

The seven highest-severity claims were independently re-verified by adversarial agents instructed to refute them against HEAD `54dacb4`:

| Verdict | Claim |
| --- | --- |
| CONFIRMED | No account provisioning path for 200 real students: registration, roster import, password storage, and reset all absent |
| CONFIRMED | Production teacher write authority has no reachable mint path: teachers cannot create courses, approve students, or manage groups on www.uais.top |
| CONFIRMED | The only working production login switch (UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH) collapses all 200 students into one shared identity with a public password |
| ADJUSTED | Production student-auth gate 503s the entire enrolment journey; no real student accounts exist |
| ADJUSTED | All chatroom transcripts stored as ONE Postgres jsonb snapshot row; whole DB read per 5s poll and rewritten per append over a fresh connection |
| CONFIRMED | Delivery model cannot sustain a group conversation: poll-only, message persisted only AFTER the agent round, and every message triggers a live AI turn |
| CONFIRMED | No content ingestion path: the entire lesson catalog is one hardcoded deck compiled into the bundle |

_ADJUSTED = the issue is real at the stated severity; mechanism details were corrected (both corrections are incorporated in §3 above). No claim was refuted._
