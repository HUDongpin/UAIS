import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { ChatroomTranscriptDocument } from "@/app/learning/chatroom/export/chatroom-transcript-document";
import { copy, defaultLocale, supportedLocales, type Locale } from "@/i18n/copy";
import { resolveLearningChatroomShareViewerKey } from "@/lib/server/learning-chatroom-share-rate-limit";
import { loadLearningChatroomShareDocument } from "@/lib/server/learning-chatroom-share-view";
import { getLocalizedRouteMetadata } from "@/lib/server/localized-route-metadata";

// Public, read-only view of one chatroom room (plan D8, Phase 5).
//
// Three properties this page is built around:
//
// 1. No session. Anyone holding the link may read it, which is what makes it a
//    share link; the unguessable share id is the whole access control.
// 2. No account ids. The loader projects display names only, exactly like the
//    chatroom GET, so a public page can never publish who a student IS.
// 3. Live, not frozen. The room is read at request time, so a revoked link stops
//    working immediately and an active room keeps the link current. "Snapshot"
//    in the plan means the display-name projection, not a frozen transcript.
//
// A revoked or unknown share id is a single, indistinguishable 404.

// A share link is a capability handed to particular people, so the page it opens
// must never become a search result: an indexed transcript would publish a
// classroom conversation to anyone who searched a phrase from it, and no
// revocation can undo a crawl. `robots.ts` disallows `/share/` for well-behaved
// crawlers; this per-page directive is the half that also reaches the ones that
// ignore the file but honour the meta tag, and it survives a crawler that
// reached the URL some other way.
const shareRobotsMetadata = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false },
} satisfies Metadata["robots"];

const metadataByLocale = {
  "zh-CN": {
    title: "小组协作记录 | 优爱思",
    description: "只读分享的人机协作聊天室记录，仅显示成员昵称。",
    robots: shareRobotsMetadata,
  },
  "en-US": {
    title: "Group Collaboration Record | UAIS",
    description: "A read-only shared human-AI chatroom transcript, display names only.",
    robots: shareRobotsMetadata,
  },
} satisfies Record<Locale, Metadata>;

export const dynamic = "force-dynamic";

type ChatroomShareRouteProps = {
  params: Promise<{ shareId: string }>;
};

export function generateMetadata(): Promise<Metadata> {
  return getLocalizedRouteMetadata(metadataByLocale);
}

export default async function Page({ params }: ChatroomShareRouteProps) {
  const { shareId } = await params;
  // Both are request-time reads, so they run together; reading `headers()` also
  // keeps this route dynamic, which it already is.
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const locale = readSupportedLocale(cookieStore.get("uais-locale")?.value);
  const t = copy[locale];

  const result = await loadLearningChatroomShareDocument({
    env: process.env,
    locale,
    shareId,
    // The only per-viewer signal a signed-out page has, so the throttle keys on
    // it. The loader consumes the budget before any storage read.
    clientKey: resolveLearningChatroomShareViewerKey((name) => headerList.get(name)),
  });

  if (result.status === "not-found") {
    notFound();
  }

  if (result.status === "unavailable" || result.status === "rate-limited") {
    // Neither a storage outage nor a per-viewer throttle is a revocation, so the
    // page says "try again later" instead of pretending the link never existed.
    // An App Router page cannot emit a real 429; the protection is that a
    // throttled request already skipped every storage read in the loader above.
    return (
      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="text-sm leading-6 text-[var(--muted)]">
          {t.learning.exportTranscriptUnavailable}
        </p>
      </section>
    );
  }

  return (
    <div className="py-2">
      <ChatroomTranscriptDocument
        document={result.document}
        tone="screen"
        title={t.learning.sharePageTitle}
        notice={t.learning.sharePageNotice}
      />
    </div>
  );
}

function readSupportedLocale(locale: string | undefined): Locale {
  return supportedLocales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;
}
