import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ChatroomPrintButton } from "./chatroom-print-button";
import { ChatroomTranscriptDocument } from "./chatroom-transcript-document";
import { copy, defaultLocale, supportedLocales, type Locale } from "@/i18n/copy";
import { loadLearningChatroomExportDocument } from "@/lib/server/learning-chatroom-share-view";
import { getLocalizedRouteMetadata } from "@/lib/server/localized-route-metadata";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";

// Print view for one chatroom room (plan D8: export ships as a print view, no
// PDF service and no credentials). The Export button in the chatroom opens this
// route with the room's `?courseId=&classId=&groupId=`; the browser's own print
// dialog is the PDF generator.
//
// Access is the same gate the chatroom GET applies for that room - an assigned
// member, or the course-owning teacher - because a printable transcript is a
// replay of the room, not a lesser artifact.

const metadataByLocale = {
  "zh-CN": {
    title: "聊天记录导出 | 优爱思",
    description: "打印或另存为 PDF 的人机协作聊天室记录。",
  },
  "en-US": {
    title: "Chatroom Transcript Export | UAIS",
    description: "A printable human-AI chatroom transcript for saving as PDF.",
  },
} satisfies Record<Locale, Metadata>;

// The transcript is per-request, per-session data: never prerendered, never
// cached.
export const dynamic = "force-dynamic";

type ChatroomExportRouteProps = {
  searchParams: Promise<{
    courseId?: string | string[];
    classId?: string | string[];
    groupId?: string | string[];
  }>;
};

export function generateMetadata(): Promise<Metadata> {
  return getLocalizedRouteMetadata(metadataByLocale);
}

export default async function Page({ searchParams }: ChatroomExportRouteProps) {
  const cookieStore = await cookies();
  const locale = readSupportedLocale(cookieStore.get("uais-locale")?.value);
  const appSession = getUaisAppSessionUserFromCookieString(cookieStore.toString(), {
    env: process.env,
  });
  const query = await searchParams;
  const t = copy[locale];
  const courseId = firstQueryValue(query.courseId);
  const classId = firstQueryValue(query.classId);
  const groupId = firstQueryValue(query.groupId);

  const result = await loadLearningChatroomExportDocument({
    env: process.env,
    locale,
    appSession,
    ...(courseId ? { courseId } : {}),
    ...(classId ? { classId } : {}),
    ...(groupId ? { groupId } : {}),
  });

  if (result.status !== "ready") {
    return (
      <ChatroomExportNotice
        message={
          result.status === "sign-in-required"
            ? t.learning.exportSignInRequired
            : result.status === "unavailable"
              ? t.learning.exportTranscriptUnavailable
              : t.learning.exportAccessDenied
        }
        backLabel={t.learning.backToLearning}
      />
    );
  }

  return (
    <div className="py-2">
      <ChatroomPrintStyles />
      <ChatroomTranscriptDocument
        document={result.document}
        tone="print"
        title={t.learning.exportPageTitle}
        notice={t.learning.exportPrintHint}
        actions={<ChatroomPrintButton label={t.learning.exportPrint} />}
      />
    </div>
  );
}

// Print rules the printed sheet needs and the screen does not. `header.sticky` is
// the app-shell header (`src/components/layout/header.tsx`), which is not this
// session's file to make print-aware - the document's own `<header>` carries no
// `sticky` class, so it survives.
function ChatroomPrintStyles() {
  return (
    <style>{`
@media print {
  header.sticky { display: none !important; }
  main { max-width: none !important; padding: 0 !important; }
  body { background: #ffffff !important; }
  [data-uais-chatroom-document="print"] {
    border: 0 !important;
    border-radius: 0 !important;
    padding: 0 !important;
    max-width: none !important;
  }
}
    `}</style>
  );
}

function ChatroomExportNotice({
  message,
  backLabel,
}: {
  message: string;
  backLabel: string;
}) {
  return (
    <section className="mx-auto w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <p className="text-sm leading-6 text-[var(--muted)]">{message}</p>
      <Link
        href="/learning/chatroom"
        className="mt-4 inline-flex h-10 items-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {backLabel}
      </Link>
    </section>
  );
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readSupportedLocale(locale: string | undefined): Locale {
  return supportedLocales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;
}
