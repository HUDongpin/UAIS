# UAIS Manual PPT Playback Acceptance Action Packet

Status: `human-qa-needed`
Release gate: `blocked`
Queue rank: 6
Decision: `manual-ppt-playback-acceptance`

Machine preflight does not count as final human acceptance.

## Owner Question

Complete human PPT playback acceptance after production deployment and bind it to the release run.

## Required Applications

- `Microsoft PowerPoint`
- `WPS Presentation`

## Current Evidence Summary

- Evidence status: `plan-blocked`
- Accepted applications: `none-recorded`
- Manual record evidence: `missing`
- Machine preflight: `passed`
- Expected slides: 19
- Checklist slide checks: 19
- Package fingerprint: `present`
- Target voice label: `present`
- Manual record release-run binding: `not-required`
- Manual record deployment binding: `not-required`
- Manual confirmation: `missing`
- Manual record template: `created`

## Required Evidence

- `human-powerpoint-playback-accepted`
- `human-wps-playback-accepted`
- `explicit-accepted-after-human-playback-status`
- `valid-tested-at-timestamp`
- `same-release-run-id-bound-to-manual-record`
- `same-vercel-production-deployment-bound-to-manual-playback-record`
- `all-19-slide-audio-checks-true`
- `target-cloned-voice-label-present`
- `target-cloned-voice-heard-per-slide`

## Command Templates

- Create manual record template: `node scripts/ppt-manual-playback-acceptance.mjs --package-json <kangxia-package-json> --preflight-report <desktop-preflight-report> --openxml-integrity <openxml-integrity-evidence> --desktop-app-evidence <desktop-app-evidence> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> --record-template-out <manual-record-template> > <ppt-manual-playback-gate-plan-evidence>`
- Final manual acceptance evidence: `node scripts/ppt-manual-playback-acceptance.mjs --package-json <kangxia-package-json> --preflight-report <desktop-preflight-report> --manual-record <completed-human-manual-record> --openxml-integrity <openxml-integrity-evidence> --desktop-app-evidence <desktop-app-evidence> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence> > <ppt-manual-playback-acceptance-evidence>`

## Safe Next Actions

- `package-manual-ppt-playback-evidence-for-human-review`
- `verify-powerpoint-and-wps-playback-after-production-deployment`
- `bind-manual-ppt-record-to-release-run-and-vercel-deployment`
- `confirm-target-cloned-voice-label-and-per-slide-audio`
- `submit-human-accepted-playback-record-for-release-gate`

## Stop Conditions

- Stop if human PowerPoint and WPS playback have not both been completed.
- Stop if any of the 19 slide audio checks is missing for either application.
- Stop if target cloned voice label or per-slide target voice confirmation is missing.
- Stop if machine preflight or desktop-open evidence is being treated as final human acceptance.
- Stop if the manual record is not bound to the same release run and Vercel production deployment.
- Stop if private PPT package paths, audio URLs, or local reviewer paths would be logged.

## Forbidden Until Approved

- `mark-manual-ppt-accepted-before-human-playback`
- `reuse-manual-ppt-record-from-different-release-run`
- `reuse-manual-ppt-record-from-different-vercel-deployment`
- `accept-missing-target-voice-label-or-slide-audio`
- `log-private-ppt-package-paths-or-audio-urls`
