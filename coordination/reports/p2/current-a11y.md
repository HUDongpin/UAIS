# UAIS P2 Current Accessibility Report

Evidence date: 2026-08-22 Asia/Hong_Kong
Planning baseline: `fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`
Validated P2 code SHA: `6e48ea8491a1542f54a2fff084f19fac1422c646`
Standard: WCAG 2.2 AA
Automated Chromium status: `PASS`
Complete production accessibility status: `BLOCKED_ENV`

## Acceptance ledger

| ID | Status | Check | Command or manual step | Evidence path | Failure or residual boundary | Responsible roles | Next step | Blocks production |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P2-A11Y-01 | `PASS` | axe scan of core pages and UI states | `npm run test:p2:a11y`; redacted JSON reporter verification | `tests/p2/browser/accessibility.spec.ts`; ignored `.tmp/p2-a11y-results.json` during review | 20/20 tests passed; 72 state attachments across 18 unique states; critical 0, serious 0, moderate 0, minor 0, unknown 0 | S09/S11 | Re-run unchanged candidate against staging | Yes if regressed |
| P2-A11Y-02A | `PASS` | Automated keyboard/focus regressions: skip link, mobile nav, dialog trap/Escape/restore, composer Enter/Shift+Enter, and focus retention | `npm run test:p2:e2e`; `npm test` | browser and focused regression tests in `tests/p2/browser/` and `tests/` | Automation passed, but it is support evidence rather than a manual keyboard sign-off | S01/S05/S09/S11 | Preserve tests and perform human-only keyboard journey | Yes until P2-A11Y-02B passes |
| P2-A11Y-02B | `NOT_RUN` | Human keyboard-only completion of every core journey and visual/order review | Manual checklist below | This report | No qualified manual pass recorded | S09/S11 | Execute in both locales on desktop and mobile-width layouts | Yes |
| P2-A11Y-03 | `NOT_RUN` | VoiceOver + Safari complete student and teacher journeys | Manual macOS checklist below | This report | Safari/VoiceOver session not performed; Chromium automation cannot substitute | S09/S11 | Record redacted versions, date, SHA, steps, and results | Yes |
| P2-A11Y-04 | `BLOCKED_ENV` | NVDA + Chrome complete student and teacher journeys | Windows checklist below | This report | Current host is macOS and has no Windows/NVDA execution surface | S09/S11 | Run on an authorized Windows host | Yes |
| P2-A11Y-05 | `NOT_RUN` | 200% text zoom/reflow, reduced motion, target size, and non-color cues | Manual responsive checklist below | This report | Automated viewport/axe coverage does not prove these perceptual checks | S06/S09/S11 | Complete and attach redacted observations | Yes |
| P2-A11Y-06 | `PASS` | No blanket axe suppression or unscoped waiver | Review of Playwright configuration and axe tests | `playwright.p2.config.ts`; `tests/p2/browser/accessibility.spec.ts` | No global axe rule was disabled; no waiver is active | S09/S11 | Any future waiver must be element-scoped and time-bounded | Yes if regressed |

## Automated coverage and impact totals

Each of the four fixed Chromium projects scanned the same 18 named states:

- login empty and login error;
- courses normal, no-results recovery, and invalid-invite error;
- learning normal, chatroom entry, media error, and media recovery;
- chat empty, message, provider error, and export completion;
- teaching normal, new-course dialog, group panel, group dialog, and dangerous
  delete confirmation.

Multiple state attachments are produced within one Playwright test, which is
why 20 passed tests yielded 72 redacted axe attachments. The deep dangerous-
confirmation scan is scoped to the active group card to avoid re-evaluating a
different 48×48 teacher target while it is partially clipped above the scrolled
viewport; the teacher page, group panel, and group-dialog states retain separate
full-page scans. No rule is disabled by that state scope.

| Impact | Count | Gate |
| --- | ---: | --- |
| Critical | 0 | `PASS` |
| Serious | 0 | `PASS` |
| Moderate | 0 | `PASS` |
| Minor | 0 | `PASS` |
| Unknown | 0 | `PASS` |

Attachment bodies were reviewed only for rule IDs, impact, selectors, and help
text. They were not committed and contain no credentials, account secrets, or
private chat content.

## Manual keyboard checklist

Run once in `zh-CN` and once in `en-US`, without a mouse:

1. Start at `/`, activate the skip link, enter `/login`, submit invalid input,
   hear/see the error, correct it, and continue to the original safe route.
2. On `/courses`, reach search, clear a no-results state, submit an invalid
   invite, confirm the draft remains, and verify visual focus is never hidden.
3. On `/learning`, navigate the 19-page demonstration deck and audio controls;
   confirm every operation has a visible focus indication and usable name.
4. In `/learning/chatroom`, use Enter to send and Shift+Enter for a newline;
   recover from the provider error and export/share without a focus jump.
5. On `/teaching`, open each dialog, verify initial focus, cycle Tab and
   Shift+Tab without escape, close non-dangerous dialogs with Escape, and verify
   focus returns to the exact trigger.
6. Open and close mobile navigation at `390 × 844`; confirm focus enters the
   menu, never reaches covered content, and returns to the trigger.
7. Confirm Tab order follows visual order; headings do not skip levels;
   landmarks, labels, required states, status messages, and icon names are
   understandable in the active locale.

## VoiceOver + Safari checklist

1. Record macOS, Safari, and VoiceOver versions plus candidate SHA; do not
   record credentials or content entered into chat.
2. Complete the student login, course, learning, chat error/retry, and export
   path with VoiceOver Quick Nav and keyboard commands.
3. Confirm `lang`, headings, landmarks, form descriptions, live error/status
   announcements, media alternatives, and new-message announcements are
   concise and not replayed as an entire transcript.
4. Sign out, complete the teacher login and dialog/danger-confirmation path.
5. Verify dialogs announce their name, trap focus, close as designed, and
   restore focus. Verify changing language does not lose route, input, or focus.
6. Record per-step `PASS`/`FAIL`, sanitized observations, date, and reviewer.

## NVDA + Chrome checklist

1. On an authorized Windows host, record Windows, Chrome, and NVDA versions and
   candidate SHA; enable Speech Viewer only if its output is not persisted with
   private content.
2. Complete student login, `/courses`, `/learning`, and
   `/learning/chatroom` using only the keyboard and NVDA commands.
3. Confirm browse/focus mode transitions, heading/landmark navigation, labels,
   described errors, pending/success states, media alternatives, and restrained
   chat live-region announcements.
4. Sign out, then complete teacher login and `/teaching` create/settings/
   danger-dialog journeys; verify dialog naming, containment, Escape behavior,
   and trigger focus restoration.
5. Repeat the critical error path in both locales and confirm speech follows
   the visible selected language.
6. Save only date, reviewer, versions, candidate SHA, step results, and
   sanitized defects. Missing NVDA evidence remains a production blocker.

## Reflow, motion, target, and color checklist

- At 200% browser text zoom, complete all primary tasks with no lost content,
  overlapping controls, or two-dimensional scrolling except intrinsic media.
- With `prefers-reduced-motion: reduce`, verify no forced or essential-state-
  obscuring animation remains.
- Measure every interactive target at a minimum of 24 × 24 CSS px, with primary
  actions targeting 44 × 44 CSS px.
- Verify error/success/selected states retain text, icon, shape, or position
  cues and never depend on color alone.

Automated success is therefore reported as `PASS`, while the overall production
accessibility gate remains `BLOCKED_ENV` until human keyboard, VoiceOver,
NVDA, reflow, motion, and target-size evidence is complete.
