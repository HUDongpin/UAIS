# Qwen Disposable Voice Revoke Smoke Harness

- Date: 2026-06-17
- Owner: S24 Asset and Export Quality
- Supporting sessions: S12 Backend/API Platform, S19 API Configuration, S11 Regression Quality, S25 Safety Scan
- Scope: Add a disposable-only live smoke harness for Qwen cloned-voice revocation without risking the production Kang Xia voice reference.
- Redaction rule: This report records only script behavior, session ownership, test status, and redacted prerequisite state. It does not record provider API keys, private cloned voice IDs, local private registry paths, source voice-sample paths, raw/base64 audio, or provider response bodies.

## What Changed

- Added `scripts/qwen-voice-revoke-smoke.mjs`.
- Live mode requires `--approved`, `--voice-ref-id`, and `DASHSCOPE_API_KEY`.
- The script accepts only voice references with prefix `qwen-voice-ref-disposable-`.
- Non-disposable voice references, including the Kang Xia production voice reference shape, are rejected before provider revoke execution.
- When live execution is approved for a disposable record, the script:
  - reads the local private registry record,
  - calls Qwen's voice customization delete action,
  - deletes the local private registry record only after provider success,
  - writes a redacted local deletion audit record,
  - appends a redacted lifecycle audit event,
  - prints only redacted status metadata.

## Verification

| Check | Result |
| --- | --- |
| RED test | `npm run test -- tests/qwen-voice-revoke-smoke-cli.test.ts` failed before implementation because the script did not exist |
| Mock live disposable revoke | Passed; script sent one provider delete request, deleted the temp registry file, wrote redacted local/lifecycle audit records, and omitted fake secret/private voice id/temp path from output |
| Non-disposable guard | Passed; non-disposable voiceRef rejected with a disposable-prefix error |
| Approval guard | Passed; live mode without `--approved` rejected |
| Dry run | `node scripts/qwen-voice-revoke-smoke.mjs --dry-run` printed redacted prerequisite status only |
| Targeted tests | `npm run test -- tests/qwen-voice-revoke-smoke-cli.test.ts tests/ai-env-and-smoke.test.ts`: 2 files, 19 tests passed |
| Full tests | `npm run test`: 13 files, 140 tests passed |
| Lint | `npm run lint`: passed |
| Build | `npm run build`: passed |

## Current Live Status

Actual Qwen live delete smoke was not executed in this pass.

Reason: the local Qwen cloned-voice registry currently has no `qwen-voice-ref-disposable-*` record. It has the production Kang Xia voice reference only, and the new harness intentionally refuses to use that record for delete smoke.

## Next Safe Live Step

Create or provide a disposable Qwen cloned voice reference, then run:

```bash
node scripts/qwen-voice-revoke-smoke.mjs --live --approved --voice-ref-id qwen-voice-ref-disposable-... --env-file <server-only-env>
```

Do not use a production teacher voice reference for this smoke.
