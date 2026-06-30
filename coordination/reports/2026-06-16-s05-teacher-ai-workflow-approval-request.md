# S05 Teacher AI Workflow Approval Request

- Date: 2026-06-16
- Request owner: S05
- Supporting sessions: S07, S12, S19, S24, S11, S22, S10
- Purpose: Obtain explicit owner approval before implementing the teacher-facing Qwen voice/PPT workflow in `src/components/pages/teaching-page.tsx`.
- Redaction rule: This request contains no real API keys, real cloned voice ids, local teacher sample paths, or raw audio payloads.

## Recommended Choice

Approve **方案 A: compact workflow panel inside the existing Enterprise AI Orchestration section**.

This keeps the workflow close to the current teacher workspace, avoids a modal/wizard interruption, and lets every responsible session appear in the teacher-visible progress text.

## Why This Is The Right Next Step

The backend is already locally proven:

- S07/S12: OpenMAIC-style director/agent loop and AI routes exist.
- S19: local `.env.local` is placed and redacted smoke checks pass.
- S24/S12: teacher voice sample assets, cloned voice references, and PPT WAV assets are server-side/private.
- S11/S22: tests, lint, and build passed after the latest cloned voice registry work.

The remaining user-visible gap is that the teacher page still behaves like a button/log workbench. It does not yet guide the teacher through the actual flow:

1. Register/select a consented 10-second teacher voice sample.
2. Run live preflight with S07/S12/S19/S24 status labels.
3. Receive a public `voiceRefId` while hiding the real Qwen cloned voice id.
4. Generate PPT narration from `clonedVoiceRef`.
5. Download per-slide WAV assets.

## Proposed UI Shape

Use a compact vertical workflow with four rows:

| Step | Responsible sessions shown | Visible state |
| --- | --- | --- |
| Voice sample | S24/S12 | `stored`, duration, consent scope |
| Live preflight | S07/S12/S19/S24 | ready/blocked chips for each session |
| Voice reference | S07/S12/S24 | public `voiceRefId`, `server-side-cloned-qwen-voice` |
| PPT narration assets | S12/S24 | manifest id, per-slide WAV download buttons |

## Controls

The panel should use existing UAIS visual language and compact buttons:

- `登记声音样本`
- `运行 live 预检`
- `保存 voiceRef`
- `生成 PPT 配音`
- `下载 WAV`

No control should reveal API keys, approval tokens, real cloned voice ids, base64 audio, or local filesystem paths.

## Data Flow

1. `POST /api/ai/voice-sample`
   - Sends consented sample metadata and, in live mode, sample audio payload.
   - Receives `sampleAsset` and `voiceCloneReference`.

2. `POST /api/ai/voice-clone/preflight`
   - Receives S07/S12/S19/S24 readiness checks.
   - UI displays every responsible session in the progress text.

3. `POST /api/ai/ppt-narration`
   - Sends `clonedVoiceRef`, not the real Qwen `clonedVoiceId`.
   - Receives `pptNarrationAssets`.

4. `GET /api/ai/ppt-narration/audio/[manifestId]/[audioId]`
   - Used by visible WAV download buttons.

## Acceptance Criteria

S05 implementation is complete when:

- Teacher page displays the four-step workflow in the Enterprise AI Orchestration section.
- Responsible sessions appear in visible workflow text: S07, S12, S19, and S24.
- UI displays `voiceRefId` and `server-side-cloned-qwen-voice`, not the real provider voice id.
- UI displays at least one WAV download link when `pptNarrationAssets.assets[]` is present.
- `tests/teaching-page.test.tsx` proves the workflow can move from sample registration to voiceRef to PPT WAV asset display with mocked fetch responses.
- `npm run test`, `npm run lint`, and `npm run build` pass.
- Browser inspection of `/teaching` shows no overlapping text and the workflow fits the current UAIS layout.

## Explicit Approval Needed

Please approve one of these:

- `批准方案 A` — implement the compact workflow panel now.
- `修改方案 A: ...` — revise the design before coding.
- `改用方案 B` — use a modal/wizard.
- `改用方案 C` — create a separate management page.

Until approval is explicit, S05 should not edit `src/components/pages/teaching-page.tsx`.
