# UAIS Adaptive Recommendation Foundation

Status: B-18 deterministic service foundation.
Created: 2026-07-08.

This note documents the small adaptive-learning slice added from the technical
advisory. It is not a production personalization engine and it does not call an
LLM. The current implementation creates reproducible next-step recommendations
from ordered lessons plus sanitized learning evidence.

## Implementation

- Service: `src/lib/adaptive-learning/recommendations.ts`
- Learner profile source: `src/lib/learning-records/learner-profile.ts`
- Tests: `tests/adaptive-recommendations.test.ts`
- Rules version: `deterministic-v1`
- Input: course id, ordered lesson metadata, and learning evidence.
- Output: status, next lesson id, deterministic reason code, rationale, source
  event id, rule version, and privacy-minimized evidence summary.

## Rules

1. If the course has no ordered lessons, return a blocked recommendation.
2. If no learning evidence exists, recommend the first ordered lesson.
3. If an incomplete lesson has latest evidence below its mastery threshold,
   recommend that lesson again before advancing.
4. Otherwise recommend the first incomplete ordered lesson.
5. If all ordered lessons are complete, return a complete recommendation with no
   next lesson id.

The default mastery threshold is `0.7`. A lesson can override it with
`masteryThreshold`.

## Privacy Boundary

The xAPI adapter intentionally ignores learner identities and raw responses. The
recommendation output records only aggregate evidence fields:

- considered lesson count
- event count
- latest/source event ids
- completed lesson ids
- weak competency ids
- `rawResponsesOmitted: true`
- `learnerIdentityOmitted: true`

This follows the privacy baseline and keeps recommendations reproducible without
making student free text or account identifiers part of the recommendation
contract.

`docs/learner-profiles.md` records the B-17 profile projection that summarizes
the same xAPI evidence into queryable per-learner progress. The current
recommendation service still runs on demand; writing durable recommendation
records remains part of the future managed-database migration.

## Next Decisions

- Choose the managed database and migration tool before persisting
  `learner_profiles` or `recommendations`.
- Approve the first pilot lesson taxonomy and mastery thresholds.
- Decide whether recommendation records are created on demand, scheduled, or
  written after specific learning events.
