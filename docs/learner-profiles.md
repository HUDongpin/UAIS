# UAIS Learner Profile Projection

Status: B-17 profile projection foundation.
Created: 2026-07-08.

UAIS now has a deterministic learner-profile projection over persisted
xAPI-shaped learning events. This is a queryable adaptive-learning foundation,
not the final managed database migration.

## Implementation

- Profile projector: `src/lib/learning-records/learner-profile.ts`
- Analytics route scope: `GET /api/learning-records/analytics?scope=learner-profile`
- Tests: `tests/learner-profile.test.ts`
- Rules version: `xapi-profile-v1`

The projector reads sanitized LRS/xAPI statements and returns:

- completed lesson ids
- lesson-level event counts
- best and average score by lesson
- weak competency ids
- mastered competency ids
- course/class context references
- a deterministic learner fingerprint

## Privacy Boundary

The profile output does not include raw learner responses, learner display names,
local file paths, provider credentials, or plaintext account ids. The learner id
is represented as a deterministic fingerprint so the response is stable for
querying without printing the account value.

## Access Model

- Student: may query only their own `learner-profile`.
- Teacher: may query a learner profile only inside a class they own and only for
  approved class membership.
- Admin: tenant-level analytics remains audit-gated and does not bypass learner
  or teacher profile rules.

## Remaining Work

- Persist `learner_profiles` in the future managed database selected for B-11/B-12.
- Add a background or event-driven profile refresh once the database migration is
  approved.
- Run deployed browser checks for the learner profile surface after the full
  production build blocker is resolved.
