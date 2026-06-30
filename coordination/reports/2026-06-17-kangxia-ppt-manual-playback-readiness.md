# Kang Xia PPT Manual Playback Readiness

- Date: 2026-06-17
- Responsible sessions: S24 Asset and Export Quality, S22 Production Reliability
- Scope: Readiness evidence for the remaining human PowerPoint/WPS playback acceptance of the Kang Xia narrated PPTX.
- Status: Ready for human playback QA, not manually accepted.
- Redaction rule: This report records app names, app versions, relative artifact locations, counts, and structural check results only. It does not include provider API keys, approval tokens, private cloned voice IDs, source voice sample paths, raw/base64 audio, or original local source paths.

## Target Desktop Apps

| Application | Installed status | Version evidence |
| --- | --- | --- |
| Microsoft PowerPoint | Present | `16.110` |
| WPS Office / WPS Presentation | Present | `7.2.2` |
| LibreOffice | Present | `26.2.3.2` |
| Keynote | Present | `14.1` |

Microsoft PowerPoint and WPS Office are the required manual playback targets for the production E2E acceptance gate. LibreOffice and Keynote are present as supporting/open-render tools only; they do not replace the required PowerPoint/WPS manual acceptance.

## Artifact Readiness

| Artifact | Relative path | Readiness result |
| --- | --- | --- |
| Narrated PPTX | `.tmp/uais-ai-assets/ppt-narration-pptx/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1-kangxia-narrated.pptx` | Present, 34 MB |
| Source WAV folder | `.tmp/uais-ai-assets/ppt-narration/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/` | Present, 19 WAV files |
| ZIP export | `.tmp/uais-ai-assets/ppt-narration-exports/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1-ppt-narration.zip` | Present, 13 MB |
| LibreOffice PDF render | `.tmp/uais-ai-assets/ppt-narration-pptx/render-check/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1-kangxia-narrated.pdf` | Present, 3.4 MB |
| Render contact sheet | `.tmp/uais-ai-assets/ppt-narration-pptx/render-check/kangxia-narrated-contact-sheet.jpg` | Present |
| Manual checklist | `coordination/reports/2026-06-17-kangxia-ppt-manual-playback-acceptance-checklist.md` | Present |
| Manual acceptance record template | `coordination/reports/2026-06-17-kangxia-ppt-manual-acceptance-record-template.json` | Present, defaults to not accepted |
| Template gate evidence | `coordination/reports/2026-06-17-kangxia-ppt-manual-template-gate.json` | Present, blocked as expected |
| Acceptance gate JSON | `coordination/reports/2026-06-17-kangxia-ppt-manual-playback-acceptance-gate.json` | Present, still blocked pending manual record |

## Checks Run

| Check | Evidence |
| --- | --- |
| Required apps installed | `/Applications` contains `Microsoft PowerPoint.app` and `wpsoffice.app`. |
| App versions detected | macOS metadata returned PowerPoint `16.110`, WPS `7.2.2`, LibreOffice `26.2.3.2`, and Keynote `14.1`. |
| PPTX archive integrity | `unzip -t` reported no compressed-data errors. |
| Source WAV count | `find ... -name '*.wav' | wc -l` returned 19. |
| Manual template safety | Template defaults every PowerPoint/WPS slide to `audioPlays: false` and leaves `releaseRunId` empty, so it cannot satisfy acceptance until a human binds it to the production release run and edits it after playback. |
| Manual template gate | `scripts/ppt-manual-playback-acceptance.mjs` with the template returned `status: "blocked"` and both manual playback blockers. |
| Prior machine preflight | `coordination/reports/2026-06-17-kangxia-ppt-desktop-playback-preflight.md` reports `machine-preflight-passed`. |
| Production E2E gate status | `coordination/reports/2026-06-17-production-e2e-release-gate.json` still blocks on `manual-ppt-playback-not-accepted`. |

## Human QA Procedure

1. Open the narrated PPTX in Microsoft PowerPoint.
2. Start slide show playback.
3. For each slide from 1 to 19, trigger the embedded audio object and confirm the slide narration is audible.
4. Record each slide as `audioPlays: true` only after hearing the audio in PowerPoint.
5. Repeat the same 19-slide playback in WPS Presentation.
6. Save a redacted manual acceptance record with:
   - application name,
   - application version,
   - the same non-secret `releaseRunId` used by the production deployment and smoke evidence,
   - tester role/name,
   - tested timestamp,
   - one `audioPlays: true` entry per slide for both Microsoft PowerPoint and WPS Presentation.
7. Start from `coordination/reports/2026-06-17-kangxia-ppt-manual-acceptance-record-template.json` if useful, but only change a slide to `audioPlays: true` after hearing it.
8. Run `scripts/ppt-manual-playback-acceptance.mjs` with the completed manual record and the same `--release-run-id` value, then refresh the production E2E release gate.

## Non-Completion Statement

This readiness report proves that the required desktop applications, the narrated PPTX artifacts, and a fillable manual acceptance record template are available for manual QA. It does not prove that audio was heard in Microsoft PowerPoint or WPS Presentation. The manual playback acceptance requirement remains incomplete until a human playback record is captured, bound to the same production release run, and accepted by `scripts/ppt-manual-playback-acceptance.mjs`.
