# Proposal — the three backend-gated /teaching defects (7.1, 7.4, 7.5)

- **Date:** 2026-08-19
- **Source:** `coordination/reports/2026-08-18-teaching-function-audit.md` §7
- **Status of the other defects:** 7.2, 7.3, 7.6, 7.7 and 7.8 are fixed and verified. This proposal covers only the three that cannot be fixed in the client.
- **Decision needed from the owner:** one choice in §1 (I recommend Option A and can implement it immediately), one in §2 (genuinely new server capability — your call).

---

## 0. Headline

Investigating these three changed the recommendation for two of them. **7.4 and 7.5 need no backend change at all — the routes are correct and the UI is wrong.** The audit's own suggested fix direction ("take these two routes off `assertUaisAiAdminAccess`") would break a security posture the production release gate actively enforces, and should not be followed.

Only **7.1** needs a new server capability.

---

## 1. 7.4 / 7.5 — `刷新配置检查` and `运行试测`

### 1.1 What the audit said

That `runReadiness`/`runSmokePlan` call `readJson` without access headers, that the routes require `assertUaisAiAdminAccess({ requireSignedSession: true })`, that no admin issuance path exists, and that the two actions are absent from the `/api/ai/session` allowlist. All of that is accurate.

Its fix direction was: *"Either an admin-issuance path must exist, or these two routes must come off `assertUaisAiAdminAccess`, and both actions must be added to the session allowlist."*

### 1.2 Two findings that change the answer

**Finding 1 — no admin session exists anywhere in the running system.** `createUaisAiAccessSessionForTrustedActor` (`src/lib/server/ai-access-control.ts:263`) is reachable from exactly one production call site, `src/lib/server/ai-session-issuer.ts:43`, which hardcodes `role: "teacher"` (`:46`). Every other caller is a **test file**. No script mints one either. So `assertUaisAiAdminAccess` cannot pass at runtime today — not for a teacher, not for anyone.

**Finding 2 — the release gate requires these routes to keep denying.** `scripts/production-e2e-release-gate.mjs:530-547` lists `/api/ai/readiness` and `/api/ai/smoke-plan` in `requiredTeacherAiAdminRouteDirectCallProbes`, and `:8812-8815` asserts every one of them satisfies `isSignedSessionDeniedProbe`. Denial is the asserted contract, not an accident.

Together these say the routes are **deliberately locked-down admin diagnostics**, and the defect is that teacher-facing buttons were wired to them. Removing the admin assertion would flip a release-gate check from pass to fail and widen the AI surface to every authenticated teacher.

### 1.3 Options

| | Option | Cost | Risk | Verdict |
| --- | --- | --- | --- | --- |
| **A** | **Remove the two buttons from the teacher workflow UI.** They are provider diagnostics (which AI providers are reachable, what a dry-run would do) — information a teacher cannot act on. | Small, client-only: delete two buttons + `runReadiness`/`runSmokePlan` and their result lines in `teacher-ppt-narration-workflow.tsx`. | None. Removes a control that has never once worked. | **Recommended** |
| **B** | Add teacher-safe `/api/ai/readiness/teacher` + `/api/ai/smoke-plan/teacher` returning a redacted subset, with `provider-readiness`/`provider-smoke-plan` added to the session allowlist. | Medium: 2 routes, allowlist change, redaction review, tests. | New authenticated surface; needs S12 review of what a teacher may see about provider topology. | Only if teachers actually need this |
| **C** | Build a real admin-issuance path and an admin console. | High; security-sensitive. | Introduces the first admin role in the system. | Not now — no admin surface is planned |

**Recommendation: A.** If provider readiness is genuinely wanted for operators, that is an ops/admin console story (Option C) and should be scoped separately, not smuggled in by lowering a gate.

---

## 2. 7.1 — `修改封面 / Modify the cover`

### 2.1 Why this is not a one-line fix

The obvious fix — wire the button to a file input — produces a lie. A course cover must bind to a **persisted, audited** asset. `verifyCourseCoverAssetPersistence` (`src/components/pages/teaching-page-helpers.ts:495-515`) rejects anything without:

- `assetPersistence.status === "persisted"` and `responsibleSession === "S12"`, and
- a signed audit receipt: `hasSignedCourseCoverAuditReceipt` (`:517-534`) requires `eventType === "teaching-course-cover.generated"`, `authMode === "signed-teacher-session"`, and a non-empty `sessionId` / `authenticatedAt` / `expiresAt`.

A client-only picker can satisfy none of that. It would show a teacher their new cover while the course keeps the old one — and I would have to fake a signed audit receipt to get past the verifier. There is also **no upload endpoint anywhere** in `src/app/api/`: no `formData()` or multipart handler exists.

### 2.2 Proposed change — extend the existing route rather than add a new one

`POST /api/teaching/course-cover` already does everything except obtain the image: it authorizes the teacher, persists via `storeTeachingCourseCoverAsset`, emits the audit receipt, and binds the cover to the course. An upload branch reuses all of it.

**Concrete steps:**

1. **`src/lib/server/teaching-course-assets-store.ts:180-189`** — parameterize provenance. `provider: "qwen"` and `providerRole: "image-generation"` are currently hardcoded; accept `provider: "teacher-upload"` / `providerRole: "teacher-upload"` so an uploaded asset is not mislabelled as generated.
2. **`src/app/api/teaching/course-cover/route.ts`** — add an upload branch that skips the Qwen client (`:174-186`) and instead validates and stores uploaded bytes: enforce an allowlist of image mime types, a max byte size, and decode failure handling. It then calls the same `storeTeachingCourseCoverAsset` (`:187`) and the same `maybeBindCourseCoverToExistingCourse` (`:209`).
3. **Audit** — emit `eventType: "teaching-course-cover.uploaded"`, keeping `authMode: "signed-teacher-session"` and the same session fields.
4. **`teaching-page-helpers.ts:517-534`** — widen `hasSignedCourseCoverAuditReceipt` to accept `generated` **or** `uploaded`. This is the only client-side contract change.
5. **`teaching-page-dialogs.tsx:750-756`** — replace the dead button with a `<label htmlFor>` + hidden `type="file"` input (a `<button>` cannot open a picker), posting to the upload branch and reusing the existing `coverError` / `generatedCover` state.
6. **Tests** — upload happy path, oversized file, wrong mime type, and a case asserting the uploaded asset is rejected if the audit receipt is missing.

**Decision points for the owner:** the max upload size, the accepted mime types, and whether uploaded covers need moderation before they can appear on the course plaza. I did not assume answers to these.

### 2.3 Interim position

Until this is built, the button is a control that does nothing. If you do not want the upload work now, the honest interim is to remove it (or disable it with an explanatory tooltip) rather than leave an enabled button that silently no-ops. Say which you prefer.

---

## 3. Ownership under AGENTS.md

| Work | Owner |
| --- | --- |
| Removing the two admin-diagnostic buttons (§1 Option A) | S05 teaching UI |
| Course-cover upload branch + asset store provenance (§2) | S12 backend contracts |
| `hasSignedCourseCoverAuditReceipt` widening | S12 with S05 |
| Any change to the admin gate or release-gate probes | S22 + S12 — **not** to be done as a side effect of a UI fix |
| Tests for either | S11 |

---

## 4. What I recommend doing now

1. **§1 Option A** — remove the two dead diagnostic buttons. Client-only, no contract change, no release-gate impact. I can do this immediately on your word.
2. **§2** — hold until you decide on upload size/mime/moderation. It is a real feature, not a bug fix, and it changes what teachers can put on the course plaza.
3. Note for the audit record: 7.4/7.5 should be **reclassified** from "route defect" to "UI wired to an admin-only route". The routes behave exactly as designed and as the release gate asserts.
