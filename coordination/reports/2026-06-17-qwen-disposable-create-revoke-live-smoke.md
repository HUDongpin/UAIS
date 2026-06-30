# Qwen Disposable Voice Create/Revoke Live Smoke

- Date: 2026-06-17
- Time: 02:01 HKT
- Owner sessions: S24 Asset and Export Quality, S12 Backend/API Platform, S19 API Configuration
- Verification sessions: S11 Regression Quality, S22 Build Quality, S25 Safety Scan
- Provider: Qwen / DashScope
- Target model: `qwen3-tts-vc-realtime-2026-01-15`
- Redaction rule: no provider keys, private cloned voice IDs, local private registry paths, raw/base64 audio, or original teacher sample paths are recorded here.

## Objective

Close the remaining disposable Qwen lifecycle gap by proving that UAIS can:

1. Create a disposable Qwen cloned-voice reference through an approved live smoke.
2. Store the private provider voice ID only in the local private registry.
3. Revoke the same disposable provider voice through Qwen.
4. Delete the local private registry record after provider revoke succeeds.
5. Write redacted lifecycle/deletion audit evidence.

## Implementation

- Added `scripts/qwen-voice-disposable-create-smoke.mjs`.
- Extended `scripts/qwen-voice-revoke-smoke.mjs` so live prerequisite output correctly reflects `--env-file` provider-key availability.
- Added `tests/qwen-voice-disposable-create-smoke-cli.test.ts`.
- Extended `tests/qwen-voice-revoke-smoke-cli.test.ts` to verify `--env-file` status is reported as S19 `present` during approved live execution.

## Live Smoke Result

| Step | Responsible sessions | Result |
| --- | --- | --- |
| Disposable sample preparation | S24 | Local synthetic WAV sample prepared, PCM 16-bit mono 24 kHz, 12.58 seconds. |
| Qwen disposable create | S24/S12/S19 | HTTP 200, redacted output, public disposable `voiceRefId` returned, local private reference stored. |
| Qwen disposable revoke | S24/S12/S19 | HTTP 200, provider voice revoked, local private reference deleted. |
| Local disposable registry inventory | S24/S25 | No `qwen-voice-ref-disposable-*.json` record remained after revoke. |

The smoke used a disposable public voice reference with prefix `qwen-voice-ref-disposable-`. It did not use the Kang Xia production voice reference and did not expose the Qwen private provider voice ID.

## Checks

- `npm run test -- tests/qwen-voice-disposable-create-smoke-cli.test.ts`: RED failed before implementation because the CLI script was missing.
- `npm run test -- tests/qwen-voice-disposable-create-smoke-cli.test.ts`: passed after implementation, 3 tests.
- `node scripts/qwen-voice-disposable-create-smoke.mjs --dry-run --teacher-id disposable-teacher --sample-asset-id s24-delete-smoke-sample`: passed with redacted dry-run plan.
- `npm run test -- tests/qwen-voice-disposable-create-smoke-cli.test.ts tests/qwen-voice-revoke-smoke-cli.test.ts`: RED failed after adding S19 env-file status assertions; passed after script fixes, 6 tests.
- Approved live create smoke: passed with Qwen HTTP 200.
- Approved live revoke smoke: passed with Qwen HTTP 200.
- Disposable registry cleanup check: passed with no disposable JSON record remaining.
- `npm run test`: passed, 14 files and 143 tests.
- `npm run lint`: passed.
- `npm run build`: passed.
- S25 targeted redaction scan found only test fixtures and script safety-pattern literals, not real provider keys, private cloned voice IDs, WeChat temporary paths, or raw/base64 audio in the new scripts/reports/logs.

## Remaining Risk

This closes the local disposable create/revoke lifecycle proof. Production still needs durable storage, durable audit backend, production lifecycle jobs, deployed route smoke, and real auth/session-provider integration before public use.
