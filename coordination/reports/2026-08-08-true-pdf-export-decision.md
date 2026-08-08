# True Server-Side PDF Export — S24 Approach Decision

- Date: 2026-08-08
- Session: S24 (asset and export quality lead)
- Owner decision being served: implementation plan §10 item 6 — *"Approved — pursue real server-side PDF"*, with the standing rule that any credential or paid-service need returns to the owner as a blocker report.
- Status: **Decision required.** Investigation complete; no code written, no dependency added.

---

## 1. What ships today

`/learning/chatroom/export` renders the transcript in a print stylesheet and the Export button opens it; the browser's own print dialog is the PDF generator. It has no dependency, no credential, no cost, and it works — including for Chinese text, because **the user's own operating system supplies the CJK font**.

True server-side PDF would add: a downloadable `.pdf` file with no print dialog, byte-identical output for every viewer, and something a teacher can attach or archive directly.

---

## 2. The one fact that decides this

**There is no font in this repository, and Chinese is the default locale.**

- `globals.css` declares `--font-sans: Arial, Helvetica, sans-serif`. Neither carries CJK glyphs, so every Chinese character in the product today is rendered by the *viewer's* OS fallback (PingFang SC / Microsoft YaHei / Noto Sans CJK).
- `next/font` is not used, there is no `@font-face`, no webfont CDN link, and no `.ttf`/`.otf`/`.woff2` anywhere outside `node_modules`.
- Every server-side PDF technique needs the glyphs **on the server**:
  - headless Chromium on a serverless runtime ships **no** CJK fonts — the page renders as tofu boxes unless a font is bundled and registered;
  - a drawing library (`pdf-lib`, `pdfkit`) must embed a font; PDF's 14 standard fonts are WinAnsi-only and **cannot encode Chinese at all**;
  - `satori` / `next/og` (already vendored inside Next 16) needs explicit font buffers and ships only Latin `Geist-Regular.ttf` — and produces images, not PDF.

So the real question is not "which renderer" but **"are we willing to commit a CJK font to the repository?"** Every option below answers yes except the one that does nothing.

---

## 3. Options

### Option A — `pdf-lib` + embedded CJK font  ← **recommended**

Generate the PDF directly from `ChatroomTranscriptDocument`, which is already clean structured data (`messages[{authorLabel, content, timeLabel, role, agentId}]`, `courseName`, `groupName`, `memberNames`, `dateRange`) with timestamps pre-formatted as timezone-free `YYYY-MM-DD HH:MM UTC`. No browser, no layout engine.

- **Adds:** `pdf-lib` + `@pdf-lib/fontkit` (pure JS, no native binaries, ~1MB) and one font file.
- **Font:** Noto Sans SC (SIL OFL 1.1 — freely redistributable, attribution-friendly). Full weight ≈ 10–16MB; a GB2312-coverage subset (~6,800 common characters) lands around 2–4MB and covers ordinary classroom Chinese. `public/` is **not** stripped by `.vercelignore`, so a font placed there ships.
- **Pros:** deterministic byte-identical output; small, fast, cold-start friendly; no new Vercel config; works identically in dev, test and production; easy to unit-test with the existing DI harness.
- **Cons:** we hand-lay-out the page (wrapping, pagination) — a few hundred lines for a transcript, but real work; a subset font means a rare character can fall back to a blank, so full-coverage is safer if size allows.

### Option B — headless Chromium (`@sparticuz/chromium` + `puppeteer-core`)

Render the existing print page and print-to-PDF.

- **Pros:** reuses the stylesheet exactly; one visual source of truth.
- **Cons:** ~50MB+ of binaries against Vercel's ~250MB function ceiling; needs **net-new** `serverExternalPackages` + `outputFileTracingIncludes` config (neither exists today, and `next.config.ts` is S22-owned and wrapped by `withSentryConfig`); slow cold starts on default memory, and `vercel.json` currently sets no `functions` memory/duration; **and it still needs the CJK font bundled and fontconfig pointed at it**, so it does not avoid the font problem — it adds to it. Note the repo already treats browser automation as dev-only: Playwright is deliberately *not* a dependency and is lazily resolved in smoke scripts.

### Option C — external PDF service (DocRaptor, PDFShift, …)

- **Blocked by rule.** Needs a credential and is a paid service, which AGENTS.md and the owner's own §10 condition route back to the owner. It also sends full transcript text — student names and messages — to a third party, which is a privacy decision, not just a cost one.

### Option D — keep the print view only

- Zero cost, already works, already shipped. The honest baseline: for a text transcript that a teacher prints or saves once, "Save as PDF" in the browser dialog is two clicks and produces a correct CJK document.

---

## 4. Recommendation

**Option A**, if the owner wants a real file. It is the only approach whose cost is one font asset plus a pure-JS library, and the transcript's structured-data shape makes it genuinely straightforward. Option B costs more, risks the deployment envelope, and does not escape the font requirement. Option C is an owner/privacy decision, not an engineering one.

If the owner would rather not carry a multi-megabyte binary in the repo, **Option D is a perfectly defensible answer** and nothing further is needed — the print view already satisfies "export the transcript".

---

## 5. What the owner needs to decide

1. **Go / no-go on committing a CJK font** to `public/` (Noto Sans SC, SIL OFL 1.1) — full coverage (~10–16MB) or GB2312 subset (~2–4MB)?
2. If go: approve adding `pdf-lib` + `@pdf-lib/fontkit` to `package.json` — a dependency change, which AGENTS.md makes a stop condition and which needs S10/S22 coordination.
3. Whether the PDF must be **byte-identical across viewers** (Option A guarantees it; the print view does not).

## 6. If approved, the work is

S24 with S12 for the route: a `GET /learning/chatroom/export/pdf` handler reusing `loadLearningChatroomExportDocument` (so authorization, the no-account-id projection, and group scoping are inherited unchanged), a `renderChatroomTranscriptPdf(document)` module, the font asset with provenance recorded per AGENTS.md, and tests asserting the PDF header, page count, embedded-font presence, and that no account id appears in the byte stream. Estimated small-to-medium; no new env names, no credential.

## 7. Stop conditions

- Any option that requires a credential or paid service — returns to the owner (already true of Option C).
- Font licence anything other than OFL/Apache — do not commit.
- Vercel function size approaching the ceiling — abandon Option B rather than raising limits.
