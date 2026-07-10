# UAIS Privacy Baseline

Status: B-22 operator baseline for the core proof of concept.
Owner lane: S10/S12/S19/S22 coordination before any production cohort.
Created: 2026-07-08.

This baseline turns the advisory's privacy recommendation into an operating
contract for UAIS. The user-facing notices remain `/privacy` and `/terms`.
This file is the implementation checklist for engineers, release owners, and
course operators until a formal institutional data-processing agreement is in
place.

## Scope

This baseline applies to the current core POC surface:

- `/login`, `/courses`, `/learning`, `/learning/chatroom`, `/student-dashboard`,
  `/teaching`, `/privacy`, `/terms`, and `/healthz`.
- Core app-session, teaching-course, invite-code, learning-record, analytics,
  and learning AI guide APIs documented in `docs/API.md`.
- Export/share flows that may include course, chat, or learning-record data.

Experimental voice clone, PPT narration, restore-drill, evidence-gate, and
external-storage routes are not approved product contracts. They must not be
used for real student data until separately reviewed, reduced, or promoted.

## Data Categories

UAIS should keep the minimum student PII needed for teaching.

| Category | Examples | Baseline handling |
| --- | --- | --- |
| Public product data | Public route labels, approved course descriptions, generic demo copy | May be visible without authentication when intentionally placed on public routes. |
| Account and session data | Account id, display name, role, signed session cookies, login trace id | Server-side only; cookie values, signatures, passwords, and session secrets must never appear in reports, logs, screenshots, or client variables. |
| Course and teaching records | Course titles, class ids, invite codes, teacher actions, membership state | Visible only to the owning teacher/admin path or enrolled student path required for the workflow. |
| Student learning records | Progress, xAPI-shaped events, submissions, chat messages, AI prompts, playback events, feedback | Treat as student education records; expose by self-scope, teacher-course/class scope, or signed admin scope with audit reason. |
| AI processing inputs | User question, selected course context, selected slide/context ids, file excerpts when later enabled | Send only what is needed for the answer; LLM output is never the system of record. |
| Operational telemetry | `/healthz` result, redacted trace ids, HTTP status, error class, uptime signal | Keep low-content and redacted; omit raw bodies, local filesystem paths, cookies, tokens, provider secrets, and student content unless incident handling explicitly requires protected evidence. |
| Restricted secrets | Env files, provider keys, Vercel tokens, cookies, passwords, library credentials | Never commit, stage, copy, print, summarize, screenshot, or log values. Only record variable names and present/missing redacted status. |

## Role Access Baseline

- Student: may access only their signed session, enrolled course surfaces,
  membership state, own learning events, and own learner analytics.
- Teacher: may access only teacher-owned course/class/member records and
  class-level learning summaries needed for teaching.
- Admin: not a general-purpose current-user mode. Any future admin access must
  use a signed admin session, least privilege, and an audit reason for
  tenant-level analytics or operational review.
- Public/anonymous: may access public pages and `/healthz`; may not access
  protected course, teaching, learning, or analytics data.

## Minimization Rules

1. Prefer internal ids over names, emails, or free-text identifiers in APIs,
   analytics, and logs.
2. Do not ask for identity-document numbers, home addresses, health diagnoses,
   financial data, personal keys, platform passwords, or unrelated sensitive
   information.
3. Do not send full student records, full chat history, raw exports, or raw
   uploaded files to an AI provider by default. Send a narrowed prompt/context
   package for the current task.
4. Do not use AI output as the system of record, final grade, disciplinary
   finding, or identity decision.
5. Do not add a new data field, event property, export column, or analytics
   dimension unless the teaching purpose and role access are documented.
6. Keep generated export files under the initiator's responsibility: the UI/API
   must assume exports may contain personal information and should avoid
   exposing them to unauthenticated routes.

## Retention And Deletion

No production cohort may start until the owner or institution records the
approved retention schedule for each real deployment.

Current default before that decision:

- Demo/development data is disposable and may be reset; it is not a durable
  student record.
- Signed sessions expire according to the session helper and should not be used
  as durable records.
- Course, membership, learning-event, chat, submission, and export metadata
  should be retained only for the active course period plus the owner-approved
  teaching, audit, and dispute-handling window.
- Backups, external storage, AI provider logs, observability tools, and export
  downloads need documented retention/deletion behavior before real student
  data is enabled.
- Deletion requests must identify whether the record is a live app record,
  backup, export, provider-side record, or institution-managed record. Do not
  promise immediate complete deletion from backups unless the backup policy
  supports it.

## Production Stop Conditions

Stop a production release or real-student pilot if any of these are true:

- Production demo authentication is enabled.
- A deployed environment can mint or validate app sessions without an explicit
  server-only session secret.
- Protected routes accept unsigned cookie presence as authentication.
- Real student data would be stored only in local JSON files, temporary
  directories, or an unverified external store.
- Provider keys, cookies, local paths, raw request bodies, or student content
  appear in logs, reports, screenshots, build output, or public artifacts.
- The institution has not approved the retention schedule, contact path, and
  export handling rules for the cohort.
- AI, LRS, analytics, or export providers are not documented with data location,
  retention, access control, and incident-contact expectations.

## Operational Checklist

Before enabling a real cohort, the release owner must confirm:

- `/privacy` and `/terms` are reachable from login and match the deployment's
  actual data processing.
- `docs/API.md` lists the active product APIs and excludes experimental routes
  from product-contract status.
- Auth uses one signed-session model with role checks for student, teacher, and
  any future admin mode.
- Logs and health checks are low-content and redacted.
- LRS/xAPI queries enforce self-scope, teacher class/course scope, and admin
  audit reason boundaries.
- Exports and share links cannot bypass authentication or role scope.
- The storage layer for core records is durable, backed up, and has a rollback
  plan.
- The owner/institution has approved retention, deletion, incident-contact, and
  provider-processing terms.

## Open Decisions

These are intentionally not guessed in code:

- Final production retention windows for course records, chat records, learning
  events, exports, and backups.
- The institution's required data-processing agreement and privacy contact.
- Whether admin tenant analytics should exist in the core product or remain a
  break-glass operational route.
- The durable database/provider choice and migration owner.
- Which AI, LRS, uptime, and observability providers are approved for real
  student data.
