# Learning Chatroom Groups — CTO Execution Log

- Date: 2026-08-08
- Role: Fable 5 acting as CTO (key decisions, gating, orchestration)
- Engineers: Opus 5 agents, one per scoped work package
- Plan: `coordination/reports/2026-08-08-learning-chatroom-group-implementation-plan.md`
- Directive: owner instructed implementation of the plan in a multi-agent manner (Fable 5 CTO, Opus 5 engineers).

## Decisions (resolving plan §10)

| # | Decision | Resolution |
| --- | --- | --- |
| 1 | Member display-name visibility in group | Approved — scoped to co-members, display names only, no account ids in client payloads |
| 2 | Teacher voice in group rooms | Read-only observer at launch; composer hidden, server denies teacher POST |
| 3 | Group room message cap | 500 for group rooms; legacy per-student rooms keep 200 |
| 4 | Feature flag | `UAIS_LEARNING_CHATROOM_GROUPS_MODE`, optional-live-ai tier, default `off` |
| 5 | Transcript schema v2 | Approved; v1-tolerant reads, always emit v2; external-storage route ships in-repo so same-app deploy ordering is satisfied |
| 6 | True PDF export | Deferred; print-view export ships in P5 |
| 7 | Git operations | NOT executed — goal directive is not an explicit Git assignment per AGENTS.md. All work stays on the working tree. Phase 0 `release:clean-check` gate is waived with this documented deviation; owner may assign commit slicing separately (S25). |

## Baseline (before any edits, 2026-08-08 ~12:34)

- `npm run lint`: clean.
- `npm run test`: 167 files passed | 3 skipped; 2146 tests passed | 5 skipped. Green.

## Execution waves (disjoint write scopes per wave)

| Wave | Package | Scope summary | Status |
| --- | --- | --- | --- |
| 1a | P0 backend (S12) | Transcript-append budget fix (Option A) + GET rate limiter + pinning tests | Launched |
| 1b | P0 env catalog (S19/S10) | Back-fill data-dir vars; reserve groups-mode + history rate-limit vars | Launched |
| 1c | P1 groups backend (S12/S08) | `TeachingLearningGroupRecord`, CRUD handlers/routes, projections, tests | Launched |
| 2 | P2 group room backend (S12) | Room key branch, schema v2, authz layers, flag gate, author stamping | Pending |
| 3 | P3 chatroom UI (S04/S09/S06) | Hook extraction, three-zone layout, polling, identity rendering, copy | Pending |
| 4 | P4 teaching UI (S13/S05/S14) | Group panel, dialogs, student dashboard card | Pending |
| 5 | P5 export/share (S24/S12/S04) | Print-view export, share records/route/page, real chat-actions | Pending |
| 6 | P6 gates (S11/S10) | Full lint/test/build, QA matrix, reports. Vercel deploy evidence out of scope (no credentials; flag defaults off) | Pending |

## Gate results per wave

### Wave 1 (P0 backend, P0 env catalog, P1 groups backend) — COMPLETE, gate green

- 1a (S12): append-budget fix landed as route-local `persistLearningChatroomHistoryWithinBudget` (3s allowance, cutoff ≈53s, both append paths covered, `{status:"unavailable"}` = "not confirmed within budget", store untouched); GET limiter on `UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_*` (enforce/30/2000), actor-keyed, placed before authz like POST. 12 new tests.
- 1b (S19): six env names catalogued across catalog/docs/example. Back-fills in quarantined-legacy tier (production 503s local JSON); new names in optional-live-ai. `active-production` tier cap (21) is now saturated — future promotions need owner decision. "Reserved" wording on rate-limit + flag entries to be dropped as each lands (rate limiter already landed; CTO will clean up after Wave 2).
- 1c (S12/S08): `TeachingLearningGroupRecord` + CRUD handlers/routes + GET projections + 18 tests. Postgres/external stores needed no change (whole-DB normalize). Id bound 160 via shared `requireSafeId` (stricter than plan's ≤200 — fine). No one-group-per-student constraint → room resolution must always use explicit groupId.
- Gate on quiescent tree: `npm run test` 168 files / 2176 passed (baseline 2146), `npm run build` success, lint clean per engineers.

### Wave 2 (P2 group room backend) — COMPLETE, gate green

- Group rooms live behind `UAIS_LEARNING_CHATROOM_GROUPS_MODE` (explicit `on` required): `groupId?` room key + separate `chatroom-group-transcript-` id branch (legacy id derivation pinned byte-stable), transcript schema v2 (v1-tolerant read, always emit v2; external-storage PUT accepts v2 via shared normalizer — no external files needed changing), caps 500/200, retry 4/2 with duration-based `retryBudgetMs` seam (route race stays single deadline authority), layered group authz (`student-group-membership-required`, `teacher-group-observer-approved` GET-only, `teacher-group-observer-read-only` on POST, `feature-not-enabled`), author stamping + server-computed `isSelf`, roster echoed in GET, no account ids in any client payload (pinned).
- 23 new tests; legacy 86 chatroom tests pass untouched; full suite 169 files / 2199 green; tsc + lint clean; `npm run build` green with new routes present.
- CTO cleanup done: dropped stale "Reserved" wording for the four now-live env names across catalog/docs/example (env-surface tests re-verified).
- Notes carried forward: polling must back off on GET 429 (30/min per actor; two tabs same account will throttle); group-room classId comes from the group record, contradicting query classId ignored; share/export must reuse the GET projection to keep the no-account-id guarantee.

### Wave 3 (P3 chatroom UI) — COMPLETE, gate green

- Headless logic extracted to `use-learning-chatroom.ts` (1463 lines); `learning-page-chatroom.tsx` rewritten as the three-zone view (761 lines); `embedded` variant dropped (`HumanAiChatroom` export retained — learning-page.tsx re-exports it). Full-bleed tokenized shell escape; polling 5s visible-tab with 429 back-off (transcript never blanked), `feature-not-enabled` silent legacy fallback, membership-denial halt; server `isSelf` authority; mention chips via tokenizer; observer mode; a11y (role=log, aria-live, reduced motion). 13 additive copy keys (zh authoritative).
- Deep links: `?groupId=` alone resolves (group record carries course/class); teachers observe only via explicit deep link; students auto-enter a sole group, picker at ≥2.
- 49 live tests green (20 new group-live); full suite 170 files / 2219; tsc/lint clean; `npm run build` green (CTO).
- Owed: browser visual walkthrough both themes/locales — scheduled for final verification phase.
- For P5: Export/Share handlers are `handleExport`/`handleShare` in the hook (not the view); `chatroomGroupId` hard-coded slug now only the legacy fallback in `createShareLink` call.

### Wave 4 (P4 teaching workspace group management) — COMPLETE, gate green

- Group Collaboration panel per course card (list/create/edit/rename/delete, approved-members-only picker, 2–12 bounds mirrored client-side, two-step delete confirm, 旁听 Observe deep link) via new `src/components/teaching/use-teaching-learning-groups.tsx` + `learning-group-workspace.tsx`; receipt-and-readback verification on every mutation. Student dashboard Group Signal card with real group + `/learning/chatroom?courseId&groupId` deep link. Students operation page points at the real panel; suggestion pre-fill left as a documented seam (`suggestedMemberIds` prop + TODO) — dispatch surface was outside scope. 38 `teaching.group*` copy keys + `learning.groupCardTitle`.
- 14 new tests; full suite 172 files / 2233; tsc/lint clean.
- CTO rulings: lazy panel load accepted (preserves pinned request counts; `use-teaching-workspace.tsx` is at the 1500-line lint cap, hence sibling module). Panel flag-gating NOT waived — D9 requires hiding the panel when the flag is off; assigned to Wave 5 as a flag-surface task (GET /api/teaching/courses echoes a server-computed feature indicator; student projection omitted when off; panel + dashboard card gated).
- Flake flagged by engineer: group-live `?groupId=` deep-link test uses real timers against 5s polling; harden in final wave (S11).

### Wave 5 (P5 export/share ∥ flag surface) — COMPLETE, gate green

- Both engineers were interrupted by a session limit mid-task and resumed from transcript; both completed green.
- P5 (S24/S12/S04): chat-actions mocks deleted. Real share records (`uais-learning-chatroom-shares-v1`, atomic local JSON in the transcripts data-dir family, `repository` seam on every entry point — production minting deliberately 503s until an external `/learning-chatroom-shares/database` family is wired); `POST /api/learning/chatroom/share` (mint, member-only via chatroom gate `intent:"write"`, 10/min 200/day fixed limiter) + `DELETE …/share/[shareId]` (revoke: creator or course-owning teacher; 404 for unknown/revoked); public `/share/[shareId]` renders the room live at request time, signed-out viewable, display names only (asserted on markup); print-view export at `/learning/chatroom/export` with same-authz-as-GET, shared transcript document (`tone: print|screen`), client print island. 22 new tests; 16 additive copy keys; `exported`/`copiedFallback` de-mocked.
- Flag surface (S12): shared `isLearningChatroomGroupsEnabled` helper (chatroom route swapped, behavior-preserving); `GET /api/teaching/courses` gains top-level `features: { learningChatroomGroups }` on every 200; flag off ⇒ student `learningGroups` projection omitted entirely, teaching panel + Observe links hidden, dashboard shows placeholder; teacher records + CRUD stay functional dark (per D9 "only the UI hides"). 11-value env parity table pinned against the chatroom route. 8 new tests.
- CTO ruling: accepted the flag engineer's scope deviation into `course-readback.ts` / `use-teaching-workspace.tsx` / `teaching-page.tsx` (~8 additive lines) — the feature value must ride the existing course-list read because `/teaching` request counts are pinned by tests; an extra probe request is architecturally wrong here. `use-teaching-workspace.tsx` now ~1488/1500 lint cap — flagged for future refactor.
- Gate on quiescent tree: `npm run test` 173 files / 2262 passed; `npm run build` green with all new routes; tsc + lint clean per engineers.
- Known seams for release notes: production share minting 503s until external share backend lands; print stylesheet depends on hiding `header.sticky` (S01 file) — `standaloneRoutes` is the durable fix; mid-session flag flips reach clients on their next course-list read.

### Wave 6 (P6 hardening: adversarial review + QA matrix + fixes) — in progress

- Visual walkthrough (CTO, `npm run dev` + browser, demo student account `Peter` from the checked-in local-demo fixtures): `/learning/chatroom` renders the new three-zone layout correctly in light+zh, dark+zh, dark+en — room header with Export/Share and print hint, roster with self badge, mention chips in bubbles, circular human avatars vs rounded-square agents, agent dock with statuses, 0/4000 composer; tokenized full-bleed escape holds in dark; zero console errors. (Demo fallback room — group-mode visuals are covered by the 20 group-live tests; exercising a real group room end-to-end needs the flag on plus seeded accounts, deferred to owner smoke per plan §4 P6.)
- Adversarial review workflow (4 lenses → 2-skeptic verification) + S11 QA matrix delivered (`coordination/reports/2026-08-08-learning-chatroom-group-qa-matrix.md`, 194 cases mapped across §7's 10 families, all covered, 8/10 with both API+live).
- Review result: **5 major findings, all dual-skeptic CONFIRMED, zero refuted**, plus 9 minors. Fix engineers dispatched (disjoint scopes: server / client / test-hygiene).

#### Confirmed majors → fixes authorized
1. **Security (route.ts):** group POST persisted client-supplied `role:"agent"` rows verbatim → a member could forge an AI-TA message that persists to the shared transcript and renders as a trusted TA to every member and to signed-out `/share` viewers. Fix: never persist client agent rows (server-minted `turns` are the only agent source; idempotent, so behavior-preserving).
2. **Parity (share store):** the documented production-503 guard `assertLearningChatroomShareLocalJsonRuntimeAllowed` had **zero callers** — production share mint would silently write to an ephemeral serverless FS (unviewable/unrevocable links) or 500 instead of the designed 503. Fix: wire the guard at mint/revoke/read, mirroring the transcript store.
3. **UI (use-learning-chatroom):** `window.open(url,"_blank","noopener")` always returns null → every Export click showed "browser blocked the print view" even on success. Fix: fire-and-forget / anchor.
4. **UI (use-learning-chatroom):** POST-resolution appended server-minted turns without deduping against ids the 5s poll already merged → intermittent doubled agent reply + duplicate React keys. Fix: filter turns by ids already present.
5. **Test flake (group-live):** four more tests (beyond the one already known) assert exact poll-GET counts on real timers → order-dependent CI failures. Fix: fake timers / last-URL assertions.

#### Minors also authorized (cheap, correct)
D9 kill-switch gap — public `/share` page ignored the groups flag, so flipping it off couldn't stop already-minted group-room disclosure (fix: gate group shares on the flag; legacy shares unaffected). studentId provenance overwrite (`existing?.studentId ?? studentId`). Composer stayed enabled on a denied room and emitted a false `collaboration.contributed` record (fix: disable + move emission after successful POST). Duplicate React keys when two members share a display name (fix: add index). Clipboard "copied" claimed on insecure contexts (fix: fallback notice). Plus three test-coverage gaps that let the majors through: share rate-limiter 429, reduced-motion assertion, fetch `unstubAllGlobals` in the two Phase 4 suites.

#### Minors deferred (documented, not blocking)
Public `/share` unbounded uncached storage reads with no limiter (signed-out DoS surface) — larger design change, flag defaults off; logged as a follow-up for S12/S22.

### Wave 7 (P6 fix verification) — COMPLETE, gate green

- Three fix engineers, disjoint scopes, all green:
  - **Server (S12):** agent-forgery filter (client `role:"agent"` rows never persisted in any room; legacy suite untouched — no flow depended on it); production-503 share guard now called at mint/revoke/read mirroring the transcript store (`VERCEL_ENV`/`NODE_ENV`/`UAIS_DEPLOYMENT_ENV`); D9 kill-switch on the public share view (group shares → notFound when flag off, legacy unaffected, gate not revoke); studentId provenance `existing?.studentId ?? studentId`. Non-vacuity confirmed by temporary revert. +5 tests.
  - **Client (S04):** export notice fire-and-forget (no more false "blocked"); POST-turn dedupe against polled ids; composer disabled on denied room + `collaboration.contributed` emitted only after a server-accepted POST; roster/facepile keys include index; clipboard-absent → fallback notice. Five flaky group-live tests converted to fake timers (ran 4×, 50/50 stable); reduced-motion assertion added.
  - **Test hygiene (S11):** `vi.unstubAllGlobals()` added to the two Phase 4 teaching suites.
- **Final integrated gate (quiescent tree):** `npm run lint` clean; `npm run test` **173 files / 2268 passed / 5 skipped** (baseline before feature: 167/2146 → net +6 files, +122 tests); `npm run build` success with all group/share/export routes present.
- One minor deferred as an owner follow-up chip: rate limiter on the signed-out public `/share` read path.

---

## Delivery summary

The Learning Chatroom group-collaboration feature (plan `2026-08-08-learning-chatroom-group-implementation-plan.md`, all Phases P0–P6) is **implemented, reviewed, hardened, and green**, shipping dark behind `UAIS_LEARNING_CHATROOM_GROUPS_MODE` (default off). Delivered via 11 Opus 5 engineer packages under Fable 5 CTO orchestration across 7 waves, with an adversarial multi-agent review (4 lenses + dual-skeptic verification) that caught 5 major defects — including a real AI-TA impersonation vector — all fixed and pinned.

**What owner action remains (none blocking the code):**
1. Git commit-slicing of the (still-uncommitted) feature — needs explicit S25 Git assignment per AGENTS.md; CTO did not commit.
2. Deployment smoke on Vercel with the flag on + seeded accounts, and confirming external-storage v2 + external share-record backend readiness before the flag flip (no owner credentials in this session → out of scope, plan §6/§10).
3. The plan §10 decisions were resolved with recommended defaults (see Decisions table above); owner may override any.

**Known seams carried in code (documented, not defects):** production share minting 503s until an external share-record backend is wired (deliberate — no ephemeral-FS writes); print stylesheet hides `header.sticky` (durable fix is adding `/share/*`+export to `standaloneRoutes`, S01); mid-session flag flips reach `/teaching` clients on their next course-list read.
