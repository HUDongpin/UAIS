# UAIS Critical-Flow Regression Matrix

- Date: 2026-07-08
- Advisory item: B-16, start automated tests for the five critical journeys.
- Scope: local deterministic route/component/unit coverage only; no live credentials, Vercel mutation, or production data access.

## Coverage Snapshot

| Journey | Current executable evidence | Status | Remaining gap |
| --- | --- | --- | --- |
| Login | `tests/critical-user-flows-backend.test.ts`; `tests/login-page.test.tsx`; app-session route handler issues signed HttpOnly cookie headers and role-specific redirects. | Started and passing | Browser E2E login on preview/staging still needed after environments exist. |
| Enrol | `tests/critical-user-flows-backend.test.ts`; `tests/course-plaza-page.test.tsx`; invite-code join remains pending until teacher review. | Started and passing | Browser path from shared invite link to approved learning context still needs E2E. |
| Learn | `tests/learning-page.test.tsx`; selected course, narration/transcript, course directory, and learning-tools affordances are covered. | Existing and mapped | Needs a single end-to-end student learning journey gate once full-suite runner is stable. |
| Chat | `src/lib/chat-actions.ts` export/share helpers are mapped by `tests/critical-user-flow-matrix.test.ts`; existing learning page keeps chatroom routing separate. | Partially mapped | Full chat UI send/export/share regression remains open; a first attempt to import the full chat page in a new test hung the Vitest worker. |
| Teacher CRUD | `tests/critical-user-flows-backend.test.ts`; `tests/teaching-course-management-api.test.ts`; signed teacher creates course/class and approves membership. | Started and passing | Preview/staging route smoke with real provider cookies remains dependent on S19/S22 environment setup. |

## Checks

- `npm run test -- tests/critical-user-flows-backend.test.ts tests/critical-user-flow-matrix.test.ts`: passed, 2 files / 3 tests.
- `npm run test:critical`: named B-16 gate for the current stable critical-flow
  slice. It runs auth, app-session, teaching course management, learner profile,
  backend critical-flow, and critical-flow matrix tests.
- `.github/workflows/critical-flow.yml`: CI workflow added for pull requests and
  pushes to `main`. It runs install, lint, `npm run test:critical`, advisory
  governance/database checks, and the compile-only Next app-route build.

## Notes

- The new backend critical-flow test intentionally keeps data in a temporary local directory and redacts local paths/secrets from response assertions.
- A new UI critical-flow file was attempted and then removed because importing the full learning/chat page surface in a separate test worker stayed idle. Existing focused UI tests remain the stable evidence for the learning journey.
- This does not complete B-16 as a fully enforced GitHub merge gate until branch
  protection requires the new workflow. It creates the stable npm command,
  wires CI execution, and identifies the remaining chat UI and browser E2E work.
