# UAIS OpenMAIC-Style Multi-Agent Design

## Approval

The owner approved方案 1 on 2026-06-16: build a UAIS-native OpenMAIC-style framework instead of moving the OpenMAIC app wholesale into UAIS.

## Goal

Adopt the public OpenMAIC multi-agent architecture pattern inside UAIS with enterprise boundaries: typed agents, director routing, provider separation, server-only secrets, and a Qwen-backed voice/PPT narration contract.

## Scope

Phase 1 builds the domain and API contract layer that UAIS can safely expand:

- Multi-agent orchestration types and deterministic director loop helpers.
- Provider registry mapping text reasoning to DeepSeek and multimodal work to Alibaba Qwen/Model Studio.
- Voice clone and PPT narration job contracts for a 10-second teacher sample.
- Tests that lock the architecture before UI/provider live calls are added.

Phase 1 does not perform live provider calls, edit `.env.local`, read or print secrets, upload teacher audio, generate real PPT files, or clone a real voice. Those are later S19/S07/S12/S24 coordinated steps after credentials, consent, and cost/rate-limit controls are ready.

## OpenMAIC Mapping

OpenMAIC uses a director graph and agent generation loop. UAIS will preserve that architecture in a smaller form:

- `AgentConfig`: teacher, assistant, student, and specialist roles with allowed actions and provider profile.
- `DirectorDecision`: the routing decision for next speaker, user cue, or end.
- `AgentTurn`: one agent response plus action metadata.
- `AgentLoop`: repeated director decisions until the conversation cues the user, ends, or hits a safety limit.

UAIS will not copy OpenMAIC UI/editor/media code directly. The implementation remains source-distant and tailored to UAIS routes, data, copy, and testing.

## Provider Boundary

Text reasoning uses DeepSeek by default:

- Logical role: `text-reasoning`
- Required env variable names: `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL`, optional `DEEPSEEK_MODEL`
- Default model id: `deepseek-v4-flash`

Multimodal, image, voice, and PPT narration use Alibaba Qwen/Model Studio by default:

- Logical roles: `multimodal`, `image-generation`, `voice-clone`, `ppt-narration`
- Required env variable names: `DASHSCOPE_API_KEY`, optional `DASHSCOPE_BASE_URL`, optional role-specific model variables
- Default voice model family: Qwen-TTS compatible voice cloning/synthesis

Only server-side modules and route handlers may read provider env variables. Client components receive redacted readiness DTOs and job status only.

## Voice And PPT Contract

UAIS represents teacher voice cloning as a job request:

- Input: teacher id, consent flag, sample asset pointer, sample duration seconds, language, target voice label.
- Validation: consent must be true, sample duration must be at least 10 seconds, provider role must be `voice-clone`.
- Output: redacted job object with provider id, status, voice id placeholder, and no secret values.

PPT narration is a separate job request:

- Input: course id, PPT asset pointer, cloned voice id, slide scripts, target language.
- Validation: cloned voice id and at least one slide script are required.
- Output: redacted job object with provider id, status, slide count, and audio manifest placeholder.

## Enterprise Requirements

- Keep secret values out of code, docs, tests, logs, screenshots, and client bundles.
- Keep All API Keys.docx as an approved local source only; do not copy values from it into Git.
- Keep provider roles typed so DeepSeek and Qwen responsibilities cannot drift silently.
- Keep deterministic tests for orchestration, provider routing, and voice/PPT validation.
- Add live provider smoke tests only after S19 confirms redacted environment readiness and owner approves cost/rate-limit risk.

## Acceptance Criteria

- Tests prove the director can route a mentioned agent and stop on user/end decisions.
- Tests prove provider registry maps text reasoning to DeepSeek and multimodal/voice/PPT roles to Qwen.
- Tests prove a 10-second teacher sample is accepted for voice clone jobs and shorter samples are rejected.
- Tests prove PPT narration jobs require a cloned voice id and scripts.
- No real credential values are read, printed, or committed.
