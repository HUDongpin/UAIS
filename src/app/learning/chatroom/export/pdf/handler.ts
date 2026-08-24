import { copy, defaultLocale, supportedLocales, type Locale } from "@/i18n/copy";
import { loadLearningChatroomExportDocument } from "@/lib/server/learning-chatroom-share-view";
import { renderChatroomTranscriptPdf } from "@/lib/server/learning-chatroom-transcript-pdf";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";

// Server-rendered PDF of one chatroom room (S24, owner-approved 2026-08-08).
//
// The sibling print view stays: it needs nothing from the server and it is what
// a learner reaches for when they just want paper. This route answers the other
// need - a real file, byte-identical for everyone, with no print dialog.
//
// Authorization is not re-implemented here. It reuses
// `loadLearningChatroomExportDocument`, the same loader the print view uses, so
// the room gate, the groups feature flag and the display-names-only projection
// are inherited rather than restated - there is no second rule to keep in sync,
// and no path by which this route could return more than the page already does.

type LearningChatroomExportPdfDeps = {
  env?: Record<string, string | undefined>;
  fontPath?: string;
};

export function createLearningChatroomExportPdfGetHandler(
  deps: LearningChatroomExportPdfDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET(request: Request) {
    const url = new URL(request.url);
    const cookieHeader = request.headers.get("cookie");
    const locale = readSupportedLocale(readCookieValue(cookieHeader, "uais-locale"));
    const appSession = getUaisAppSessionUserFromCookieString(cookieHeader, { env });
    const t = copy[locale];

    const courseId = url.searchParams.get("courseId") ?? undefined;
    const classId = url.searchParams.get("classId") ?? undefined;
    const groupId = url.searchParams.get("groupId") ?? undefined;

    const result = await loadLearningChatroomExportDocument({
      env,
      locale,
      appSession,
      ...(courseId ? { courseId } : {}),
      ...(classId ? { classId } : {}),
      ...(groupId ? { groupId } : {}),
    });

    // Statuses map to codes rather than to a rendered page: the caller here is a
    // download, so a browser must not save an error page as a .pdf.
    if (result.status === "sign-in-required") {
      return plainTextResponse(401, t.learning.exportSignInRequired);
    }
    if (result.status === "denied") {
      return plainTextResponse(403, t.learning.exportAccessDenied);
    }
    if (result.status === "unavailable") {
      return plainTextResponse(503, t.learning.exportTranscriptUnavailable);
    }

    const pdf = await renderChatroomTranscriptPdf({
      document: result.document,
      labels: {
        title: t.learning.exportPageTitle,
        courseLabel: t.learning.exportCourseLabel,
        groupLabel: t.learning.exportGroupLabel,
        membersLabel: t.learning.groupMembers,
        dateRangeLabel: t.learning.exportDateRangeLabel,
        messageCountLabel: t.learning.exportMessageCountLabel,
        agentTag: t.learning.exportAgentTag,
        unavailableNotice: t.learning.exportTranscriptUnavailable,
        windowTrimmedNotice: t.learning.chatroomWindowTrimmed,
      },
      ...(deps.fontPath ? { fontPath: deps.fontPath } : {}),
    });

    return new Response(pdf as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        // `attachment` is the whole point of this route over the print view.
        "content-disposition": `attachment; filename="${createPdfFileName(result.document.groupName)}"`,
        "content-length": String(pdf.byteLength),
        // A transcript is per-session data and changes as the room does.
        "cache-control": "no-store",
      },
    });
  };
}

// ASCII-only and slug-shaped: a Content-Disposition filename travels through
// proxies and download managers that mangle non-ASCII, and the group name is
// free text that may be entirely Chinese - in which case the date alone names
// the file rather than a string of escapes.
function createPdfFileName(groupName?: string) {
  const slug = (groupName ?? "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .toLowerCase();
  const stamp = new Date().toISOString().slice(0, 10);
  return slug ? `uais-chatroom-${slug}-${stamp}.pdf` : `uais-chatroom-${stamp}.pdf`;
}

function plainTextResponse(status: number, message: string) {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function readCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

function readSupportedLocale(value: string | undefined): Locale {
  return supportedLocales.includes(value as Locale) ? (value as Locale) : defaultLocale;
}
