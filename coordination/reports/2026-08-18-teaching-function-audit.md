# /teaching Function Audit

- **Date:** 2026-08-18
- **Scope audited:** every user-triggerable function reachable from `http://localhost:3000/teaching` — 80 controls across the inline workspace, the 11 standalone `/teaching/{operation}` pages, the class/roster surfaces, the invite-code tools, the teacher voice + PPT-narration workflow, and the AI Ops workbench.
- **Method:** two passes. (1) A parallel fan-out that did static source tracing of every control to its handler and route, plus **GET/HEAD-only** probes against the already-running local dev server, issuing no POST/PUT/PATCH/DELETE. (2) A follow-up authenticated pass (**§12**) that logged in through the ordinary login form with the in-repo `local-demo` fixture account and re-tested the read paths. No request was ever addressed to `uais.top` directly, though §12.3 records one authenticated **read** that the local server forwarded there. No secret value was read, printed, or logged — environment variables are referenced by **name** only, and values only ever classified by boolean test.
- **Audited by:** audit session; the only repository file changed is this report.

---

## 1. Short answer

**No — not every function of `/teaching` works locally, but the page itself does work, and more of it works than first appears.** See §12, which supersedes parts of §1 and §3.1: a follow-up pass **did** obtain a real teacher session and confirmed `GET /teaching` → **200** (the genuine workspace, title `我的教学`) and `GET /api/teaching/courses` → **200** with real course data. The login gate is passable locally via the in-repo `local-demo` account, and the missing database does not block the core teaching surface.

Critically, **what does still block the rest is environment configuration, not broken code.** The no-database condition turns out to be almost irrelevant: the teaching stack does not fail without Postgres — it falls back to local JSON files under `.tmp/`, and the course list genuinely reads from there. The real thing standing between a local teacher and a fully working `/teaching` is that `.env.local` points the teacher-ownership backend at **production `uais.top`**, so most operation actions cannot be exercised locally without contacting (and in two cases *writing to*) the live system. §12.3 confirms that egress by measurement.

Of the 80 functions: **25 are usable locally today**, **37 are implemented but gated behind an authorization call to the production external-storage service**, **10 are implemented but their controls are not currently rendered** (a feature flag that is off, plus a data precondition), **2 would write to production if used**, **5 are genuine code defects that fail in every environment**, and **1 could not be verified either way**.

**Distinguish these sharply:** "blocked locally" ≠ "broken." Only the 5 items in §7 are defects in the code. The 37 blocked items are, as far as static tracing can establish, correctly implemented — they simply cannot be *proven* to work from here without either repointing configuration or touching production.

---

## 2. ⚠️ Production safety warning — read before clicking anything on /teaching

`.env.local` on this machine sets:

| Variable (name only) | Effect |
| --- | --- |
| `UAIS_EXTERNAL_STORAGE_BASE_URL` | Points at **production** (`https://…uais.top/api/external-storage`) — classified by boolean test; value never printed |
| `UAIS_DEPLOYMENT_BASE_URL` | Same production host |
| `UAIS_TEACHER_AI_OWNERSHIP_BACKEND` | `external` → teacher-ownership reads/writes go to that production host |
| `UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND` | `external` → voice lifecycle audit events go to that production host |
| `UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN` | Present, ≥32 chars → the outbound calls are **authenticated** and will be accepted |

### What this means concretely

Once you are signed in locally as a teacher, ordinary-looking clicks on `/teaching` leave this machine and reach the live site.

**Confirmed production WRITES (do not perform locally):**

| Action | Outbound call |
| --- | --- |
| **新增课程 → 完成 / Create course** | `POST {prod}/teacher-ai-ownership/{teacherId}/merge` — writes a teacher-ownership row into production. Not optional and not a fallback: `POST /api/teaching/courses` awaits `mergeTeacherAiOwnershipRecord` on every successful create (`src/app/api/teaching/courses/route.ts:441-443`, `:571-579`; adapter `src/lib/server/teacher-ai-ownership-store.ts:501-535`). If the merge fails the route rolls back only the **local** record and returns 503 — **production is not compensated** (`route.ts:580-603`). |
| **登记教师声音 / Register teacher voice** in *live* execution mode | `POST {prod}/teacher-ai-ownership/{teacherId}/merge` (`src/app/api/ai/voice-sample/route.ts:180`, inside the `executionMode === "live"` branch at `:142`). The UI currently hardcodes `contract` mode, so today's button does not reach it — but `run-voice-workflow-preflight` cannot be enabled without a registered sample, which is why that item is flagged. |
| **POST /api/ai/voice-clone/revoke** | Appends to the **production** voice-lifecycle audit log (`src/lib/ai/voice/lifecycle-audit-store.ts:242-258`). No UI caller today. |

**Production READS (authenticated outbound GETs from your laptop to the live site):** every course-ownership authorization on ~11 teaching routes, including `POST /api/teaching/operations` (all 22 inline operation actions), `GET /api/teaching/operations/audit`, `.../audit/alerts`, `.../audit/alerts/notifications`, `GET /api/teaching/operations/export/{manifestId}`, `POST /api/ai/session`, `GET /api/ai/teacher-ownership`, `GET /api/ai/teacher-ppt-workflow`, the rollback route, the backup-restore route, and both gradebook-update routes. See `src/app/api/teaching/operations/route.ts:218-230` + `:1332-1348` → `src/lib/server/teacher-ai-ownership-store.ts:454-480`.

### Risk

1. **Data integrity.** Creating a test course locally mutates production ownership state. If the local record is later rolled back or the `.tmp/` store is wiped, production keeps an orphaned ownership row.
2. **Confusing failures.** Almost every teaching write will appear "broken" locally with a 403 (`teacher-course-ownership-required` / `course-scope-denied`), because production has no ownership record for the local demo teacher (`Phoebe`) covering the locally-created course ids. That is a configuration artefact, **not** a bug in the teaching code.
3. **Credentialed egress.** The outbound calls carry the production bearer token from a developer laptop.

### One mitigation that does hold

Every outbound ownership call is constructed **after** authentication succeeds. Unauthenticated probes of localhost therefore never reach production — verified: `GET /api/teaching/courses` (no cookies) → `401`. The danger begins the moment a valid teacher session cookie is present.

### Fix

Before exercising `/teaching` locally, point the external storage at the local machine and confirm it:

1. Set `UAIS_EXTERNAL_STORAGE_BASE_URL` and `UAIS_DEPLOYMENT_BASE_URL` to `http://localhost:3000/api/external-storage`. This app **implements the same contract it is configured to call**, and the two handlers the ownership adapter needs (`teacher-ai-ownership` GET and `…/merge` POST) are the only two external-storage handlers that do *not* carry a production-database-adapter guard — so they work locally (`src/lib/server/external-storage-route-service.ts:163-194`, `:196-254`).
2. Or, more simply, unset `UAIS_TEACHER_AI_OWNERSHIP_BACKEND` and `UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND` so both fall back to the local-file adapters (`src/lib/ai/storage-backend-contract.ts:152-160` — an unset selector normalizes to `local-json-file`, which is genuinely local; verified, not assumed).
3. Restart the dev server and re-verify with a **read**: `GET /api/teaching/courses` while signed in should still return the local `.tmp/` rows.

Owner decision needed: whether option 1 or 2 becomes the documented local default (S19 owns env placement; S22 owns release/deployment posture).

---

## 3. What blocks local verification

### 3.1 The login gate (passable locally, and not a database problem)

`/teaching` is protected by `src/proxy.ts` (Next.js 16 uses `proxy.ts`, not `middleware.ts`).

- `src/proxy.ts:12` — protected prefixes include `/teaching/:path*`
- `src/proxy.ts:29-52` — computes `authenticated`
- `src/proxy.ts:58-65` — 307-redirects to `/login?from=<path>`

**Verified live:** `GET /teaching` (no cookies) → `307`, `location: /login?from=%2Fteaching`. `GET /login` → `200`.

Login itself needs **no database**: `UAIS_APP_AUTH_PROVIDER` is unset, so the provider defaults to `local-demo` (`src/lib/server/uais-app-auth-provider.ts:219-221`) and authenticates against a hard-coded in-repo table (`:54-69`). The local teacher-auth bridge then also mints the signed teacher cookie the write routes need (`src/lib/server/local-teacher-auth-bridge.ts:58-116`, wired at `src/app/api/auth/app-session/route.ts:238-247`).

So the gate is passable — but only via `POST /api/auth/app-session`, which the fan-out audit was not permitted to issue. **That phase therefore never held a real teacher session.** This limitation was removed afterwards: see **§12**, where a real session was obtained through the ordinary login form and authenticated behaviour *was* observed.

One local-only nuance worth recording as a separate finding: `UAIS_APP_SESSION_SIGNING_SECRET` is unset, which enables an optimistic fallback in the proxy (`src/proxy.ts:39-52`) — any request carrying two non-empty `uais_app_session` / `uais_app_session_signature` cookies is treated as authenticated **without a signature check**. That is acceptable for local development but should never reach a deployed runtime; the deployed-runtime guard is what prevents it (`src/lib/server/uais-app-session.ts:46-56`). Flagging for S12/S19 review, not as a `/teaching` defect.

### 3.2 No local database — and why it matters far less than expected

**Verified live:** `GET /healthz` → `{"status":"ok","checks":{"app":"ok","database":"not-configured","migrations":"not-configured"}}`.

The important finding: **the teaching stack does not require Postgres locally.** `selectUaisDurableSnapshotBackend(env)` (`src/lib/server/uais-durable-snapshot-backend.ts:35-49`) returns `"local-json"` when the selector is unset, the runtime is non-production and no core DB is ready — all three hold here. The repository resolves to `undefined` and every route's `assertTeachingCourseManagementLocalJsonRuntimeAllowed` guard is a **no-op outside production** (`src/lib/server/teaching-course-management-store.ts:189-200`). Reads and writes land in:

- `.tmp/uais-teaching-course-management-db/teaching-course-management.json` — already holds 2 courses (owner `Phoebe`), 1 class with an invite code, 1 approved membership
- `.tmp/uais-teaching-operations-db/teaching-operations.json` — already holds a data-export operation record and one export manifest

Those existing rows are evidence that the local-JSON path has already run to completion on this machine with `database: not-configured`.

**Exactly three teaching endpoints are non-functional locally, and none of them for database reasons:**

| Endpoint | Local result | Cause |
| --- | --- | --- |
| `GET`/`POST /api/teaching/operations/audit/alerts/notifications` | 503 for any authenticated teacher | Unlike every sibling, the notification adapter factories have **no local-json early return** and throw outright (`route.ts:378-393`, `:437-452`) |
| `POST /api/teaching/operations/collaboration-invite-deliveries` | 503 for every caller | Provider webhook gated on `UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN`, which is unset (`route.ts:100-107`) |
| 13 of 15 `/api/external-storage/*` routes | 503 | `UAIS_EXTERNAL_STORAGE_SERVICE_MODE=production` while the four `UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_*` proof variables are absent (`external-storage-route-service.ts:1089-1232`) |

### 3.3 Silent local behaviour gap (affects how you should read any local "success")

Even when an inline operation is authorized, several `maybePersist*` domain-record writes **skip silently** because `isTeachingCourseManagementPersistenceConfigured(env)` is false (neither `UAIS_TEACHING_COURSES_DATA_DIR` nor `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND` is set) and the runtime is not production — `src/app/api/teaching/operations/route-utils.ts:133-140`, `src/app/api/teaching/operations/domain-persistence-a.ts:70-75` and 20 sibling handlers (21 of 21 persisters carry the gate).

Consequence: for most operations the route reports `missing-domain-objects` and the UI shows *"Domain objects were not saved to the server: …"*. Two follow-on implications, both important:

- **A local red is not proof of a code bug** — it is the expected result of unconfigured persistence.
- **A local green would not prove the production path** — the domain write that production performs was skipped.

The one inline operation that escapes this is **确认发布邀请码 / Publish Invite Code**: `maybePublishClassInviteCode` has no persistence-configured guard (`route.ts:1150-1200`), so past the ownership check it genuinely persists locally.

---

## 4. Function inventory (all 80)

**Status legend**

| Symbol | Status | Meaning |
| --- | --- | --- |
| ✅ | **Works locally** | Client-only, or a local-JSON path; control is rendered and reachable after a local login. No production contact. |
| 🔒 | **Blocked — external production backend** | Implemented; static tracing found no defect. Clicking it issues an authenticated outbound call to production `uais.top` for the course-ownership check, so it could not be exercised here. Expected local outcome: 403 (`teacher-course-ownership-required` / `course-scope-denied`), plus in most cases the §3.3 `missing-domain-objects` result. |
| ⚠️ | **Not currently rendered** | Implemented and local-only, but the control does not exist in the DOM right now (feature flag off, or a missing data precondition). |
| ☢️ | **Would write production** | Reaching or using it performs a real write into production ownership state. Do not use locally. |
| 🐞 | **Broken — code defect** | Fails in every environment, independent of DB and configuration. See §7. |
| ❓ | **Unverified** | Could not be established either way under the read-only / no-POST constraint. |

> Every 🔒 / ☢️ / ⚠️ row is **implemented but unverified locally**. None of them was observed working, and none of them was observed failing for a code reason.

### A. Page shell and navigation

| Function | What it does | Status | Blocked by |
| --- | --- | --- | --- |
| Sidebar operation entries (11) 侧边栏教学操作入口 | Swaps the inline workspace panel between the 11 operations; `preventDefault()` + `openWorkspaceItem` | ✅ | — (pure `setState`; no effect keys on the active item, so zero fetches) |
| Workspace course selector 课程选择器 | Chooses the course all inline operations target | ✅ | — |
| Persisted course readback 课程/班级/名单读回 | Mount-time `GET /api/teaching/courses`; supplies courses, classes, roster, actorId, feature flags | ✅ | — (local JSON; GET never builds the ownership adapter) |
| Manage Course 管理课程 (card link) | → `/teaching/course-settings?course=…&action=manage` | ✅ | — |
| Continue 继续 (card link) | → `/teaching/content?course=…&action=continue` | ✅ | — |
| Take class 进入班级 | → `/teaching/students?course=…&class=…&action=enter-class` | ✅ | — (**defect**: `class` param is emitted but never read — see §7.6) |
| Activity List 活动列表 | → `/teaching/quiz-board?course=…&class=…&action=activity-list` | ✅ | — (same `class`-param defect) |
| Back to My Teaching 返回我的教学 | → `/teaching` | ✅ | — |
| Operation page vertical menu 轻量教学操作菜单 | Navigates between the 11 standalone pages, carrying `?course=` | ✅ | — (all 11 destinations render) |

### B. Courses, classes and roster

| Function | What it does | Status | Blocked by |
| --- | --- | --- | --- |
| New Course 新增课程 (open dialog) | Opens `NewCourseDialog` | ✅ | — (Escape listener is the dialog's only effect) |
| **Create course 完成** | Creates the course, then re-reads and verifies | ☢️ | **Writes production**: awaits `POST {prod}/teacher-ai-ownership/{id}/merge` |
| Generate Cover 生成封面 | AI course cover bound to a provisional courseId | ❓ | Provisional-id short-circuit genuinely skips the production ownership GET, but the route makes a **real billable DashScope call** and `.tmp/` holds no course-assets store — no evidence it has ever succeeded here |
| **Modify the cover 修改封面** | (intended) replace the generated cover | 🐞 | **Dead control** — no handler at all |
| Course settings draft fields (name / semester / description) | Builds a sparse patch for the selected course | ✅ | — |
| Save Course Settings 保存课程设置 | Posts the patch, then audit + alert readback | 🔒 | Production ownership GET; then §3.3 `course-settings` domain write skipped |
| Preview Student View 预览学生端 | Records a student-preview operation | 🔒 | Production ownership GET; then `student-preview-session` skipped |
| New class 新建班级 (open dialog) | Opens `NewClassDialog` for that course | ✅ | — |
| Create class 完成 | Creates the class, verifies receipt + readback | ✅ | — (0 fetch sites in the route; local JSON) — **caveat**: only the 2 *persisted* course cards are owned; pressing it on the 2 mock cards 403s |
| Open class invitation QR 打开班级邀请码 | Dialog with code, scannable QR (`uqr`, in-process) and 3 policy readouts | ✅ | — |
| Roster filter 名单筛选 | Filters roster rows client-side | ✅ | — (renders: 1 approved membership exists) |
| Approve 批准 (single) | Approves one pending join request | ⚠️ | **Control not rendered** — live roster shows `pending: 0`. Route itself is local-only, 0 fetch sites |
| Approve all 全部批准 (N) | Bulk-approves exactly the displayed ids | ⚠️ | **Control not rendered** — button is gated on `pendingMemberships.length > 0` |
| Reject 拒绝 | Sets a pending membership to `rejected` | ⚠️ | **Control not rendered** — sibling of Approve inside the same pending map |
| Remove 移出班级 | Sets an approved membership to `removed`, releases group seats | ✅ | — (renders for the 1 approved row; local JSON, 0 fetch sites) |

### C. Learning group collaboration — entire surface hidden behind an off feature flag

`GET /api/teaching/courses` returns `features.learningChatroomGroups: false`. `isLearningChatroomGroupsEnabled` requires `UAIS_LEARNING_CHATROOM_GROUPS_MODE` to be the literal string `"on"` (`src/lib/server/learning-chatroom-groups-flag.ts:22-33`); it is unset. `LearningGroupManager` has exactly **one** render site, inside `learningChatroomGroupsEnabled ? … : null` (`src/components/pages/teaching-page-course-settings-workspace.tsx:353`). This is a deliberate dark-launch, **not a defect and not a DB/auth/backend blocker**.

| Function | What it does | Status | Blocked by |
| --- | --- | --- | --- |
| Manage groups panel toggle 管理小组 / 隐藏 | Shows/hides the group panel | ⚠️ | Feature flag off |
| New group 新建小组 | Creates a group with class scope + members | ⚠️ | Feature flag off (route is local-only: 0 fetch sites, ownership from the local snapshot) |
| Edit group 编辑小组 | Renames / changes membership | ⚠️ | Feature flag off (PATCH route is local-only) |
| Delete group 删除小组 | Deletes the group; transcript retained | ⚠️ | Feature flag off (DELETE route is local-only) |
| Auto-split 自动分组 | Splits ungrouped approved students into groups of K | ⚠️ | Feature flag off **and** a second gate: button disables unless `ungroupedMembers ≥ 2`; the store has 1 |
| Group member picker 小组成员选择 | Class-scope select, filter, per-student checkboxes | ⚠️ | Feature flag off (pure client state otherwise) |
| Observe group chatroom 观察小组聊天室 | → `/learning/chatroom?courseId=…&groupId=…` | ⚠️ | Feature flag off — and the chatroom route independently refuses any `groupId` while the flag is off, **before** authorization, so hand-typing the URL does not bypass it. Note the inventory label is stale: the server now treats teachers as group **participants**, not observers |

### D. Invite code workspace

| Function | What it does | Status | Blocked by |
| --- | --- | --- | --- |
| Invite class selector 选择邀请码班级 | Picks the target class; single-class courses auto-resolve | ✅ | — (**caveat**: only 1 of the 4 visible course cards has a class, so it is inert on the other 3) |
| Invite expiry field 邀请码有效期 | `datetime-local`; unset = no expiry | ✅ | — (same single-course caveat) |
| Invite max-joins field 邀请码加入上限 | Caps joins; unset = no limit | ✅ | — (same caveat) |
| Disable invite code 停用邀请码 | Marks the code disabled | ✅ | — (same caveat) |
| Generate New Invite Code 生成新邀请码 | Creates the code, then audit readback | 🔒 | **Two** production ownership GETs per click (operations POST + audit GET) |
| Publish Invite Code 确认发布邀请码 | Ships the policy patch; verifies the stored code | 🔒 | Production ownership GET only — this is the one inline action **not** hit by the §3.3 gap; past authorization it genuinely persists locally |
| Copy Invite Code 复制邀请码 | Clipboard write | ✅ | — (not disabled; seeded value always present) |
| Copy Join Link 复制加入链接 | Clipboard write | ✅ | — |

### E. Inline operation actions (the remaining 9 operations × primary/secondary)

All 18 share one path: `POST /api/teaching/operations` → `authorizeTeachingOperationCourseAccess` → **external production ownership GET** (`route.ts:218-230`, `:1332-1348`). Persistence itself is local and DB-free. Where noted, a second, independent local failure follows from §3.3.

| Function | Operation / slot | Status | Blocked by |
| --- | --- | --- | --- |
| Save Agent Plan 保存智能体方案 | `agents` / primary | 🔒 | Production ownership GET |
| Run Permission Preflight 运行权限预检 | `agents` / secondary | 🔒 | + `permission-preflight` domain write skipped |
| Sync Knowledge Index 同步知识库索引 | `knowledge-base` / primary | 🔒 | + `knowledge-index` skipped; provider hook also inert (`UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER` unset) |
| Add Resource Placeholder 添加资料占位 | `knowledge-base` / secondary | 🔒 | + `resource-review-item` skipped |
| Publish Course Content 发布课程内容 | `content` / primary | 🔒 | + content-publish domain write skipped; provider hook inert |
| Generate Unit Draft 生成单元草稿 | `content` / secondary | 🔒 | Production ownership GET |
| Save Admin Settings 保存管理员设置 | `admins` / primary | 🔒 | + `admin-settings` skipped |
| Send Collaboration Invite 发送协作邀请 | `admins` / secondary | 🔒 | + no email is sent (provider unset) **and** the delivery-record endpoint 503s locally (callback token unset) |
| Recount Roster 重新统计学生名单 | `students` / primary | 🔒 | + `student-roster` skipped; roster provider inert |
| Generate Group Suggestions 生成分组建议 | `students` / secondary | 🔒 | + the suggestion receipt is *produced by* the skipped persister, so the feature's entire visible output is absent locally |
| Create Export Manifest 生成导出清单 | `data-export` / primary | 🔒 | Production ownership GET only — the manifest path is otherwise complete locally (a prior manifest exists in `.tmp/`) |
| Validate Redaction Scope 校验脱敏范围 | `data-export` / secondary | 🔒 | Production ownership GET |
| Refresh Dashboard 刷新数据看板 | `dashboard` / primary | 🔒 | + `dashboard-state` skipped |
| Lock Daily Snapshot 锁定日报快照 | `dashboard` / secondary | 🔒 | Production ownership GET |
| Refresh Quiz Board 刷新测验看板 | `quiz-board` / primary | 🔒 | + `quiz-board-state` skipped |
| Flag Low-quality Items 标记低质题复核 | `quiz-board` / secondary | 🔒 | + `quiz-item-review` skipped |
| Save Review Queue 保存批改队列 | `grading` / primary | 🔒 | Production ownership GET. **Note:** saves without publishing — and nothing in the UI can ever publish (§9) |
| Generate AI Feedback 生成智能反馈建议 | `grading` / secondary | 🔒 | + grading-feedback provider inert |

### F. Standalone `/teaching/{operation}` pages

| Function | What it does | Status | Blocked by |
| --- | --- | --- | --- |
| Operation page primary action | Same POST as the inline primary, course from `?course=` | 🔒 | Production ownership GET; §3.3 for 10 of 11 operations |
| Operation page secondary action | Same with `actionSlot=secondary` | 🔒 | Production ownership GET; §3.3 applies to **all twelve** secondary keys, so `applyTeachingOperationArtifacts` is never reached and export/invite previews never populate |
| Download export manifest 下载导出清单 | Link to the generated manifest bundle | 🔒 | Blocked at both ends: creating the manifest needs the ownership GET, and the download route re-checks ownership through the same external adapter |
| Preset vs Auto agent mode 预设智能体 / 自动生成 | Filters the agent-plan preview | ✅ | — (verified: `/teaching/agents` renders both labels) |

### G. Audit and recovery controls

| Function | What it does | Status | Blocked by |
| --- | --- | --- | --- |
| Roll Back This Operation 撤回本次操作 | Rolls back one teaching-operation record | 🔒 | Production ownership GET; and it only renders after a successful operation **plus** audit readback, each of which repeats that GET |
| Notify Admin 通知管理员 | Dispatches alert notifications, then re-reads to confirm | 🔒 | **Hard 503 locally** for any authenticated teacher — the notification adapter factories throw instead of falling back to local JSON (§3.2). Also preceded by a production ownership GET |

### H. Teacher voice + PPT narration workflow

Every fetch-based control here first mints AI-access headers via `POST /api/ai/session`, whose ownership read is the **external production adapter** — so the whole workflow is gated on a production ownership record for `Phoebe` covering the hardcoded `courseId: "research-methods"` and `pptAssetId: "kang-xia-ppt-19"`, ids that do not exist in the local store.

| Function | What it does | Status | Blocked by |
| --- | --- | --- | --- |
| Refresh server workflow 刷新服务端工作流 | Reads server-side workflow status + downloads | 🔒 | Production ownership GET (twice: session mint + route) |
| Check teacher login session 检查教师登录会话 | Probes whether a signed AI session can be minted | 🔒 | Production ownership GET — the probe's whole subject lives in production |
| Use Kang Xia 10-second voice 使用康霞 10 秒声音 | Selects the bundled sample, resets downstream state | ✅ | — (8 `setState` calls, no fetch — the cleanest local pass in this set) |
| Upload teacher voice sample 上传/选择 10 秒教师声音 | Picks a file, probes duration via a hidden `<audio>`, blocks <10s | ✅ | — (file never leaves the browser at this step) |
| Register teacher voice 登记教师声音 | Submits the consent-confirmed sample | 🔒 | Production ownership GET for the session. **Not** a production write today: the merge sits inside the `live` branch and the UI sends `contract` |
| Run workflow preflight 运行工作流预检 | Cross-session voice-clone preflight | ☢️ | The preflight endpoint itself is pure in-process computation, but the button **cannot be enabled** without first registering a sample, and the register route's ownership merge is a production write in live mode |
| Save voiceRef 保存声音引用 | Stores the cloned-voice reference | 🔒 | Session mint. Note: in contract mode the "saved" reference is client-side only |
| Generate PPT narration 生成课件配音 | Submits the 19-slide script set | 🔒 | Session mint. Contract mode skips both DashScope and the production merge |
| **Download full PPT narration package 下载完整课件配音包** | Link to the export bundle | 🐞 | **Cannot work in any environment** — see §7.2 |
| **Download per-slide WAV 下载每页音频** | Per-slide audio links (both sets) | 🐞 | **Cannot work in any environment** — see §7.3 |

### I. AI Ops workbench

| Function | What it does | Status | Blocked by |
| --- | --- | --- | --- |
| **Refresh readiness 刷新配置检查** | Per-provider readiness list | 🐞 | **Cannot succeed for any teacher, anywhere** — see §7.4 |
| **Run dry-run smoke 运行试测** | Reports smoke mode and network posture | 🐞 | **Cannot succeed for any teacher, anywhere** — see §7.5 |
| Run agent contract 试跑智能体合同 | Two-agent multi-turn chat contract | 🔒 | Session mint (production ownership GET). `/api/ai/chat` itself is contract-mode, 0 fetch sites |
| Register voice sample contract 登记声音样本合同 | Contract-mode voice-sample submission | 🔒 | Session mint. Confirmed **not** a production write (body omits `executionMode`, which defaults to `contract`) |
| Voice clone live preflight 声音克隆实时预检 | Contract-mode preflight summary | 🔒 | Session mint. The preflight route is the most self-contained in the surface — no fetch, no storage, no DB |
| Check voice clone status 检查声音克隆状态 | Contract-mode status check | 🔒 | Session mint |
| Create PPT narration contract 生成课件配音合同 | Contract-mode narration submission | 🔒 | Session mint |

---

## 5. Status summary

| Status | Count | Share |
| --- | ---: | ---: |
| ✅ Works locally | **25** | 31% |
| 🔒 Blocked — external production backend (implemented, unverified) | **37** | 46% |
| ⚠️ Not currently rendered (implemented, control absent) | **10** | 13% |
| 🐞 Broken — genuine code defect | **5** | 6% |
| ☢️ Would write production | **2** | 3% |
| ❓ Unverified | **1** | 1% |
| **Total** | **80** | 100% |

Breakdown of the 10 ⚠️ rows: **7** are the Learning Group surface behind `UAIS_LEARNING_CHATROOM_GROUPS_MODE` (one env var), **3** are membership approve/approve-all/reject, which need at least one pending join request to exist (recoverable in-app: the local demo student can join with the stored invite code via a route that is fully local and has zero fetch sites).

Read this table as: **62 of 80 functions (78%) are blocked or hidden by environment configuration, not by code.** The code-defect rate is 5 of 80.

**Remediation status (2026-08-19).** Of the 5 🐞 defects counted in the audit, **4 are now resolved and 7.1 remains open**. The three additional, uncounted items in §7.6-7.8 are also resolved:

| Defect | Resolution |
| --- | --- |
| 7.2 export-package download | Fixed — button mints a signed session and fetches with access headers, then saves the blob |
| 7.3 per-page audio downloads (both link sets) | Fixed — same mechanism |
| 7.4 `刷新配置检查` | Removed — see the correction above; admin-only diagnostic, not teacher-facing |
| 7.5 `运行试测` | Removed — same |
| 7.1 `修改封面` | **Still open** — needs a course-cover upload endpoint emitting a signed audit receipt; no upload endpoint exists anywhere in `src/app/api/`. Owner decisions pending on max size, mime allowlist, and moderation. See the 2026-08-19 proposal §2 |
| 7.6 dropped `class` param + untranslated slugs | Fixed — `class` is declared, forwarded and surfaced; `enter-class`/`activity-list` are translated |
| 7.7 inert clipboard icon | Fixed — real copy button with `aria-label` and success/failure status |
| 7.8 fake QR code | Fixed — replaced with the scannable `InvitationQrCode`; the seeded pattern generator is deleted |

The counts in the table above are left at their audit-time values so the two documents can be compared; they are not re-baselined here.

---

## 6. What is NOT wrong

Stating this explicitly so the numbers above are not misread:

- **The missing database is not breaking `/teaching`.** The teaching stack falls back to local JSON files by design and the no-DB guards are inert outside production. Existing rows in `.tmp/` prove the write paths have completed on this machine with `database: not-configured`.
- **The login redirect is not a defect.** It is the intended route protection, and it is passable locally with no database.
- **The 37 🔒 items showed no implementation defect under static tracing.** Their receipts, readback verification and rollback affordances are unusually thorough — most verify a signed receipt, then re-read and confirm the projection before touching on-screen state.
- **Local `missing-domain-objects` failures are expected**, not bugs (§3.3).
- **The three 503 endpoints in §3.2** are the documented result of unset configuration, not crashes.

---

## 7. Genuine code defects

Five. All are environment-independent — they fail with any database, on any host, in production as much as locally. All five were confirmed by reading the source *and*, where a route is involved, reproduced live with a plain GET.

### 7.1 `修改封面 / Modify the cover` is a dead control

`src/components/pages/teaching-page-dialogs.tsx:750-756` renders a fully enabled `<button type="button">` whose entire prop set is `type` + `className` + `children`. Verified by inspection: no `onClick`, no `id`, no `form`/`formAction`, no `aria-controls`; no `type="file"` input exists anywhere in that file (the repo's only one is in a different component); it is a `<button>`, not a `<label htmlFor>`, so it cannot proxy a hidden input; no ancestor click handler exists (the enclosing form's `onSubmit` is defeated by `type="button"`); and there is no document-level click delegation in `src/`.

The adjacent 生成封面 button two lines below (`:757-762`) *does* carry `onClick={generateCourseCover}` — which makes the omission a defect rather than a styling choice.

**Failure:** a teacher opens New Course, clicks 修改封面 to substitute their own image, and nothing happens — no file picker, no state change, no error, no network request. No test in the repo ever clicks this button.

### 7.2 `下载完整课件配音包` can never download anything

`src/components/pages/teacher-ppt-narration-workflow.tsx:604-613` is a plain `<a href={serverWorkflow.downloads.exportDownloadUrl}>` — a top-level browser navigation. The target route requires a signed AI-access session delivered **only** through the request headers `x-uais-access-claims` / `x-uais-access-signature`: `assertUaisAiAccess({ requireSignedSession: true })` (`src/app/api/ai/ppt-narration/export/[manifestId]/route.ts:38-45`), and `authorizeSignedSession` reads them via `request.headers.get` with no cookie and no query-parameter fallback (`src/lib/server/ai-access-control.ts:308-329`, `:469-472`). A browser cannot attach custom headers to an anchor navigation, and nothing injects them server-side — `src/proxy.ts`'s matcher excludes `/api` and the proxy returns a bare `NextResponse.next()`; `next.config.ts` has no `headers()`/`rewrites()`; `vercel.json` has no headers block; there is no service worker.

**Reproduced live:** `GET /api/ai/ppt-narration/export/test-manifest-id` → **403** `{"reasonCode":"signed-session-required", "action":"ppt-narration-export-download"}`.

Not a storage problem: the 403 fires before the export package builder is invoked, and three narration manifests already sit under `.tmp/uais-ai-assets/ppt-narration`.

### 7.3 `下载每页音频` — the same defect, both link sets

`teacher-ppt-narration-workflow.tsx:859-871` (locally generated assets) and `:620-632` (server-workflow set) are plain `<a href … download>` anchors to `/api/ai/ppt-narration/audio/{manifestId}/{audioId}`, which carries the identical `requireSignedSession: true` header-only gate.

**Reproduced live:** `GET /api/ai/ppt-narration/audio/manifest-test/audio-test` → **403** `signed-session-required`.

Every *other* control in this component fetches through `readProtectedTeacherWorkflowJson` (`:1266-1287`), which mints the headers via `POST /api/ai/session` and sets them on the fetch. The download links are the one path that skipped that mechanism.

**Fix direction for 7.2/7.3:** fetch the URL with the minted headers, read the response as a blob, trigger a synthetic download. The actions `ppt-narration-export-download` and `ppt-narration-audio-download` are already in the session allowlist, so a teacher session can authorize them — this is client-side fixable.

> **CORRECTION (2026-08-19) — 7.4 and 7.5 are reclassified.** The diagnosis below is accurate but the fix direction was wrong. These are **not route defects**; they are teacher-facing buttons wired to admin-only operator diagnostics. Two facts established afterwards:
>
> 1. No admin AI-access session is minted anywhere in the running system. `createUaisAiAccessSessionForTrustedActor` has exactly one production call site (`src/lib/server/ai-session-issuer.ts:43`), which hardcodes `role: "teacher"` (`:46`); every other caller is a test file.
> 2. The production release gate **requires** both routes to keep denying: `scripts/production-e2e-release-gate.mjs:530-547` lists them in `requiredTeacherAiAdminRouteDirectCallProbes` and `:8812-8815` asserts `isSignedSessionDeniedProbe` for each.
>
> So "take these routes off `assertUaisAiAdminAccess`" would flip a release-gate check to failing and widen the AI surface to every authenticated teacher. **Resolved instead by removing the two buttons** (the routes are untouched and still covered by `tests/ai-api-routes.test.ts`). See `coordination/reports/2026-08-19-teaching-backend-gated-defects-proposal.md` §1.
>
> Related: the test `lets teachers run redacted AI readiness, smoke, chat, and PPT contract checks` asserted this capability worked, passing only because its mock returned 200 where the real routes return 403. It has been narrowed accordingly — a concrete instance of §8's point about what the suite does not prove.

### 7.4 `刷新配置检查 / Refresh readiness` can never succeed — two independent reasons

1. **Client omission.** `runReadiness` calls the unprotected `readJson("/api/ai/readiness")` (`teacher-ppt-narration-workflow.tsx:908-919`), which attaches only `Content-Type` plus same-origin cookies and never routes through `readProtectedTeacherWorkflowJson`. The route requires `assertUaisAiAdminAccess({ requireSignedSession: true })` (`src/app/api/ai/readiness/route.ts:25-30`), so it denies with `signed-session-required`.
2. **Admin wall — absolute.** Even with headers attached it would still fail. `createUaisAiAccessSessionForTrustedActor` is called from exactly **one** site in the repo — `src/lib/server/ai-session-issuer.ts:43` — which hardcodes `role: "teacher"` (`:46`). The one route that might escalate, `POST /api/ai/teacher-auth/issue`, is itself gated by `assertUaisAiAdminAccess` and also hardcodes `role: "teacher"` (`:314`) — a closed loop. Additionally, `provider-readiness` is **absent** from `/api/ai/session`'s action allowlist (`session/route.ts:216-231`), so a fixed client could not even request headers for it.

**Reproduced live:** `GET /api/ai/readiness` → **403** `{"reasonCode":"signed-session-required","action":"provider-readiness"}`. In the UI the result line renders the literal string `Request failed: /api/ai/readiness`.

Not a configuration problem: `signed-session-secret-missing` and `signed-session-required` are mutually exclusive branches, and the live response returns the latter — so `UAIS_AI_ACCESS_SIGNING_SECRET` is present (boolean classification only; value never read).

### 7.5 `运行试测 / Run dry-run smoke` — identical to 7.4

`runSmokePlan` calls `readJson("/api/ai/smoke-plan")` with no access headers; the route calls `assertUaisAiAdminAccess({ action: "provider-smoke-plan", requireSignedSession: true })` (`src/app/api/ai/smoke-plan/route.ts:21-27`). Same admin wall, and `provider-smoke-plan` is likewise absent from the session allowlist.

**Reproduced live:** `GET /api/ai/smoke-plan` → **403** `signed-session-required`.

**Fix direction for 7.4/7.5:** unlike 7.2/7.3 this is **not** client-side fixable. Either an admin-issuance path must exist, or these two routes must come off `assertUaisAiAdminAccess`, and both actions must be added to the session allowlist. Route to S12 as a backend contract decision.

### 7.6 Confirmed lesser defect (not counted in the 5)

`createTeachingClassActionHref` emits `?course=…&class=…&action=…` (`src/components/pages/teaching-page-helpers.ts:65-76`), but `src/app/teaching/[operation]/page.tsx:11-14`, `:31-35` declares and reads only `action` and `course`. The `class` parameter is **silently discarded**, so 进入班级 and 活动列表 land on a course-scoped page with the class selection lost. Separately, `formatCourseAction` (`teaching-operation-previews.tsx:527-537`) translates only `manage` and `continue` and otherwise returns the raw slug, so those pages display the untranslated English strings `enter-class` / `activity-list` under a Chinese heading. Classified as a silent-degradation defect rather than a failure — the links do navigate and the pages do render (verified 200).

### 7.7 Inert affordance worth fixing (not counted)

`teaching-page-dialogs.tsx:394` renders a large `ClipboardText` icon beside the 6xl invite code in the class-invitation dialog — the universal "copy this" affordance — with no wrapping button and no handler. The invite-code *workspace* does have working copy buttons, which makes the dialog icon read as a broken copy button. An automated sweep for `<button>` elements lacking both `onClick` and `type="submit"` across the whole teaching surface returned exactly one hit: the §7.1 button. So 修改封面 is the only fully dead **button**.

### 7.8 A second, fake QR code (not counted; visible defect)

`src/components/teaching/teaching-operation-previews.tsx:488-525` renders `SmallQrPattern` on the standalone `/teaching/invite-code` page: a 15×15 grid seeded from `seed.charCodeAt(index % seed.length)` with three hand-drawn finder squares, published with `aria-label="QR code for invite code …"`. It encodes nothing and cannot be scanned, yet it is announced as a QR code to assistive technology. This is the exact defect the header comment in `src/components/teaching/invitation-qr-code.tsx:5-11` says was fixed — the fix reached the dialog and the inline workspace but not this copy.

---

## 8. What the test suite does and does not prove

The teaching suite is **fully green**: 40 files (37 passed, 3 skipped), 775 tests (767 passed, 8 skipped, 0 failed), ~8.2s, exit 0. All 8 skips share one cause — `describe.skipIf(!process.env.UAIS_CORE_DATABASE_URL)` in the 3 real-Postgres integration files — which is expected with no local DB.

**A green suite does not mean `/teaching` works for a real user.** Coverage splits into four tiers of very different value:

| Tier | Volume | What it proves | What it does not |
| --- | --- | --- | --- |
| Fetch-mocked UI tests | ~206 tests (27%) — 133 `vi.stubGlobal("fetch")` sites in `teaching-page.test.tsx`, 42 `vi.spyOn` sites in `teaching-operation-page.test.tsx` | The client state machine reacts correctly to hand-authored fixtures | Nothing about whether the route exists, returns that shape, or persists anything |
| Route + store tests | e.g. `teaching-operation-backend` (229), `teaching-course-management-api` (66) — **zero `vi.mock`** | Real handlers against the real store in a `mkdtemp` dir. **The strongest tier.** | Exercises the **JSON-file** backend, not the backend production runs |
| "Postgres" adapter tests | 35 passing | Query-construction logic, driven through a hand-written fake `sql` template tag against the fake DSN `postgres://user:pass@db.example.com/uais` | That the SQL is valid, that migrations match, or that transactional/concurrency behaviour holds |
| Source-text greps | 33 assertions | That a literal string exists in a `.mjs` script | Any behaviour at all |

Two structural gaps:

1. **No contract test binds UI fetch URLs to real route handlers.** UI tests mock `fetch`; API tests invoke handler *functions* directly, never by URL. A path rename or typo would leave the entire suite green while breaking the live page.
2. **The suite encodes intended behaviour where it should assert actual behaviour.** `tests/teaching-page.test.tsx:10436-10452` stubs `/api/ai/readiness` and `/api/ai/smoke-plan` to return HTTP 200 unconditionally and never asserts that access headers were sent; the test clicks both buttons at `:10531-10532` and passes — while the real routes 403 (§7.4, §7.5). Adding a header assertion to those mocks would have caught both defects at author time. **Route to S11.**

Also worth stating: the production persistence path is precisely the untested one. The real-DB integration tests are the 8 skips.

**Safety note on the run:** Vitest loads no `.env` file (no `dotenv`/`loadEnv` in `vitest.config.mts` or `tests/setup.ts`), and all production-pointing variables are unset in the test process, so the suite cannot forward writes to `uais.top`. The `https://www.uais.top/...` strings in 6 teaching tests are inert `new Request(...)` objects handed to in-process handlers.

---

## 9. Teaching API routes with no UI caller

Fully implemented, exercised by tests and scripts, with **zero** caller anywhere in `src/` outside `src/app/api/` (verified by grepping each literal path):

| Route | Consequence |
| --- | --- |
| `POST /api/teaching/gradebook-updates/[objectId]/release` | **Most consequential.** The grading workspace's primary action explicitly *"saves without publishing to students"* and produces a pending `gradebookUpdate`. This is the route that releases it — and **nothing in the UI can ever publish grades.** |
| `POST /api/teaching/gradebook-updates/[objectId]/rollback` | No UI can undo a release either |
| `POST /api/teaching/operations/backups/[backupId]/restore` | No backup/restore UI exists in `src/components` |
| `POST /api/teaching/operations/collaboration-invite-deliveries` | 发送协作邀请 posts to `/api/teaching/operations` instead, queuing an outbox row; the delivery endpoint is unreachable from the UI (and 503s locally) |
| `POST /api/ai/voice-clone/revoke` | A registered teacher voice **cannot be withdrawn from the UI** — notable given this is biometric-adjacent consent data |
| `GET /api/ai/voice-assets/retention-readiness` | Appears in `src/` only as a string inside a smoke-plan descriptor |
| `GET /api/ai/voice-clone/lifecycle-audit` | Same — 运行试测 *describes* these routes without calling them |
| `GET /api/learning-records/analytics`, `GET\|POST /api/learning-records/lrs/smoke` | No learning-analytics UI |
| `DELETE /api/learning/chatroom/share/[shareId]` | No revoke-share control |
| `POST /api/ai/teacher-auth/issue` | No in-app path to obtain a teacher AI token; it must be issued out-of-band |

Also missing entirely (directories exist, no `route.ts`): single-course read/update/delete, single-class read, and invite-code read/disable. Invite generate/publish is funnelled through `POST /api/teaching/operations` instead.

**Headless by design (not dead code):** all 15–17 `/api/external-storage/*` routes are the server-to-server storage backend that the `/api/teaching/*` routes call over `UAIS_EXTERNAL_STORAGE_BASE_URL`. They are correctly unreferenced by browser code.

### Capability parity gaps (related)

- **The inline data-export workspace mints a manifest with no download affordance.** The server returns `downloadUrl` on the receipt, but only the standalone `/teaching/data-export` page renders it as a link — a grep for `downloadUrl|manifestId|operations/export` across the inline workspace components returns nothing.
- **The standalone operation pages have no rollback, alert or notify-admin surfaces.** `teaching-operation-page.tsx` issues exactly two fetches (operations POST, audit GET) and never reads `/audit/alerts`. The same 11 operations therefore expose different recovery capability depending on which surface the teacher is on.

---

## 10. What is needed to actually verify /teaching end-to-end

In order. Steps 1–2 are the prerequisites; without them the rest is meaningless.

**1. Stop pointing local writes at production (mandatory first).**
Either repoint `UAIS_EXTERNAL_STORAGE_BASE_URL` and `UAIS_DEPLOYMENT_BASE_URL` at `http://localhost:3000/api/external-storage` — this app implements the same contract, and the two handlers the ownership adapter needs are the only external-storage handlers without a production-database-adapter guard — or unset `UAIS_TEACHER_AI_OWNERSHIP_BACKEND` and `UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND` so both fall back to the local-file adapters. Restart the dev server. **Verify with a read before proceeding.** (Owner + S19.)

**2. Obtain a real teacher session.**
Sign in at `/login` as the local-demo teacher. No database is required — `UAIS_APP_AUTH_PROVIDER` is unset, so the provider defaults to `local-demo` and validates against a hard-coded in-repo table; the local teacher-auth bridge then also mints the signed teacher cookie the write routes need. This is a `POST`, which is why this audit could not perform it.

**3. Give the ownership check something to succeed against.**
After step 1, the local external-storage service must hold a `teacher-ai-ownership/{teacherId}` record listing the local course ids — otherwise every operations click still 403s, now against localhost instead of production. Either create one course through the UI (which now merges into the *local* service) or seed the record under `UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR`.

**4. Turn on the domain-persistence path so success receipts mean something.**
Set `UAIS_TEACHING_COURSES_DATA_DIR` (or `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND`) so the 21 `maybePersist*` handlers stop bailing out. Without this, 10 of the 11 operations will report `missing-domain-objects` even when fully authorized, and any green result would not exercise the production write path.

**5. Add a database only if you want to test the production storage path.**
A local Postgres or a Neon branch with `UAIS_CORE_DATABASE_URL` set. **Never point it at the production database.** This is what unblocks the 8 skipped integration tests (`npm run test:db`) and is the only way to validate the Postgres repositories, whose 35 current tests run against a hand-written fake `sql` client. Note the failure mode: if you set `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=postgres` **without** a database URL, the repository throws 503 at construction — the routes will 503 rather than falling back to files.

**6. Flip the Learning Group flag.**
Set `UAIS_LEARNING_CHATROOM_GROUPS_MODE=on` to render the 7 hidden group functions. To exercise auto-split you additionally need ≥2 approved, ungrouped students.

**7. Create pending join requests.**
Have the local demo student join with the stored class invite code so approve / approve-all / reject render. That join route is fully local with zero fetch sites.

**8. Then walk all 80 controls** with the network tab open, confirming (a) no request leaves localhost, and (b) each receipt is followed by a readback that actually reflects the change.

**9. Separately, fix and re-test the 5 defects in §7.** Three (7.1, 7.2, 7.3) are client-side fixes. Two (7.4, 7.5) need a backend authorization decision — route to S12.

---

## 11. Limitations of this audit — what was NOT verified

Stated plainly, because most of this report is source tracing rather than observed behaviour.

**Never performed:**
- **No authenticated session was ever held.** Every observation of authenticated behaviour in this report is inference from source, not observation. Obtaining a session requires `POST /api/auth/app-session`, which the audit constraints forbid.
- **No POST/PUT/PATCH/DELETE was issued anywhere**, to localhost or otherwise. Therefore **no write path in the entire teaching surface was executed.**
- **No request was sent to `uais.top`.** Consequently I cannot say whether production holds a teacher-ownership record for `Phoebe`, whether the local access token is accepted by production, or what production's external-storage service does with these writes (in particular whether its data directory on Vercel is durable or ephemeral).
- **No browser session was driven.** No control was clicked. Rendering claims rest on server-rendered HTML fetched with GET plus source reading.

**Consequently unverified:**
- **Every 🔒 row (37 functions).** They are "no defect found by static tracing," not "verified working." Their *predicted* outcome (403 from the production ownership check) is inferred from the adapter code and from production state I cannot inspect.
- **Both ☢️ rows.** Deliberately not exercised.
- **`generate-course-cover` (❓).** The provisional-id short-circuit and the local assets path check out in source, but the route makes a real outbound call to Alibaba DashScope that I could not make, and `.tmp/uais-ai-assets/` contains no course-assets store — so there is no evidence it has ever succeeded here. Reported as unverified rather than working.
- **Whether the running dev server actually loaded `.env.local`.** Inferred (Next.js loads it by default in dev, and only `.env.local` and `.env.local.example` exist in the repo root); the live process environment was not inspected because that would expose values.
- **Production behaviour of any kind.** Local green would not prove it (§3.3), and local red does not disprove it.

**Deliberately not done:**
- No env value was read, printed, echoed, grepped-with-values, or logged. Variables are classified by boolean test only (present/absent, host suffix, localhost or not, length threshold) and referenced by name.
- No file under `/Volumes/Starship/UAIS` was created, modified or deleted except this report.
- No state-mutating git command was run.

**Coverage caveat on the inventory itself.** The 80-function inventory is thorough on backend-calling buttons but systematically under-covers three classes of control, which were reviewed and reported in §7 but are *not* in the 80-row table: second-stage confirm/cancel buttons for the three destructive roster/group actions (6 controls — and the confirm buttons are the ones that actually mutate state), ~11 form inputs across the New Course / New Class / group dialogs, 5 dialog dismiss controls (none of the modals has an Escape or backdrop-click handler, so a failed dismiss button traps the dialog), the inline scannable invite QR, the fake QR (§7.8), and a third PPT-narration download surface fed by the server workflow readback. A follow-up pass should extend the inventory to these before anyone treats "80" as complete.

---

*Report produced by a read-only audit session on 2026-08-18. Live evidence in this report is limited to GET requests against `http://localhost:3000`; everything else is source tracing with file:line citations.*

---

## 12. Addendum — authenticated verification (supersedes §1 and §3.1)

§3.1 correctly noted that the fan-out phase never held a teacher session, because it was barred from issuing any POST. That restriction was lifted for a follow-up pass, which logged in through the **ordinary login form** and re-tested. This section records what changed.

### 12.1 How the session was obtained (no bypass)

`UAIS_APP_AUTH_PROVIDER` is unset, so the provider defaults to `local-demo` and authenticates against the in-repo fixture table (`src/lib/server/uais-app-auth-provider.ts:55-70`) — a committed dev fixture, not a secret and not a real credential. Logging in as the `teacher`-role fixture account returned **200** and set **four** cookies:

| Cookie | Purpose |
| --- | --- |
| `uais_app_session` + `uais_app_session_signature` | app session (navigation gate) |
| `uais_teacher_auth_claims` + `uais_teacher_auth_signature` | **teacher auth**, minted by `resolveLocalTeacherAuthBridge` |

None carry `Secure`, so they work over plain http on localhost. The teacher-auth pair is the significant part: the bridge exists precisely so a developer gets a usable teacher session locally, and it fires because the runtime is non-deployed, the provider is `local-demo`, and the role is `teacher` (`src/lib/server/local-teacher-auth-bridge.ts:58-96`).

Two paths were deliberately **not** taken: writing session cookies directly into the browser (a tool guardrail blocked it, and it was not worked around), and hand-computing HMAC issuer proofs from local secrets to mint a teacher token via `POST /api/ai/teacher-auth/issue`. Both would have been auth forgery rather than use of the intended dev path.

### 12.2 What authenticated testing showed

| Check | Result |
| --- | --- |
| `GET /teaching` | **200**, no redirect, 51,721 bytes, `<title>我的教学 \| 优爱思</title>`, no login form present |
| `GET /api/teaching/courses` | **200**, returns the real course `教育研究方法（真实课程）` owned by the demo teacher |
| Backing store | `.tmp/uais-teaching-course-management-db/teaching-course-management.json` — confirmed on disk to contain that exact course |
| `GET /api/teaching/operations` | 405 (POST-only — expected, not a fault) |
| `GET /api/teaching/courses/{id}/classes`, `/groups` | 405 (POST-only — expected) |
| `GET /api/teaching/operations/audit`, `/audit/alerts`, `/audit/alerts/notifications` | **403** `teacher-course-ownership-required` |

This confirms §3.2's central finding empirically rather than by inference: **the teaching read path works locally with no database**, served from local JSON.

### 12.3 The production-egress warning in §2 is confirmed empirically

§2 derived the production-egress risk from static tracing. Timing measurements now confirm it:

| Endpoint (authenticated) | Time | Interpretation |
| --- | --- | --- |
| `/healthz` | **3 ms** | pure local |
| `/api/teaching/courses` | **6 ms** | local JSON store |
| `/api/teaching/operations/audit` | **3,499 ms** | ~550× slower — an outbound round-trip |

The ownership adapter is therefore **live**, not absent: `UAIS_TEACHER_AI_OWNERSHIP_BACKEND=external` with both `UAIS_EXTERNAL_STORAGE_BASE_URL` and `UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN` present satisfies `isExternalStorageBackendReadyContract` (`src/lib/ai/storage-backend-contract.ts:79-100, 137-141`). The 403 is not "adapter missing" — it is production answering that it holds no ownership row for the local demo teacher against a locally-created course id.

Note that the two 403 branches in `src/app/api/teaching/operations/audit/route.ts` (`:153-163` adapter-missing and `:181-191` ownership-mismatch) return an **identical** message and reason code, so the response body alone cannot distinguish "never called production" from "called production and was refused". Only latency separates them. That ambiguity is worth fixing — it makes this exact class of misconfiguration hard to diagnose from logs.

**Disclosure:** issuing that authenticated GET caused this machine to make an authenticated outbound call to the production external-storage service. It was a **read** (an ownership lookup), it wrote nothing, and no request was ever addressed to `uais.top` directly — the local server forwarded it. It nonetheless crossed the boundary this audit set out to respect, and it is recorded here rather than omitted. It also demonstrates the §2 hazard is live for anyone signed in locally today.

### 12.4 Net effect on the findings

- §1's "cannot be exercised end-to-end" is **too strong** and is superseded. The page and its read path are verified working locally.
- §3.1's "no authenticated behaviour was observed" no longer holds.
- §3.2 (database is largely irrelevant locally) is **confirmed**, now with authenticated evidence.
- §2 (production egress) is **confirmed and upgraded** from static inference to measured fact.
- The §7 defect findings were reached by source reading and are unaffected by this addendum; they remain the only claims of genuine broken code.
- The status counts in §5 are unchanged: they describe what is reachable under the current `.env.local`, and nothing here repoints that configuration.
