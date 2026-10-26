# UAIS Core API Reference

This file documents only the core proof-of-concept API surface. Do not treat
the experimental AI, voice, external-storage, evidence-gate, or restore-drill
routes as product contracts until they are explicitly promoted.

## Common Rules

- All responses must omit secrets, local filesystem paths, raw cookies, tokens,
  and demo passwords.
- Follow the Privacy Baseline in `docs/privacy-baseline.md`: collect the
  minimum student PII needed, keep exports scoped to the authenticated actor,
  and do not expose raw student content in logs or health/readiness responses.
- Production auth-provider readiness failures return HTTP 503 with a redacted
  provider contract.
- Protected product APIs use signed app-session cookies or signed teacher
  session cookies. Unsigned cookie presence is not authentication.
- Route handlers are dynamic and should be tested as public API boundaries.

## Liveness

### `GET /healthz`

Purpose: redacted uptime check. It reports app liveness plus whether the core
database answers and already contains all migrations required by this build.

Healthy:

- HTTP `200` with `cache-control: no-store`.
- JSON `status: "ok"`, `service: "uais"`, `checkedAt`, and `checks` for `app`,
  `database`, and `migrations`.
- `checks.migrations: "ok"` means the database's `uais_schema_migrations`
  ledger already contains every migration this build requires
  (`UAIS_CORE_DATABASE_MIGRATION_VERSIONS`). Extra versions applied beyond this
  build (database ahead of code) do not fail the check.
- `redaction` with `secrets`, `localFiles`, and `databaseUrl` all `"omitted"`.
- Optional `gitCommitSha`: the first 7 characters of `VERCEL_GIT_COMMIT_SHA`
  when the trimmed value is 7-40 hexadecimal characters. Omitted when it is
  missing or does not match.

Exception: non-production runtime with no database configured:

- If `UAIS_CORE_DATABASE_URL`, `DATABASE_URL`, and `POSTGRES_URL` are all unset
  or blank, and the runtime is not production, the response is still HTTP `200`
  / `status: "ok"`, with `checks.database: "not-configured"` and
  `checks.migrations: "not-configured"`.
- "Production" means any of `VERCEL_ENV`, `NODE_ENV`, or `UAIS_DEPLOYMENT_ENV`
  is exactly `production`.

Unhealthy (HTTP `503`, `status: "degraded"`, not HTTP 200 with a warning):

- `checks.database: "unreachable"` and `checks.migrations: "unknown"` when the
  pool cannot be created, `SELECT 1` fails, or the probe exceeds its 8-second
  deadline or throws.
- `checks.migrations: "behind"` in every runtime: the ledger is readable but
  is missing at least one version in `UAIS_CORE_DATABASE_MIGRATION_VERSIONS`.
  `checks.database` stays `"ok"`. The body adds `migrationCurrency` with
  `expected` (that version count), `missing` (absent version names), and
  `valueRedacted: true`.
- `checks.database: "ok"` and `checks.migrations: "unknown"`: the ledger could
  not be read. No `migrationCurrency`.
- `checks.database` or `checks.migrations` is `"not-configured"` in a production
  runtime.
- Same `service`, `checks`, cache, and redaction rules as a healthy response.

`checks.app: "ok"` alone does not prove the site is healthy. Auth-provider and
production-storage readiness stay on their own checks.

## App Session

### `POST /api/auth/app-session`

Purpose: issue the UAIS signed app-session cookie pair for student, teacher, or
trusted-provider admin access.

Request JSON:

```json
{
  "account": "string",
  "password": "string",
  "from": "/optional-return-path"
}
```

Success:

- `200`
- Sets `uais_app_session` and `uais_app_session_signature` as HttpOnly cookies.
- Body includes `status: "ok"`, `redirectTarget`, `appSession`, and
  `authProviderContract`.

Failure:

- `400` when account/password is missing or the JSON body is malformed.
- `401` when credentials do not match an authorized account.
- `503` when the app auth provider is not production-ready.
- `503` when a deployed environment lacks an explicit session signing secret.

Production local-demo auth must stay blocked even if a legacy demo-auth flag is
present.

### `DELETE /api/auth/app-session`

Purpose: sign out by expiring both app-session cookies.

Success:

- `200`
- Body includes `status: "signed-out"`.
- Clears `uais_app_session` and `uais_app_session_signature`.

## Teaching Courses

### `GET /api/teaching/courses`

Purpose: read teaching-course management data for an authenticated teacher or
student.

Auth:

- Signed teacher session, signed teacher app session, or signed student app
  session.

Success:

- `200`
- Teachers receive course/class/membership data plus a read receipt.
- Students receive only scoped memberships and course/class data allowed by
  their membership.

Failure:

- `401` when no accepted signed session is present.
- `503` in production when the relevant auth provider is not production-ready.
- Store errors return redacted error responses.

### `POST /api/teaching/courses`

Purpose: create a teacher-owned course draft and associated storage receipts.

Auth:

- Signed teacher session.

Success:

- `201`
- Body includes created course data, trace id, receipt, and redaction metadata.

Failure:

- `401` when teacher authentication is missing.
- `403` when the actor is not allowed to create the course.
- `400` for invalid draft input. Body includes `validation.target:
  "teaching-course-create"`, `validation.reasonCode`, `validation.field`, and
  redaction metadata.
- `413` when the draft body exceeds the route body limit. Body includes the same
  redacted `validation` contract.
- `503` in production when teacher auth/storage readiness is not satisfied.

### `POST /api/teaching/invite-codes/{code}/join`

Purpose: let a signed student join a class by invitation code.

Auth:

- Signed student app session.

Success:

- `201`
- Body includes `membership`, `receipt`, `traceId`, and redaction metadata.

Failure:

- `401` when a signed student session is missing.
- `403` when a teacher session calls the student-only route.
- `403` when the student is out of scope or already enrolled.
- `404` when the invite code does not match an active class.
- `503` in production when the app auth provider is not production-ready.

## Learning Records

### `POST /api/learning-records/events`

Purpose: enqueue an xAPI-shaped learning event for a signed student.

Auth:

- Signed student app session.

Success:

- `202` when the event is accepted or queued.

Failure:

- `400` when the request body is not a valid learning event.
- `401` when no signed student session is present.
- `403` when `actorId` does not match the signed student or course membership
  is missing.
- `424` when the queue is blocked.

### `GET /api/learning-records/analytics`

Purpose: summarize xAPI-shaped learning records for scoped learner, teacher, or
admin views.

Query parameters:

- `scope`: `learner-profile`, `learner-timeline`, `teacher-class-insights`, or
  `admin-tenant-insights`.
- Optional: `actorId`, `courseId`, `classId`, `auditReason`.

Success:

- `200`
- Body includes `target`, `status: "summarized"`, `scope`, access metadata,
  query metadata, and summary data.
- `learner-profile` returns a B-17 profile projection with completed lessons,
  weak/mastered competencies, lesson scores, and a deterministic learner
  fingerprint. Raw responses, display names, local files, and plaintext account
  ids are omitted.

Failure:

- `400` for invalid scope.
- `401` when app session is required but missing.
- `403` when learner, teacher, or admin scope checks fail.

## Learning AI Guide

### `POST /api/learning/ai-guide`

Purpose: answer learner questions using the approved provider interface and the
learning-guide graph.

Request JSON:

- `agentId`
- `mode`
- `locale`
- `question`
- optional `course`
- optional `slide`

Auth:

- Signed app session with course access.

Production note:

- Provider keys and live provider calls require owner-approved environment
  configuration. Do not expose provider secrets through client variables or
  logs.

## Classroom lessons, accounts, and student evidence

The classroom flow uses the managed Postgres course/chat backend and core
database migrations through `0016_classroom_submission_images`. Course and class
ownership remain authoritative in the managed course snapshot; a newly created
course can exist there before its first lesson creates normalized course rows.
Authenticated JSON and media responses are not public cacheable assets.

| Route | Methods | Classroom contract |
| --- | --- | --- |
| `/api/teaching/courses/{courseId}/lessons` | GET, POST | List authored lessons; import a `LessonPackageV1`, a saved teaching draft, or a blank draft. POST uses an `idempotency-key`. |
| `/api/teaching/courses/{courseId}/lessons/{lessonKey}` | GET, PATCH | Read/edit an owned draft with `expectedRevision`; `GET ?preview=true` returns only student materials. |
| `/api/teaching/courses/{courseId}/lessons/{lessonKey}/publish` | POST | Publish the expected draft revision to owned `targetClassIds` with selected `taskIds`. The immutable lesson version and its tasks commit atomically; retries reuse the idempotency key. |
| `/api/learning/courses/{courseId}/lessons` | GET | List lessons published to an approved class selected by `classId`. |
| `/api/learning/courses/{courseId}/lessons/{lessonKey}` | GET | Read student materials for that class. An `activityId` pins the corresponding published lesson version. |
| `/api/teaching/courses/{courseId}/classes/{classId}/roster` | GET, POST | List accounts provisioned through this classroom; POST actions are `preview`, `import`, and `reissue`. Requires database account authentication and the owning teacher's signed sessions. |
| `/api/auth/first-password` | POST | Consume the short-lived first-password setup cookie and set a 12–128 character password different from the initial credential. A successful transaction activates the account and issues the normal student session. |

Teacher lesson drafts and `teacherGuide` are never included in student lesson
responses. Student projections allowlist student materials; media embedded in
that authenticated JSON follows the same class membership check, without a
separate public media URL. Student-facing media notes are public to the class,
so private answers belong in `teacherGuide`. Formative checkpoint explanations
are released only after the learner attempts the checkpoint. The source lesson
package, including its teacher answers, is a teacher artifact.

Roster CSV accepts only `account`, `displayName`, and optional `email`, with at
most 100 students and 100 KB. Import always creates student accounts, never
trusts an imported role, and preserves existing passwords and memberships.
New initial credentials appear only in the successful authenticated response;
the database stores their hashes. A lost response is recovered by refreshing
the account list and explicitly reissuing credentials for an unactivated
account. Reissue and activation invalidate earlier setup tokens. Importing an
account does not approve course membership: the student still uses the class
invitation and teacher approval flow.

Teacher lesson summaries include `draftTaskCount`, `hasUnpublishedDraft`, and
`latestRelease` (version, saved draft revision, target class IDs and the current
published task count for that version). Published tasks are counted per target
class; older versions and draft/archived tasks are excluded. A newer saved draft
revision indicates unpublished edits, not a semantic comparison of its text.

`GET /api/teaching/activities/{activityId}/submissions` also returns `counts`
independent of its page, cursor and state filter. Its audience is the exact
target class's approved, active, activated students in the course snapshot.
`notSubmitted` (no submission or current draft) plus `submitted` equals
`totalStudents`. `awaitingReview` counts submitted/resubmitted work;
`revisionRequested` includes a revision draft following a released request;
`feedbackReleased` counts students who have received released teacher feedback,
including historical feedback. Revision and feedback indicators can overlap
with the current-state partition and must not be added to it.

### Submission images and confirmed submission

- `PUT /api/learning/activities/{activityId}/submission` saves a draft against
  `expectedSubmissionVersionId` and `expectedDraftRevision`. Empty draft text is
  permitted to prepare image-only work.
- `POST /api/learning/activities/{activityId}/submission/images` accepts one
  multipart `image`, `expectedSubmissionVersionId`, `expectedDraftRevision`, and
  stable UUID `clientAttachmentId`. Only PNG/JPEG, at most 1 MiB per image and
  three images per version, are accepted. Full decode/re-encoding strips image
  metadata; bytes stay in private Postgres storage.
- `DELETE /api/learning/activities/{activityId}/submission/images/{attachmentId}`
  removes an image only from the caller's editable draft with the expected
  version/revision. Sealed versions remain immutable.
- `GET /api/learning/submission-images/{attachmentId}` requires the submission
  owner's current class access or the authorized course teacher's review
  access. It returns `private, no-store` media with `nosniff`; identifiers are
  not bearer capabilities.
- `POST /api/learning/activities/{activityId}/submission/submit` requires a
  stable `idempotency-key`, the expected version/revision, and at least text or
  one saved image. The text and ordered image hashes are sealed together.
  Response-loss recovery reads the server state and reuses the original key;
  an uncertain response is not presented as a confirmed failure or success.

Images and feedback follow their immutable submission version. A requested
revision creates a new draft with copies of the prior version's images; changes
cannot alter the previous sealed evidence. Current AI feedback drafts use text
only; attached images remain available for teacher review and are not silently
represented as model-reviewed evidence.

### Discussion archive and retention

`GET /api/learning/chatroom/history` retains the course/group ACL for every
request. Normal reads return the latest 200 personal or 500 group messages;
`archive=1` with an optional `before` message ID returns an earlier 100-message
page and `transcript.archivePage.nextCursor`. Hidden messages are omitted from
all student/export/share projections. The complete archive is a separate
Postgres per-message record written in the same transaction as the live window.
Authenticated print/PDF export reads the archive, while public shares retain
their existing recent-window scope and expiry. Archiving includes only messages
still retained when the feature is enabled; previously discarded messages are
not recovered. The default read budget is 30/minute and 10,000/day per actor per
server process, independent of provider-spend limits.

`GET /api/teaching/courses/{courseId}/retention` returns the owning teacher's
current record counts, closure/expiry timestamps, purge eligibility, and a
confirmation digest. It is read-only, including for courses with no normalized
lesson rows yet. `POST` accepts either:

- `{ "action": "close", "confirm": true }`: close the record period now and
  retain existing records for 180 days. New student work, enrolment/group
  mutations, and chat messages stop; existing feedback can still be reviewed.
- `{ "action": "purge", "confirm": true, "confirmationDigest": "..." }`:
  after expiry, remove the records in a fresh preview. A changed preview or an
  unexpired period is rejected. There is no automatic deletion job.

The retention route requires Postgres course/chat storage; external/local JSON
backends receive `503 course-retention-postgres-required`. Retention POST uses
the shared same-origin browser check in addition to signed role and ownership
checks. Purge removes the course's student submissions, images,
feedback, learning projections/events, discussion records and relevant private
records in retired database snapshots. Accounts, course/lesson materials,
unrelated courses, and teacher content-publication provenance remain. The
aggregate purge receipt remains; external backups and downloaded copies are
outside this operation. Course transaction locks and a retained tombstone
prevent delayed requests from recreating deleted classroom records.

## Not Yet Product Contracts

The following route families are implementation or experimental surfaces until
they are reviewed, reduced, or promoted:

- `/api/ai/voice-*`
- `/api/ai/ppt-narration*`
- `/api/external-storage/*`
- `/api/teaching/operations/*`
- `/api/teaching/gradebook-updates/*`
- release/evidence/readiness routes and scripts

Document or test them only when a concrete product journey depends on them.
