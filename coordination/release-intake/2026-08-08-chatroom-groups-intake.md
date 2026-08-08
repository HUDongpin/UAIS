# Release Intake — Learning Chatroom Groups

- Date: 2026-08-08
- Session: S25 (git hygiene and release intake)
- Reason string: `chatroom group intake`
- Authorization: owner approved S25 commit-slice execution (implementation plan §10, item 7)
- Scope of THIS document: **non-destructive analysis only.** No file was staged, committed, moved, or deleted.
- Evidence: `coordination/release-intake/current-chatroom-groups-dirty-map.json`

---

## 1. Headline findings

**F1 — The implementation plan is already fully built.** While the plan was being written and approved, a parallel multi-agent session (Fable 5 as CTO, Opus 5 engineers, 7 waves, 11 packages) implemented **all phases P0–P6** of `2026-08-08-learning-chatroom-group-implementation-plan.md`. Its own record is `coordination/reports/2026-08-08-chatroom-groups-cto-execution-log.md`. The intake is therefore not "commit the old groundwork" (as Appendix A.1 assumed) — it is **commit a complete, green feature set**.

**F2 — Two owner decisions were implemented as the opposite default.** That session resolved plan §10 with *recommended defaults* because the owner's actual answers were given in a different session and were not in its context. Two of the seven do not match what the owner decided:

| # | Owner's decision (2026-08-08) | What the code does | Verified at |
| --- | --- | --- | --- |
| 2 | **Teachers can post** in group rooms — "we need teaching presence" | Teacher POST is **denied**: `intent === "write"` → `teacher-group-observer-read-only`; composer hidden in the UI | `src/lib/server/learning-ai-guide-access.ts:158-163`; client branch `src/components/pages/use-learning-chatroom.ts:461` |
| 6 | **Pursue true PDF export** | Print-view only; true PDF explicitly deferred ("There is no PDF service and no credential: the browser's print dialog is the generator") | `src/lib/chat-actions.ts:1-12`; `src/app/learning/chatroom/export/` |

Decisions 1, 3, 4, 5 match the code. Decision 7 (git) was correctly **not** executed by that session — it deferred to an explicit S25 assignment, which the owner has now given.

**F3 — The dirty tree holds four independent workstreams, not one.** Chatroom-groups is the largest, but LRS/learning-records tenant isolation, AI live-turn orchestration, and tooling-config hygiene are separate bodies of work that arrived in the same tree.

**F4 — The tree is green.** Independently re-verified in this session (not taken from the execution log).

---

## 2. Gate evidence (re-run by S25, 2026-08-08)

| Gate | Result |
| --- | --- |
| `npm run release:clean-check` | **FAILS** — 111 uncommitted/untracked entries. This is the documented condition under which S25 rescue/intake work may proceed. |
| `npm run test` | **PASS** — 173 files passed, 3 skipped (176); **2274 tests passed**, 5 skipped. Duration ~21s. |
| `npm run lint` | **PASS** — clean, no output. |
| `npx tsc --noEmit` | **PASS** — clean, no output. |
| `npm run build` | **PASS** — new routes present in the manifest: `/learning/chatroom`, `/learning/chatroom/export`, `/share/[shareId]`. |

(The execution log claimed 2268 tests; this run counts 2274. The delta is consistent with the last fix-wave tests landing after that log entry was written. Either way: green.)

**Secret-like files:** `.env.local` is present locally and is git-ignored (`.gitignore:47`). It was **not opened, read, copied, or summarized**, and appears in no proposed slice. `.env.local.example` is a redacted placeholder file already tracked and is safe to commit.

---

## 3. Workstream map (111 entries → 4 workstreams + docs)

| Workstream | Entries | What it is | Owning session |
| --- | --- | --- | --- |
| W1 Chatroom groups (P0–P6) | 57 | Transcript v2 + group rooms, groups entity/CRUD, chatroom UI rewrite, teaching group panel, share/export | S12 / S04 / S13 / S24 |
| W2 Learning records (LRS) | 14 | xAPI tenant isolation, migration + audit scripts, client event reporter, **session-user provider** | S12 / S15 |
| W3 AI live turns | 7 | `/api/ai/chat` live text-reasoning, director/deepseek changes | S07 |
| W4 Tooling config | 2 | `.claude/**` exclusions in eslint + vitest (stops agent-worktree test copies running) | S10 |
| Docs | 24 | Reports + session logs, incl. the plan, QA matrix, CTO log | S10 / S25 |
| Root dialogue files | 4 | Owner conversation transcripts at repo root | Owner decision (§6) |
| Intake evidence (this run) | 2 | Dirty map + this report | S25 |

### Cross-workstream entanglement (drives slice ordering)

Two shared files prevent a clean per-workstream split — both verified by reading the diffs:

1. `src/app/layout.tsx` (M) imports `src/components/providers/session-user.tsx` (untracked). **They must land together.** The provider is a foundation used by both W1 and W2.
2. `src/components/pages/learning-page.tsx` (M) **deleted** its inline chatroom components and now re-exports them: `export { HumanAiChatroom, LearningChatroomPage } from "./learning-page-chatroom";` (untracked). **They must land together**, and the chatroom UI slice therefore cannot precede or follow it separately.

Consequence: slices are **ordered and cumulative**, not independent. Each is reviewable on its own; only the final slice is guaranteed green.

---

## 4. Proposed commit slices (10, in order)

Pathspec lists: `coordination/release-intake/2026-08-08-chatroom-groups-slice-pathspecs.txt`.

| # | Slice | Paths | Rationale |
| --- | --- | --- | --- |
| 1 | `tooling-config` | 2 | Independent, zero product risk. Lands the `.claude/**` lint/test exclusions first so every later slice's gate run is honest. |
| 2 | `learning-records` | 14 | W2 + the shared session provider and `layout.tsx`. Foundation for W1's client. |
| 3 | `ai-live-turns` | 7 | W3. Includes `director.ts` mention routing that the chatroom round depends on, so it precedes W1. |
| 4a | `chatroom-groups-backend` | 25 | Transcript store/runtime/external, chatroom route, groups entity + handlers + CRUD routes, course projections, authz, rate limiter, flag, external-storage plumbing, 3 API suites. |
| 4b | `chatroom-ui` | 11 | Hook + three-zone view + `learning-page.tsx` re-export + copy + seed data + 3 live suites. |
| 5 | `groups-teaching-ui` | 10 | Teaching group panel, dashboard card, operation page, readback, 2 suites. |
| 6 | `share-export` | 11 | Share store/routes/view, print export, public `/share/[shareId]`, de-mocked `chat-actions.ts`, 1 suite. |
| 7 | `env-surface` | 3 | Catalog + docs + example for the six env names. Last code slice so the catalog describes what exists. |
| 8 | `coordination-docs` | 24 (+2) | Reports and session logs, plus this intake report and dirty map. |
| 9 | `root-dialogue-files` | 4 | **Recommend NOT committing as-is** — see §6. |

**Verification protocol for execution:** run `npm run lint && npm run test && npm run build` after the final code slice (7). Per-slice green is *not* claimed: intermediate commits mix new backends with older callers. If per-commit green is required, S25 should verify after each slice and squash forward any slice that cannot stand alone.

**Pathspec mechanics (verified):** paths containing `[courseId]` / `[groupId]` / `[shareId]` matched correctly in both plain and `:(literal)` form during testing. Use `git add --literal-pathspecs --pathspec-from-file=<file>` defensively, and note the four root files contain **spaces** and must stay quoted. Per AGENTS.md, **never `git add .`** for this intake.

---

## 5. Blockers and risks

**B1 (decision conflict, needs owner ruling before the feature is enabled).** The teacher-posting behaviour (F2 #2) contradicts the owner's stated requirement. This does **not** block committing — the code is green and correct-as-written — but it blocks calling the feature "done to spec". Two options:

- **B1-a (recommended): commit as-is, then a follow-up S12+S04 package** flips `teacher-group-observer-read-only` to a participant path (`teacher-group-participant-approved`), stamps `authorRole: "teacher"`, re-enables the composer for owning teachers, and adds the instructor chip. The approved plan (§D5, P2/P3) already specifies this exactly, including why mention routing is unaffected. Estimated small: one authz branch, one stamping site, one UI branch, plus tests.
- **B1-b:** hold the commit until the fix lands, so history never contains the wrong behaviour. Costs time; not recommended, since the flag defaults `off` and nothing is user-visible.

**B2 (scope gap, non-blocking).** True PDF export (F2 #6) was deferred. Owner approved pursuing it. Follow-up S24 package: propose the rendering approach (serverless headless-chromium vs. external service) and return any credential/cost need as a blocker report before implementing. Print view already ships and works.

**R1.** The plan document in `coordination/reports/` now describes teacher-posting and true-PDF (owner-updated), while the code does not. Anyone reading plan-then-code will see a contradiction until B1/B2 land. This intake report is the reconciliation record.

**R2.** Deferred by the implementing session and still open: no rate limiter on the signed-out public `/share` read path (DoS surface). Flag defaults off; logged for S12/S22.

**R3.** Known seams carried in code (documented, not defects): production share minting deliberately 503s until an external share-record backend exists; the print stylesheet depends on hiding `header.sticky` (durable fix is adding the export/share routes to `standaloneRoutes`, S01); mid-session flag flips reach `/teaching` clients on their next course-list read.

**R4.** `use-teaching-workspace.tsx` is at ~1488 of the 1500-line lint cap. The next teaching-workspace change will hit it.

**R5.** Deployment smoke with the flag **on** (seeded accounts, external-storage v2 readiness, external share backend) has never run — no credentials in these sessions. Required before any production flag flip (plan §4 P6, S22/S19).

---

## 6. Root dialogue files — recommendation

Four owner working documents sit at the repository root:

```
20260712_UAIS_bug detection_dialogue turns_Claude and Peter.md
20260718_UAIS_Next Development Plan implementation_dialogue turns_Claude and Peter.md
20260718_UAIS_bug detection_dialogue turns_Claude and Peter.md
20260802_UAIS_Bug Report.md
```

They are conversation transcripts and bug reports, not project source; one references the superseded `/Users/dongpinhu/Desktop/UAIS` path. AGENTS.md discourages accumulating loose report piles at the root. **Recommendation: do not commit them in this intake.** Owner picks one of:

- **(a)** move them under `coordination/reports/` with the existing `YYYY-MM-DD-` naming, then commit with the docs slice; or
- **(b)** add a root-level ignore for the `NNNNNNNN_UAIS_*.md` pattern and keep them local; or
- **(c)** commit them at the root as-is (explicit owner override).

S25 took no action on these files.

---

## 7. Recommended next actions

1. **Owner:** rule on B1 (recommend B1-a: commit now, fix teacher posting in a follow-up) and on §6 (a/b/c for the root files).
2. **S25:** on that ruling, execute slices 1–8 with explicit pathspecs, then re-run the four gates and publish a post-commit clean-status evidence line.
3. **S12 + S04:** follow-up package — teacher participation per plan §D5 (B1).
4. **S24:** follow-up package — true PDF approach proposal (B2).
5. **S12/S22:** public `/share` read limiter (R2).
6. **S22/S19:** flag-on deployment smoke and external-storage readiness before any production flip (R5).
