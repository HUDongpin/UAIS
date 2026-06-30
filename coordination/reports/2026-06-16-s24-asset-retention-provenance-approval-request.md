# S24 Asset Retention And Provenance Approval Request

- Date: 2026-06-16
- Request owner: S24
- Supporting sessions: S07, S12, S19, S11, S22, S10
- Purpose: Define the lifecycle and provenance policy for teacher voice samples, Qwen cloned voice references, and generated PPT narration audio.
- Redaction rule: no real API keys, cloned voice ids, local teacher sample paths, approval tokens, or raw audio payloads are recorded here.

## Current State

UAIS has local private asset helpers:

- Teacher voice samples: ignored `.tmp` storage through `src/lib/ai/voice/sample-assets.ts`.
- Qwen cloned voice references: ignored `.tmp` registry through `src/lib/ai/voice/cloned-voice-registry.ts`.
- PPT narration WAV files: ignored `.tmp` storage through `src/lib/ai/voice/ppt-narration-assets.ts`.

This is appropriate for local owner-controlled smoke tests. Production needs explicit retention, deletion, and provenance rules before teacher-uploaded voice assets are treated as durable product data.

## Recommended Choice

Approve **S24 方案 A: private asset manifests with retention metadata and revocation hooks**.

This keeps asset bytes private and gives every asset a small redacted manifest that can be audited, deleted, or expired.

## Asset Classes

| Asset class | Private material | Public reference |
| --- | --- | --- |
| Teacher voice sample | Uploaded audio bytes | `sampleAssetId` |
| Qwen cloned voice reference | Real provider cloned voice id | `voiceRefId` and `server-side-cloned-qwen-voice` |
| PPT narration audio | WAV bytes generated from cloned voice | `audioManifestId`, `audioId`, download URL |

## Required Provenance Fields

Each manifest should record:

- `assetId` or `voiceRefId` or `audioManifestId`
- `teacherId`
- `courseId` and `pptAssetId` where applicable
- `consentScope: "ppt-narration"`
- `provider: "qwen"` where applicable
- `providerRole`
- `createdAt`
- `retentionClass`
- `expiresAt` or `deleteWithCourse`
- `responsibleSession: "S24/S12"` or `"S07/S12/S24"`
- `redaction: "private-by-default"`

The manifest must not record:

- API keys
- approval tokens
- raw base64 audio
- real cloned voice ids in public manifests
- local absolute paths

## Proposed Retention Classes

| Retention class | Default behavior |
| --- | --- |
| `teacher-sample-active-consent` | Retain while teacher consent and course/PPT workflow remain active. Delete on consent revocation or course archive cleanup. |
| `cloned-voice-active-consent` | Retain provider voice id only server-side while the teacher voice clone is authorized. Delete/revoke on consent revocation. |
| `ppt-narration-courseware` | Retain generated WAV assets while the PPT/courseware version is active. Delete with courseware version cleanup. |
| `smoke-test-temporary` | Local-only; safe to delete after verification. |

## Production Deletion Rules

S24 should require future deletion functions for:

1. Delete teacher sample by `sampleAssetId`.
2. Delete cloned voice reference by `voiceRefId`.
3. Delete PPT narration manifest and all related `audioId` WAV files.
4. Delete all assets for a teacher/course when consent is revoked or a course is archived.

Provider-side voice deletion/revocation should be documented separately if Qwen exposes a deletion endpoint for the selected model/provider path.

## Acceptance Criteria

S24 retention/provenance work is complete when:

- Teacher sample, cloned voice reference, and PPT audio helpers write redacted provenance metadata.
- Tests prove manifests do not contain local paths, API keys, raw audio, or real cloned voice ids in public fields.
- Tests prove assets can be deleted by public ids without path traversal.
- Tests prove expired or deleted assets are not downloadable.
- S12 download routes honor asset ownership and deletion state once auth guards are approved.
- `npm run test`, `npm run lint`, and `npm run build` pass.

## Out Of Scope

- Picking the final production object-storage provider.
- Implementing S05 teacher workflow UI.
- Vercel deployment configuration.

## Explicit Approval Needed

Please approve one of these:

- `批准 S24 方案 A` — implement private asset manifests, retention metadata, and deletion helpers.
- `修改 S24 方案 A: ...` — revise before coding.
- `暂缓 S24` — keep local `.tmp` smoke-test storage only for now.
