# UAIS Teaching Website Template

UAIS is a personal teaching website template for `uais.top`. The name supports both
University AI System and University Adaptive Interactive System.

The interface is MAIC-informed at the pattern level: course plaza cards, learner playback,
human-AI group chat, and a teacher course-management workspace. It does not include private
ClosedMAIC screenshots, internal identities, proprietary assets, or copied MAIC content.

## Stack

- Next.js App Router
- React and TypeScript
- Tailwind CSS v4
- Phosphor Icons
- Vitest acceptance tests

## Routes

- `/courses` - 课程广场, with exactly two course cards: 大学研究方法 and 数学教学法.
- `/learning` - 我的学习, with enrolled courses, playback-style learning panel, and a chatroom entry button.
- `/learning/chatroom` - full 人机协作聊天室 interface for group messages, AI agents, PDF export, and sharing.
- `/teaching` - 我的教学, with teacher course cards and management entry points.
- `/` - redirects to `/courses`.

## Project Structure

- `src/data/uais.ts` - mock courses, learning records, AI agents, chat messages, and teacher dashboard items.
- `src/i18n/copy.ts` - bilingual copy for `zh-CN` and `en-US`, with Simplified Chinese as the default.
- `src/lib/chat-actions.ts` - UI-ready mocked PDF export and share-link helpers.
- `src/components/providers/app-preferences.tsx` - language and light/dark theme state.
- `src/components/layout/` - app shell and top navigation.
- `src/components/pages/` - page-level UI for the three teaching areas.
- `tests/uais-data.test.ts` - acceptance checks for the brief-critical data contract.

## Extending

Replace mock data in `src/data/uais.ts` first, then update page components only when the shape of the
workflow changes. Real PDF export and share links can be connected behind `src/lib/chat-actions.ts`
without changing the chatroom UI.

## Development

```bash
npm run dev
npm run test
npm run lint
npm run build
```
