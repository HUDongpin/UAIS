# Lesson Learning and Teaching Pages — Readiness Survey and First Fixes

- Date: 2026-08-09
- Requested by: Dr. Peter Hu ("what are the best next steps so the Learning and Teaching pages run smoothly and right")
- Method: read-only multi-agent survey of `/learning`, `/learning/chatroom`, `/teaching`, `/teaching/[operation]`, their API routes and runtime env surface, plus live execution of the quality gates
- Scope of code changes in this session: two fixes, both listed in §4. Everything else in this report is a recommendation, not an applied change.
- Sessions touched: S04/S12 (chatroom share flag reader), S05/S13 (teaching operation page), S11 (three added regression tests)

---

## 1. Summary

Both pages are healthy at the code level. Every gate passes on the current tree, including the `npm run build` that was still owed on the share/external-storage work:

| Gate | Result |
| --- | --- |
| `npm run lint` | Pass (exit 0, no errors or warnings) |
| `npx tsc --noEmit` | Pass (exit 0) |
| `npm run test` | **2298 passed**, 5 skipped, 175 files, 36.7s |
| `npm run test:critical` | 98/98 passed |
| `npm run build` | **Compiled successfully in 12.4s**, 23/23 static pages, all routes registered |

What stands between "gates green" and "runs smoothly and right" is therefore **not** broad code quality. It is three functional gaps (§3), a set of environment decisions the owner still owns (§5), and a polish backlog (§6).

**One coordination note.** During this session another chat committed the in-flight share/external-storage slice as `80f377f feat(chatroom): give share links a durable storage backend` (12 files, +789). Release blocker **B1 is now committed, not just in flight**. The build gate reported above was run *after* that commit and covers it, including the new `/api/external-storage/learning-chatroom-shares/database` route. The recommendation in the prior report to have S25 slice and commit this work is now satisfied.

---

## 2. What each page actually needs at runtime

Recorded here because most "the page is broken" reports on these two surfaces turn out to be environment shape, not defects.

**Local dev (`npm run dev`) needs zero environment variables** for both pages to render and authenticate. `UAIS_APP_AUTH_PROVIDER` defaults to `local-demo` (Phoebe = teacher, Peter = student), the session signer falls back to a dev-only secret outside deployed runtimes, and every store defaults to local JSON under `.tmp/`.

- The only hard dependency for a **full chatroom round** is `DEEPSEEK_API_KEY`; without it `POST /api/learning/chatroom` answers 503. History reads still work.
- On a **fresh checkout the student side is denied** until data exists: chatroom authorization requires an approved membership record. Sign in as Phoebe, create the course/class/membership (and a learning group) through `/teaching`, then sign in as Peter.
- **Group rooms require `UAIS_LEARNING_CHATROOM_GROUPS_MODE` set to the exact literal `on`.** `true`, `1` and `yes` all leave groups off by design.
- **Verify through `npm run dev`, never `npm run start`.** Any production-classified runtime — `NODE_ENV=production`, `VERCEL_ENV=production`, or `UAIS_DEPLOYMENT_ENV=production`, which includes a local `next start` — makes every local-JSON store refuse with 503. Because chatroom authorization reads the course store, the chatroom and all teaching CRUD go down together. This is the documented fail-closed behaviour, not a regression.
- **Postgres is not needed** by either page in dev. It is required only by `npm run vercel-build`, which runs `db:migrate` before `next build` and exits 1 without `UAIS_CORE_DATABASE_URL` / `DATABASE_URL` / `POSTGRES_URL`.

---

## 3. Functional gaps, highest value first

### 3.1 Teaching writes are unreachable from the UI — **RESOLVED 2026-08-09**

> Decided and implemented the same day: a local-runtime-only login bridge mints the signed teacher session, with no development fallback for the signing secret. See `coordination/reports/2026-08-09-nonproduction-teacher-auth-login-bridge-decision.md`. The description below is retained as the problem statement.


Every teaching mutation requires the HMAC-signed teacher cookie pair verified with `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET`: create course, create class, approve membership, `POST /api/teaching/operations`, the audit readback, and course-cover. `/login` issues only the app-session cookie, which is accepted by exactly one endpoint — `GET /api/teaching/courses`, via its `readAuthenticatedAppSessionTeacher` fallback.

The only mint path for the signed cookie is `POST /api/ai/teacher-auth/issue`, which itself requires trusted-issuer proof headers or an OIDC bearer token, and **no client component calls it** — the only in-repo references are in a smoke plan. So a teacher who signs in through the UI can list courses and then fails 401 on every write, in dev and production alike.

This is the single biggest obstacle to `/teaching` "running right" and it is an owner/S12 architecture decision, not a bug fix. Options: bridge login to teacher-auth issuance for teacher-role accounts in non-production behind the existing provider contract, or document the approved external issuer flow and add a dev seeding script. It pairs with the existing `tests/owner-decision-teacher-auth-response-*.test.ts` decision packets.

Adjacent and worth solving in the same package: teaching operations additionally 403 with `teacher-course-ownership-required` until a per-teacher ownership record exists. Records are only created as a side effect of course creation, so the **static demo courses are never operable** — a new user reads this as a permissions bug. A dev-only seed for the `.tmp` course-management store fixes both confusions in one step.

### 3.2 `/teaching/[operation]` lost course context on navigation — **fixed in this session, see §4.2**

### 3.3 The Learning ask-box fails whenever AI env is partial — **open, S03/S07/S19**

The main ask-box on `/learning` always sends mode `multi-agent`. That branch requires **both** `DEEPSEEK_API_KEY` and `DASHSCOPE_API_KEY`, and in a production runtime also LangGraph external persistence, or it 503s. The user sees only the generic "AI service is temporarily unavailable" copy, while the three agent cards (single-agent mode) may still work with one key — so the page looks half-broken for an environment reason nothing on screen explains.

Recommended: fall back to single-agent when the multi-agent chain 503s, or emit a distinct "not configured" message; and add the three names to the S19/S22 release env checklist.

---

## 4. Fixes applied in this session

Both changes are additive, sit inside the owning sessions' file scopes, and are covered by tests. Full gate results in §1 were produced **after** these edits.

### 4.1 Chatroom groups flag — one reader again (S04/S12)

`src/lib/server/learning-chatroom-groups-flag.ts` documents that every surface must read `UAIS_LEARNING_CHATROOM_GROUPS_MODE` through `isLearningChatroomGroupsEnabled`, because "duplicating the comparison would let the API and the UI disagree after a single typo."

The share work committed in `80f377f` had forked that comparison twice:

- `src/app/api/learning/chatroom/share/route.ts` defined a private `isLearningChatroomGroupsModeEnabled`;
- `src/lib/server/learning-chatroom-share-view.ts` defined a **second** private copy while the same file already imported the canonical reader and used it 100 lines earlier — so the share page was gated by the canonical reader and the export document by the private copy.

Both private copies are removed and both call sites now use the canonical import. `grep` confirms no `isLearningChatroomGroupsModeEnabled` remains anywhere in `src/` or `tests/`. Behaviour is unchanged today (the three implementations were byte-identical); what changes is that a future edit to the flag semantics can no longer half-apply.

Files: `src/app/api/learning/chatroom/share/route.ts`, `src/lib/server/learning-chatroom-share-view.ts`.

### 4.2 Teaching operation pages keep their course context (S05/S13)

`POST /api/teaching/operations` denies any request without a `courseId` (`course-id-required` → 400). The operation sidebar built its links with a bare `getTeachingOperationHref(item.id)` and no query, so **navigating between operation pages dropped the course** the teacher arrived with, and every action on the destination page was then guaranteed to fail. The page compounded this by captioning the state "Course scope: All courses", implying the actions were valid, and by reporting the failure with the generic "sign in again or check course permissions" message — the wrong instruction, since the fix is to re-enter from a course card.

Three changes:

1. **New `getTeachingOperationHrefWithCourse(operationId, courseId?)`** in `src/components/teaching/teaching-operation-data.ts`, used by the sidebar. The course travels; the `action` slug deliberately does not, because it names the card that opened the *first* page, not the sibling the teacher moved to.
2. **Honest scope line.** With no course: "未选择课程：教学操作需要课程上下文。" / "No course selected: teaching operations need course context." A persisted course that is not in the static catalog now shows its id instead of claiming "all courses", so a teacher can see that context was carried.
3. **Precise failure message.** `TeachingOperationBackendResponse` gained the `access.reasonCode` field the server already sends, and `course-id-required` now maps to "未保存到服务器：缺少课程上下文，请从课程卡片进入。" / "Not saved to the server: course context is missing. Please enter from a course card." — matching the wording the inline workspace already uses for the same condition. All other failures keep their existing message.

Files: `src/components/teaching/teaching-operation-data.ts`, `src/components/teaching/teaching-operation-page.tsx`.

**Tests added** (`tests/teaching-operation-page.test.tsx`, +3 cases): all eleven side-menu links carry `?course=` and none carry `action=`; links stay unscoped and the honest copy renders when no course was supplied; a `course-id-required` 400 shows the course-context message and *not* the generic sign-in message. The no-course path was previously untested — every existing case passed a `selectedCourseId`.

**Verification note.** The rendered result was not walked in a browser: `/teaching` is proxy-gated and its login form requires an account password, which I am not permitted to enter. The behaviour is proven by the three new tests asserting exact `href` strings and copy, plus `npm run build`.

---

## 5. Production path — owner decisions, not code

Condensed from `coordination/reports/2026-08-08-chatroom-groups-flag-on-smoke-and-release-readiness.md` §5, updated for today:

| Blocker | State |
| --- | --- |
| **B1** share backend | **Closed and committed** (`80f377f`), build gate now run |
| **B2** external storage env | **Resolved.** Chatroom transcripts and share links now persist to the managed Postgres the deployment already requires (`UAIS_CORE_DATABASE_URL`, `active-production: required`), via `migrations/0003_learning_chatroom.sql` and two stores mirroring the twice-used `teaching-*-postgres-store` pattern. In a production runtime with a core database and no storage-specific configuration, the durable backend now resolves to `postgres` — the exact state that used to answer 503. An explicit `external` or `postgres` selector still wins, and local JSON is still refused in production, so nothing that works today changes. |
| **B3** transcript schema v2 | **Resolved.** On the default Postgres path there is no separately versioned service, so nothing can predate v2 — the preflight reports B3 `not-applicable`. A deployment that deliberately chooses `external` still gets a real check: the service declares `learningChatroomStorageSchema` on `/healthz` (transcripts v2 accepting v1, shares v1), so compatibility is settled before the first write rather than discovered as a rejected round. Verified live against the real route in both directions. |
| **B4** flag parity | **Resolved as a failure mode.** A set-but-not-`on` value no longer fails silently: the single reader logs a structured warning once per distinct wrong value per process, naming configured and expected values, and the preflight blocks on it before a flip. Setting the literal `on` is the one irreducible operator action — no code can decide that a feature should be live. |
| **B5** rate limits | Accepted for launch — limiters are per serverless instance |

Two further decisions the runtime survey surfaced, which are not in the B-list and should be:

- **`UAIS_APP_SESSION_SIGNING_SECRET` must be set in every deployed lane.** When it is unset the proxy silently degrades to an optimistic cookie-pair check, and a forged pair passes the navigation gate. Treat a missing value as a release blocker.
- **The auth provider mode must be chosen**: trusted-account-provider (with its URL and token) or an explicit acceptance of demo auth in production via `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH`. Otherwise production logins are blocked outright.

Promotion gate once those are set: `npm run journey:smoke -- --base-url <target>`. No Vercel deployment smoke has ever run — there is still no owner-assigned credential source.

---

## 6. Polish backlog

Ordered by user-visible impact. None block a dark-flag release.

1. **`/learning` is a light-theme island** — the whole playback workspace uses literal light hex colours while the shell and the chatroom next door use the CSS-variable tokens, so dark-theme users get a dark header wrapped around a light page. S06 with S03, or an explicit decision to document `/learning` as light-only.
2. **Multi-course teachers can only edit their first course** — `selectedCourseAction` in `use-teaching-workspace.tsx` is declared with no setter and no writer, so it is permanently undefined and every inline operation targets `courseCards[0]`. S05.
3. **Two drifting implementations of the same eleven operations** — the inline workspace and the `[operation]` page each re-implement the projection/receipt verifiers, and they have already diverged on sidebar navigation, course resolution and invite class targeting. One extraction package, S05 with S13; not piecemeal edits.
4. **Signed-out `/learning` shows "Sign in again"** on a first visit, with no sign-in link, because the playback fetch fires unconditionally on mount. S03/S09.
5. **Unauthenticated `/teaching` echoes a raw English server string** under a bilingual heading, with no link to `/login`. S09 with S05.
6. **en-US labels the code-assistant card "Teaching TA"** while the server persona and the zh-CN card are both the code assistant, so English users get a classroom prompt answered by a code persona. S09 with S03.
7. **Class-manager deep links pass `class` and action slugs the operation route drops** — `enter-class` / `activity-list` render untranslated. S05; adjacent to §4.2 and deliberately left out of it to keep that change reviewable.
8. **Inert demo controls read as broken** on the `/learning` companion panel (subtitle search, static course directory, decorative close button) and on `/teaching` (dead "Modify the cover" button, decorative fake QR, hardcoded invite validity date). Wire or visibly mark as preview-only.
9. **QA-matrix gaps G1, G2, G4, G8** are roughly ten small test additions in `tests/` only. G5 — the export print stylesheet hides the shell via `header.sticky`, coupling printed transcripts to S01's header with no pin — needs an S01/S22 decision. G9, the two-theme/two-locale browser walkthrough, has never been recorded. S11.
10. **Three hot files at or near the 1500-line lint cap**: `use-teaching-workspace.tsx` (~1576), `teaching-operations-store.ts` (1553), `external-storage-route-store.ts` (1542). Budget a decomposition before the next feature touches them, following the leaf pattern `external-storage-route-share-store.ts` already uses.

---

## 7. Accepted residuals — release notes, not defects

Carry these into operator-facing notes so they are not rediscovered as bugs:

- A throttled signed-out `/share` viewer receives a 200 HTML "try again later" page rather than a real 429; an App Router page cannot emit one. The storage reads are still skipped, so the protection is intact and only the status code is imprecise.
- **Agent providers are no longer a single point of failure.** Each chatroom agent names a preferred provider role and the room holds a completer for every role the deployment configured; a turn falls over to another configured provider when its own fails, is rate limited, or has no key at all. A round is refused only when NO provider is configured. Failover is charged against the same round budget, and the Qwen path carries a route-side timeout because that client takes none.

- The transcript PDF is ~1.4 MB because the GB2312-subset CJK face is embedded whole; runtime subsetting produces broken CJK, so build-time subsetting is deliberate. Characters outside GB2312 render blank.
- All rate limiters are in-process per serverless instance, so the effective limit is the configured value times the instance count.

---

## 8. Recommended next actions

1. **S12 / owner** — decide the teacher-auth bridge (§3.1). Nothing else on `/teaching` matters as much: today every write fails for a signed-in teacher.
2. **S12** — add the dev-only seed for the `.tmp` course-management store (course, class, approved membership, ownership record) so a fresh checkout can exercise both pages in one step.
3. **S19 / S22** — resolve B2 and B3, add `UAIS_APP_SESSION_SIGNING_SECRET` and the auth-provider decision to the env checklist, then run the flag-on smoke against preview before any production flip.
4. **S03 / S07** — make the ask-box degrade honestly when the multi-agent chain is unavailable (§3.3).
5. **S11** — land the G1/G2/G4/G8 test additions and fold today's gate numbers into the release-quality matrix.
6. **S06 / S03** — decide the `/learning` theming question (§6.1); it is the most visible remaining rough edge for a user who switches to dark mode.
