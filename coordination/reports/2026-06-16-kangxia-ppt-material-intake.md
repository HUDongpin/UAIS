# Kang Xia PPT Material Intake

- Date: 2026-06-16
- Intake owner: S24
- Supporting sessions: S07, S12, S19, S11, S22, S25
- Source type: Owner-provided PPTX material
- Source title: `初等数学研究+PPT1+自然数的序数理论.pptx`
- User-facing path policy: Do not expose the original WeChat temporary path in app UI, reports for delivery, logs, or generated decks.
- Redaction rule: This intake records no real API keys, real Qwen cloned voice ids, raw/base64 audio payloads, or private local sample paths.

## Intended Use

This PPTX may be used as the source material for UAIS PPT generation and Kang Xia voice narration.

Narration voice contract:

- Teacher voice: Kang Xia
- Provider: Qwen / DashScope
- Provider role: `ppt-narration`
- Public voice reference: `qwen-voice-ref-teacher-kang-teacher-kang-10s-sample`
- Teacher id: `teacher-kang`
- Sample asset id: `teacher-kang-10s-sample`
- Public voice marker: `server-side-cloned-qwen-voice`
- Storage policy: `local-private-cloned-voice-reference`
- S12 integrity requirement: PPT narration requests must use the same teacher/sample pair as the stored public voice reference.

## Source Deck Inventory

- Slide count: 19
- Notes slides: 19
- Notes with readable speaker text: 0
- Media objects: 26
- Media types observed: PNG/JPEG and one extensionless media entry

## Extracted Slide Outline

| Slide | Extracted topic |
| --- | --- |
| 1 | 自然数的序数理论 / 初等数学研究 |
| 2 | 是什么、如何教、为何学、重点、难点、盲点 |
| 3 | 提纲：自然数的意义 |
| 4 | 问题 1-2：自然数的本质、1+1=2 |
| 5 | 问题 3：数字 5 和数字 2 的含义 |
| 6 | 问题 4：为什么建立自然数序数理论 |
| 7 | 问题 5：如何建立自然数序数理论，五条公理 |
| 8 | 五条公理展开：1 是自然数 |
| 9 | 五条公理展开 |
| 10 | 五条公理展开 |
| 11 | 五条公理汇总 |
| 12 | 自然数序数理论的应用 |
| 13 | 问题 6：如何严谨定义加法，加法的本质 |
| 14 | 问题回顾：自然数本质、1+1=2 |
| 15 | 情境任务：手机支付/网银转账与自然数内容讲授 |
| 16 | 教学转化应用 |
| 17 | 问题情境、前沿应用、小结 |
| 18 | 小结：自然数本质、自然数双重意义、皮亚诺算术等 |
| 19 | 作业布置：师范训练、微视频录制 |

## Narration Preparation Notes

- The deck contains no readable speaker notes, so narration scripts should be generated from slide text and visual context rather than notes.
- S07 should generate concise slide-by-slide narration scripts in Kang Xia's instructional voice.
- S12 must submit live PPT narration with `clonedVoiceRef`, not the real Qwen cloned voice id.
- S24 should store any generated WAV assets through the existing PPT narration asset manifest path and expose only download URLs.
- S25 should scan any generated scripts, manifests, or reports before delivery to ensure no provider secrets, private voice ids, raw audio, or original WeChat temporary paths leak.

## Current Readiness

- PPTX material intake: ready
- Kang Xia public voice reference: ready
- Live generation blocker: S05 teacher workflow UI approval and S19 Vercel deployment/env placement are still pending for production use.
