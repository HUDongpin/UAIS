# S12 Production Auth And Session Approval Request

- Date: 2026-06-16
- Request owner: S12
- Supporting sessions: S07, S19, S24, S11, S22, S10
- Purpose: Define the production authorization boundary required before UAIS live AI routes are exposed beyond local owner-controlled testing.
- Redaction rule: no real API keys, cloned voice ids, local teacher sample paths, approval tokens, or raw audio payloads are recorded here.

## Current State

UAIS currently has a strong internal live-provider gate:

- `liveProviderApproved: true` is required in the request body.
- `x-uais-live-ai-approval` must match `UAIS_LIVE_AI_APPROVAL_TOKEN`.
- Provider audit events omit secrets, local files, and raw assets.
- Local `.env.local` is placed and smoke-verified.

This is enough for owner-controlled local live smoke, but it is not enough for a deployed teacher-facing product. Production must bind requests to a user/session and to owned course/sample/PPT/audio resources.

## Recommended Choice

Approve **S12 方案 A: route-level actor context and ownership guard**.

This keeps the current API routes and adds a shared server-side guard before any live provider call or private asset download.

## Proposed Server Contract

Add a future shared helper, tentatively under `src/lib/server/ai-access-control.ts`, with these concepts:

```ts
type UaisAiActor = {
  actorId: string;
  role: "teacher" | "admin";
  courseIds: string[];
};

type UaisAiResourceScope = {
  teacherId?: string;
  courseId?: string;
  pptAssetId?: string;
  sampleAssetId?: string;
  voiceRefId?: string;
  audioManifestId?: string;
};
```

The helper should return a redacted decision:

- `status: "authorized" | "denied"`
- `responsibleSession: "S12"`
- `reasonCode`, not raw secrets or private paths

## Routes That Need Production Guards

| Route | Required production guard |
| --- | --- |
| `POST /api/ai/chat` live mode | Actor is a teacher/admin for the relevant course or classroom context. |
| `POST /api/ai/voice-sample` live mode | Actor is the teacher/admin authorized to create the sample and submit Qwen voice clone. |
| `POST /api/ai/voice-clone/preflight` | Actor can inspect readiness for that teacher/sample. |
| `POST /api/ai/voice-clone/status` live mode | Actor owns or administers the provider task reference. |
| `POST /api/ai/ppt-narration` live mode | Actor owns the course/PPT and the referenced server-side cloned voice. |
| `GET /api/ai/ppt-narration/audio/[manifestId]/[audioId]` | Actor owns or administers the generated audio manifest. |
| `GET /api/ai/readiness` and `/api/ai/smoke-plan` | Admin-only in production; local/dev can remain redacted. |

## Production Request Flow

1. Resolve actor context from the future UAIS auth/session layer.
2. Validate actor role and course/sample/voice/audio ownership.
3. Enforce the existing live approval token for live provider calls.
4. Call DeepSeek/Qwen only after both actor authorization and provider approval pass.
5. Return redacted audit events with actor/resource ids only.

## Acceptance Criteria

S12 production auth work is complete when:

- All live AI routes call a shared authorization helper before any provider client can run.
- PPT audio downloads reject unauthorized access before reading local/private asset bytes.
- Tests prove unauthorized live calls do not call fake DeepSeek/Qwen clients.
- Tests prove unauthorized audio downloads do not call fake asset readers.
- Audit output contains only ids/status/reason codes, never keys, approval tokens, private voice ids, local paths, or raw audio.
- `npm run test`, `npm run lint`, and `npm run build` pass.

## Out Of Scope

- Choosing the final auth provider.
- Building account management UI.
- Vercel deployment.
- Changing the S05 teacher workflow UI.

## Explicit Approval Needed

Please approve one of these:

- `批准 S12 方案 A` — implement shared route-level actor context and ownership guards.
- `修改 S12 方案 A: ...` — revise before coding.
- `暂缓 S12` — keep local live gate only for now.
