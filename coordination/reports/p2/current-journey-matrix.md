# UAIS P2 Current Journey Matrix

Evidence date: 2026-08-23 Asia/Hong_Kong
Clean deployed Git SHA: `0e156b25b7b9a003a07b7f94cf7c8f8d7323ec3e`
Local automated status: `PASS`
Production journey status: `BLOCKED_ENV`

The browser suite ran against deterministic local fixtures in four Chromium
projects: desktop and mobile, each in `zh-CN` and `en-US`. It finished with 50
tests passed, two expected desktop-project skips for the mobile-only navigation
case, and zero failures. Screenshots, traces, and browser console diagnostics
are retained on failure under ignored Playwright output; the durable evidence
is this canonical report plus the committed test contracts.

| ID | Status | Journey/state | Command or manual step | Evidence path | Failure or residual boundary | Responsible roles | Next step | Blocks production |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P2-J01 | `PASS` | Visitor opens `/`, reaches login, and can use the skip link and shell navigation | Fresh `npm run test:p2:e2e` | `tests/p2/browser/core-journeys.spec.ts`; `tests/p2/browser/accessibility.spec.ts` | 50 passed, 2 expected mobile-navigation project skips, zero failed across desktop/mobile and both locales | S01/S11 | Re-run through the exact immutable staging deployment after approved protection bypass and identities are available | Yes until staging proof |
| P2-J02 | `PASS` | Login error, localized announcement, stale-error removal, pending state, and successful recovery | `npm run test:p2:e2e`; `npm test` | `tests/p2/browser/core-journeys.spec.ts`; login regression tests in `tests/` | Real identity-provider/network outage behavior still needs staging evidence | S09/S11/S12 | Exercise staging auth failure classes without production accounts | Yes until staging evidence |
| P2-J03 | `PASS` | Unauthenticated protected route returns to the original safe route; external open redirect is rejected | `npm run test:p2:e2e`; `npm run test:critical` | `tests/p2/browser/core-journeys.spec.ts`; route/auth regression tests in `tests/` | Local fixture proof only | S01/S11/S12 | Repeat against staging session configuration | Yes until staging evidence |
| P2-J04 | `PASS` | Course plaza list, search, no-results clear action, invalid invite recovery, draft preservation, and enrolment contract | `npm run test:p2:e2e`; `npm test` | `tests/p2/browser/core-journeys.spec.ts`; course/enrolment tests in `tests/` | Multi-user duplicate/race behavior is not proven without isolated database load | S02/S11/S12 | Run staging enrolment and 200-user invite scenario | Yes until load proof |
| P2-J05 | `PASS` | Learner opens the existing 19-page demonstration deck, navigates slides/audio, sees an explicit manifest error, retries, and recovers without route loss | `npm run test:p2:e2e`; `npm test` | `tests/p2/browser/core-journeys.spec.ts`; playback/media tests in `tests/` | This proves the local publishing/playback and request-recovery pipeline only; it is not real Week-1 teaching content | S03/S11/S24 | Repeat failure/recovery on staging CDN/runtime | Yes until staging evidence |
| P2-J06 | `PASS` | Chat empty state, Enter send, Shift+Enter newline, deterministic AI error recovery, export, share, Unicode, and long-message contracts | `npm run test:p2:e2e`; `npm test` | `tests/p2/browser/core-journeys.spec.ts`; chat/export/provider tests in `tests/` | Real provider behavior and multi-user delivery are deliberately not exercised locally | S04/S07/S11 | Run isolated group test; separately authorize at most three live requests | Yes until staging/provider gates |
| P2-J07 | `PASS` | Teacher course surface, create/settings dialogs, invite code, focus trap/restoration, dangerous-dialog behavior, and cover controls | `npm run test:p2:e2e`; `npm test` | `tests/p2/browser/core-journeys.spec.ts`; teacher workflow tests in `tests/` | Dead “modify cover” control is absent; AI cover entry remains. Persistent writes need staging | S05/S11/S13 | Repeat create/update/delete against isolated staging | Yes until staging evidence |
| P2-J08 | `BLOCKED_ENV` | Teacher creates groups; members see only their group; simultaneous messages never cross groups | `npm run test:p2:load` plus staging browser matrix | `coordination/reports/p2/current-load.md` | `uais-staging` and an immutable deployment now exist, but approved DB credentials, exact-deployment protection bypass, accounts, executed 5-to-200 ramp, and cleanup proof are absent | S11/S14/S22 | Complete approved source intake, then execute the exact-deployment matrix | Yes |
| P2-J09 | `PASS` | Locale and theme switches retain route, unfinished input, and focus; visible locale matches document `lang` | `npm run test:p2:e2e`; `npm test` | `tests/p2/browser/core-journeys.spec.ts`; shell/i18n tests in `tests/` | Safari-specific behavior remains part of manual VoiceOver run | S01/S09/S11 | Repeat on staging and complete Safari manual pass | Yes until manual/staging evidence |
| P2-J10 | `PASS` | Session expiry removes protected content and returns the user to a safe login/recovery path | `npm run test:p2:e2e`; `npm run test:critical` | `tests/p2/browser/core-journeys.spec.ts`; auth/session tests in `tests/` | Staging cookie/domain policy has not been exercised | S11/S12/S22 | Repeat with staging secrets and canonical hostname | Yes until staging evidence |

## Local acceptance notes

- All browser state is isolated per test identity/course fixture. The setup and
  teardown contract records fixture creation and cleanup; local runs left no
  external data because no external database was contacted.
- Pending controls reject duplicate submission, errors remain adjacent to the
  relevant control, and failed form/chat operations preserve user input.
- Mobile coverage uses a `390 × 844` viewport and validates the navigation
  dialog/focus path without horizontal-scroll workarounds.
- The group collaboration path remains a hard production blocker: deterministic
  contracts and a load plan do not substitute for database-backed isolation.
- No production account, production database, real provider, private chat
  body, or private course material was used or recorded.
