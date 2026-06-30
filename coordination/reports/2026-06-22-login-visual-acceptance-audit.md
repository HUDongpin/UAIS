# UAIS Login Visual Acceptance Audit

- Date: 2026-06-22
- Session: S01
- Scope: Active goal for asset-backed UAIS login visual deck
- Current candidate baseline: `output/playwright/uais-login-visual-deck-766x332.png`
- Current evidence command: `node scripts/login-visual-regression.mjs`
- Current status: Implementation substantially satisfies the latest UAIS-directed visual state, but the original pixelmatch completion gate remains unproven without the old approved reference image or owner approval of the current crop as the new baseline.

## Current Rendered Evidence

- Full screenshot: `output/playwright/uais-login-visual-page.png`
- 766 x 332 crop: `output/playwright/uais-login-visual-deck-766x332.png`
- Student asset: `public/login/uais-student-card-illustration.png`, 1536 x 1024
- Teacher asset: `public/login/uais-teacher-card-illustration.png`, 1536 x 1024
- Visual evidence CLI: `scripts/login-visual-regression.mjs`

## Requirement Audit

| Requirement | Status | Evidence |
| --- | --- | --- |
| Login left visual uses a dual-card system | Proven | `LoginDesignDeck` in `src/components/pages/login-page.tsx`; test `renders the asset-backed dual-card login design deck` |
| Desktop shows student and teacher cards side by side | Proven | `grid h-full grid-cols-2 gap-[14px]`; current crop `output/playwright/uais-login-visual-deck-766x332.png` |
| Narrow screens use single-card carousel | Proven | `LoginMobileDesignCarousel`; test asserts `data-uais-login-mobile-carousel` |
| New component replaced CSS-built people | Proven | `LoginDesignDeck` / `LoginDesignCard`; test asserts no `data-uais-cartoon-*` nodes |
| Deck aspect ratio is 766 / 332 | Proven | Inline style assertion in `tests/login-page.test.tsx`; `sips` confirms crop is 766 x 332 |
| Uses high-resolution PNG assets | Proven | `public/login/uais-student-card-illustration.png` and `public/login/uais-teacher-card-illustration.png`, each 1536 x 1024 |
| Text remains HTML overlay for accessibility and copy changes | Proven | Visible copy is rendered from `loginCopy` and tested in `tests/login-page.test.tsx` |
| Card border, radius, light gradient, soft shadow | Proven | Card class has rounded 14px, light blue border, white-to-blue gradient, tinted shadow |
| Main blue follows UAIS blue | Proven | Component uses `#1f6feb` for accents and icons |
| Image area is not CSS-built people | Proven | Assets rendered with Next `Image`; no CSS person nodes |
| Feature chips are outside image region | Proven | Tests require image frame and feature rail, and assert zero chips inside `data-uais-login-asset-frame` |
| Latest copy changes are applied | Proven | Tests assert `每个疑问都有高质量回答`, `个性化教学`, `AI助教即时反馈`, `高度自定义教学界面` |
| Top bold card titles were removed | Proven | Tests assert `学生登录` and `教师登录` do not render |
| Playwright-based visual evidence exists | Proven | `scripts/login-visual-regression.mjs` captures `/login` and crops 766 x 332 |
| Pixelmatch workflow exists | Proven | CLI supports `--reference`, `--current`, `--max-diff`, and emits accepted or blocked JSON |
| Pixelmatch against original design-board screenshot below 3% | Not proven | Original 12:03 dual-card design-board reference image is unavailable in current local state |

## Latest User-Directed Visual State

The current candidate crop reflects these latest owner-directed changes:

- Removed bold `学生登录` and `教师登录` card titles.
- Student feature chip: `每个疑问都有高质量回答`.
- Teacher headline accent: `个性化教学`.
- Teacher feature chips include `AI助教即时反馈` and `高度自定义教学界面`.
- Feature chips live outside the image frame.
- Student and teacher assets are watercolor-style PNGs, not CSS-built people.

## Verification Commands Run

These checks have passed in the current worktree:

```bash
npm run test -- tests/login-page.test.tsx tests/login-visual-regression-script.test.ts
npm run lint
node scripts/login-visual-regression.mjs
npm run test
npm run build
```

Recent successful full-suite evidence:

- `npm run test`: 54 files, 655 tests passed.
- `npm run build`: Next.js 16.2.9 production build passed.

## Repeatable Acceptance Path

If the owner approves the current crop as the new UAIS-specific visual reference:

```bash
cp output/playwright/uais-login-visual-deck-766x332.png output/playwright/uais-login-approved-reference-766x332.png
node scripts/login-visual-regression.mjs --reference output/playwright/uais-login-approved-reference-766x332.png
```

If the old design-board screenshot is restored:

```bash
node scripts/login-visual-regression.mjs --reference <path-to-old-766x332-reference>
```

Expected gate:

- HTML overlay mode: diff ratio must be <= 0.03.
- Baked-image mode: diff ratio must be <= 0.01.

## Completion Decision

Do not mark the active goal complete yet.

Reason: Most implementation requirements are proven against current files, tests, and rendered artifacts, but the formal pixelmatch acceptance target still references the earlier design-board image. That image is not present in the current local state, and the visual direction has changed through later owner requests. Completion requires one of these decisions:

1. Restore the old approved 766 x 332 reference image and pass `node scripts/login-visual-regression.mjs --reference <path>`.
2. Approve `output/playwright/uais-login-visual-deck-766x332.png` as the new UAIS-specific baseline, then run the same script against that baseline.
